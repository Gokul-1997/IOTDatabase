import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramService } from '../../core/services/program.service';
import { MachinesService } from '../machines/machines.service';
import { ToastService } from '../../core/services/toast.service';
import { SocketService } from '../../core/services/socket.service';
import { UiTabsDirective } from '../../shared/ui-tabs.directive';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-programs',
  standalone: true,
  imports: [CommonModule, FormsModule, UiTabsDirective, MatIconModule],
  templateUrl: './programs.component.html'
})
export class ProgramsComponent implements OnInit, OnDestroy {
  tab: 'programs' | 'history' = 'programs';

  programs: any[] = [];
  transfers: any[] = [];
  machines: any[] = [];
  total = 0;
  transfersTotal = 0;
  loading = false;
  page = 1;
  limit = 10;
  search = '';

  /* ── controller side ── */
  selectedMachineId: number | null = null;
  machineFiles: any[] = [];
  machineSearch = '';
  loadingFiles = false;
  /** null = not checked yet */
  machineOnline: boolean | null = null;
  checkingStatus = false;
  fetchingFile: string | null = null;

  /* ── selection (server side) ── */
  selectedProgramIds = new Set<number>();

  /* ── upload form ── */
  showUpload = false;
  uploadFile: File | null = null;
  uploadName = '';
  uploadDescription = '';
  uploading = false;

  /* ── transfer ── */
  transferring = false;
  /** transfer_id → { file_name, percent, direction } */
  progress = new Map<number, any>();
  /** set when the controller already holds one of the files */
  /* `unverified` distinguishes "the controller told us this file is there"
     from "the controller cannot answer either probe". Both need the same
     confirmation, but claiming a file exists when we could not check is a
     lie the operator would rightly stop trusting. */
  overwritePrompt: {
    programIds: number[]; machineIds: number[]; names: string[]; unverified: boolean;
  } | null = null;

  /* ── supervisor authorisation ──
     Sending to a controller needs a one-time code from the supervisor
     assigned to that machine. The modal has two phases: pick a supervisor
     (only when the machine has more than one), then enter their code. */
  authPrompt: {
    machineId: number;
    machineSerial: string;
    choices: any[] | null;
    authorizationId: number | null;
    supervisorName: string;
    sentTo: string;
    expiresAt: string;
    code: string;
    busy: boolean;
    error: string;
  } | null = null;

  /** Held only between a verified code and the end of that send — including
   *  the overwrite retry, which re-posts the batch and would otherwise ask
   *  the supervisor to type the code a second time. Cleared once the
   *  transfer finishes, so a later send needs fresh authorisation. */
  private activeAuth: { authorization_id: number; code: string; machineId: number } | null = null;

  private statusTimer: any = null;

  constructor(
    private programService: ProgramService,
    private machinesService: MachinesService,
    private toast: ToastService,
    private socket: SocketService,
    private cdr: ChangeDetectorRef
  ) {}

  /**
   * The app runs zoneless (Angular 21, no zone.js), so an HTTP response or a
   * socket event updating a field schedules nothing on its own — the view
   * only refreshed when the user happened to click something else. That left
   * the machine dropdown and the program list rendering empty on load.
   * Every async callback here has to say it changed something.
   */
  private touch() { this.cdr.markForCheck(); }

  ngOnInit() {
    this.load();
    this.machinesService.getMachines({ page: 1, limit: 1000 }).subscribe({
      next: res => { this.machines = (res.data || []).filter((m: any) => m.is_active); this.touch(); }
    });

    this.socket.onTransferProgress(p => {
      this.progress.set(p.transfer_id, p);
      this.touch();
      // drop the bar shortly after it completes so the list settles
      if (p.percent === 100) {
        setTimeout(() => { this.progress.delete(p.transfer_id); this.touch(); }, 1500);
      }
    });
  }

  ngOnDestroy() {
    this.socket.offTransferProgress();
    if (this.statusTimer) clearInterval(this.statusTimer);
  }

  /* ─────────────── server-side library ─────────────── */

  load() {
    this.loading = true;
    this.programService.getPrograms({ page: this.page, limit: this.limit, search: this.search }).subscribe({
      next: res => { this.programs = res.data || []; this.total = res.total || 0; this.loading = false; this.touch(); },
      error: () => { this.loading = false; this.touch(); }
    });
  }

  loadTransfers() {
    this.loading = true;
    this.programService.getTransfers({ page: this.page, limit: this.limit }).subscribe({
      next: res => { this.transfers = res.data || []; this.transfersTotal = res.total || 0; this.loading = false; this.touch(); },
      error: () => { this.loading = false; this.touch(); }
    });
  }

  switchTab(tab: 'programs' | 'history') {
    this.tab = tab;
    this.page = 1;
    tab === 'programs' ? this.load() : this.loadTransfers();
  }

  /* ─────────────── selection ─────────────── */

  toggleProgram(id: number) {
    this.selectedProgramIds.has(id)
      ? this.selectedProgramIds.delete(id)
      : this.selectedProgramIds.add(id);
  }

  isSelected(id: number) { return this.selectedProgramIds.has(id); }

  get allSelected(): boolean {
    return this.programs.length > 0 && this.programs.every(p => this.selectedProgramIds.has(p.id));
  }

  toggleAll() {
    if (this.allSelected) this.programs.forEach(p => this.selectedProgramIds.delete(p.id));
    else this.programs.forEach(p => this.selectedProgramIds.add(p.id));
  }

  get selectedCount() { return this.selectedProgramIds.size; }

  /* ─────────────── controller side ─────────────── */

  onMachineChange() {
    this.machineFiles = [];
    this.machineOnline = null;
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
    if (!this.selectedMachineId) return;

    this.checkStatus();
    this.loadMachineFiles();
    // keep the connection indicator honest while the page is open
    this.statusTimer = setInterval(() => this.checkStatus(), 30_000);
  }

  checkStatus() {
    if (!this.selectedMachineId) return;
    this.checkingStatus = true;
    this.programService.getMachineStatus(this.selectedMachineId).subscribe({
      next: res => { this.machineOnline = !!res.data?.online; this.checkingStatus = false; this.touch(); },
      error: () => { this.machineOnline = false; this.checkingStatus = false; this.touch(); }
    });
  }

  loadMachineFiles() {
    if (!this.selectedMachineId) return;
    this.loadingFiles = true;
    this.programService.getMachineFiles(this.selectedMachineId, this.machineSearch).subscribe({
      next: res => { this.machineFiles = res.data || []; this.loadingFiles = false; this.touch(); },
      error: err => {
        this.machineFiles = [];
        this.loadingFiles = false;
        this.touch();
        this.toast.error(err.error?.message || 'Could not read files from the controller');
      }
    });
  }

  /** Pull a file off the controller into the server library. */
  fetchFile(f: any) {
    if (!this.selectedMachineId) return;
    this.fetchingFile = f.name;
    this.programService.fetchFromMachine(this.selectedMachineId, f.name).subscribe({
      next: () => {
        this.fetchingFile = null;
        this.toast.success(`"${f.name}" retrieved from machine`);
        this.load();
      },
      error: err => {
        this.fetchingFile = null;
        this.touch();
        this.toast.error(err.error?.message || 'Download from machine failed');
      }
    });
  }

  /* ─────────────── transfers ─────────────── */

  /** Send every selected program to the selected machine. */
  sendSelected(overwrite = false) {
    if (!this.selectedMachineId) { this.toast.error('Select a machine first'); return; }
    if (this.selectedCount === 0) { this.toast.error('Select at least one program'); return; }

    const programIds = Array.from(this.selectedProgramIds);
    const machineIds = [this.selectedMachineId];

    // Nothing reaches the controller until the machine's supervisor has
    // signed this send off.
    if (!this.activeAuth || this.activeAuth.machineId !== this.selectedMachineId) {
      this.openAuthPrompt();
      return;
    }
    const auth = { authorization_id: this.activeAuth.authorization_id, code: this.activeAuth.code };

    this.transferring = true;
    this.programService.transferBatch(programIds, machineIds, overwrite, auth).subscribe({
      next: res => {
        this.transferring = false;
        this.overwritePrompt = null;
        this.touch();

        const results = res.data?.results || [];

        // A rejected code comes back per row, not as an HTTP error, because
        // the batch reports every combination individually.
        const denied = results.filter((r: any) => r.status === 'APPROVAL_REQUIRED');
        if (denied.length) {
          this.activeAuth = null;
          if (this.authPrompt) {
            this.authPrompt.busy = false;
            this.authPrompt.code = '';
            this.authPrompt.error = denied[0].message || 'That code was not accepted.';
            this.touch();
          } else {
            this.toast.error(denied[0].message || 'Supervisor authorisation required');
          }
          return;
        }

        const unassigned = results.filter((r: any) => r.status === 'NO_SUPERVISOR');
        if (unassigned.length) {
          this.closeAuthPrompt();
          this.toast.error(unassigned[0].message || 'No supervisor is assigned to this machine');
          return;
        }

        // The old program could not be read back, so nothing was sent. Say
        // that plainly — the machine is untouched, and an operator who
        // thinks a half-transfer happened will go and check the panel.
        const backupFailed = results.filter((r: any) => r.status === 'BACKUP_FAILED');
        if (backupFailed.length) {
          this.closeAuthPrompt();
          this.toast.error(backupFailed[0].message ||
            'The program on the machine could not be backed up, so nothing was sent.');
          return;
        }

        // The machine is mid-transfer for someone else. Retrying is the fix,
        // so say that rather than reporting a failure the operator would
        // reasonably read as a broken machine.
        const busy = results.filter((r: any) => r.status === 'BUSY');
        if (busy.length) {
          this.closeAuthPrompt();
          this.toast.error(busy[0].message || 'That machine is busy with another transfer');
          return;
        }

        // Missing IP or a program directory that is not on the controller —
        // an admin fixes this in the machine form; retrying never will.
        const misconfigured = results.filter((r: any) => r.status === 'NOT_CONFIGURED');
        if (misconfigured.length) {
          this.closeAuthPrompt();
          this.toast.error(misconfigured[0].message || 'This machine’s FTP details are incomplete');
          return;
        }

        const existing = results.filter((r: any) => r.status === 'EXISTS');
        if (existing.length) {
          // ask once, then resend the whole batch with overwrite — the same
          // authorisation carries over, so no second code is needed
          this.authPrompt = null;
          this.overwritePrompt = {
            programIds, machineIds,
            names: existing.map((r: any) => r.program_name),
            unverified: existing.every((r: any) => r.code === 'EXISTENCE_UNKNOWN')
          };
          return;
        }

        this.closeAuthPrompt();
        this.activeAuth = null;

        if (res.data?.failed) {
          this.toast.error(`${res.data.failed} of ${res.data.total} transfers failed`);
        } else {
          // Naming the backup in the success message is what makes the
          // guarantee real to the operator — otherwise it is a promise in a
          // dialog they have already dismissed.
          const backups = results.filter((r: any) => r.backup).length;
          this.toast.success(
            backups
              ? `Transfer complete. ${backups === 1 ? 'The program it replaced was' : backups + ' replaced programs were'} saved under Backups.`
              : (res.message || 'Transfer complete')
          );
        }

        this.selectedProgramIds.clear();
        this.loadMachineFiles();
      },
      error: err => {
        this.transferring = false;
        this.activeAuth = null;
        this.closeAuthPrompt();
        this.touch();
        this.toast.error(err.error?.message || 'Transfer failed');
      }
    });
  }

  confirmOverwrite() {
    if (!this.overwritePrompt) return;
    this.sendSelected(true);
  }

  cancelOverwrite() {
    this.overwritePrompt = null;
    // The supervisor authorised a send that is no longer happening.
    this.activeAuth = null;
  }

  /* ─────────────── supervisor authorisation ─────────────── */

  /** Open the modal and ask the backend to send a code. */
  openAuthPrompt() {
    if (!this.selectedMachineId) return;
    this.authPrompt = {
      machineId: this.selectedMachineId,
      machineSerial: this.selectedMachine?.machine_serial_no || 'this machine',
      choices: null,
      authorizationId: null,
      supervisorName: '',
      sentTo: '',
      expiresAt: '',
      code: '',
      busy: true,
      error: ''
    };
    this.requestCode();
  }

  /** Ask for a code, optionally naming which supervisor should receive it. */
  requestCode(supervisorId?: number) {
    if (!this.authPrompt) return;
    const prompt = this.authPrompt;
    prompt.busy = true;
    prompt.error = '';

    this.programService
      .requestAuthorization(prompt.machineId, Array.from(this.selectedProgramIds), supervisorId)
      .subscribe({
        next: res => {
          const d = res.data || {};
          prompt.busy = false;
          prompt.choices = null;
          prompt.authorizationId = d.authorization_id;
          prompt.supervisorName = d.supervisor?.username || '';
          prompt.sentTo = d.supervisor?.sent_to || '';
          prompt.expiresAt = d.expires_at;
          prompt.code = '';
          this.touch();
        },
        error: err => {
          const code = err.error?.code;
          prompt.busy = false;

          // Several supervisors cover this machine — ask which one is here.
          if (code === 'SUPERVISOR_REQUIRED') {
            prompt.choices = err.error?.supervisors || [];
            this.touch();
            return;
          }

          // Nobody can authorise this machine: an administrator has to fix
          // that, so close the modal rather than leaving a dead-end open.
          this.closeAuthPrompt();
          this.touch();
          this.toast.error(err.error?.message || 'Could not request an authorisation code');
        }
      });
  }

  /** Supervisor has entered their code — run the transfer with it. */
  confirmAuthorization() {
    const prompt = this.authPrompt;
    if (!prompt || !prompt.authorizationId) return;
    const code = (prompt.code || '').trim();
    if (!code) { prompt.error = 'Enter the code sent to the supervisor.'; return; }

    this.activeAuth = {
      authorization_id: prompt.authorizationId,
      code,
      machineId: prompt.machineId
    };
    prompt.busy = true;
    prompt.error = '';
    this.sendSelected(false);
  }

  closeAuthPrompt() { this.authPrompt = null; }

  cancelAuthorization() {
    this.closeAuthPrompt();
    this.activeAuth = null;
  }

  /* ─────────────── misc ─────────────── */

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.uploadFile = file;
    if (!this.uploadName) this.uploadName = file.name;
  }

  upload() {
    if (!this.uploadFile) { this.toast.error('Please choose a program file'); return; }
    this.uploading = true;
    this.programService.upload(this.uploadFile, this.uploadName, this.uploadDescription).subscribe({
      next: () => {
        this.uploading = false;
        this.showUpload = false;
        this.touch();
        this.uploadFile = null;
        this.uploadName = '';
        this.uploadDescription = '';
        this.toast.success('Program uploaded');
        this.load();
      },
      error: err => {
        this.uploading = false;
        this.touch();
        this.toast.error(err.error?.message || 'Upload failed');
      }
    });
  }

  deleteProgram(p: any) {
    if (!confirm(`Delete program "${p.name}"?`)) return;
    this.programService.delete(p.id).subscribe({
      next: () => { this.toast.success('Program deleted'); this.selectedProgramIds.delete(p.id); this.load(); },
      error: err => { this.touch(); this.toast.error(err.error?.message || 'Delete failed'); }
    });
  }

  download(p: any) {
    this.programService.download(p.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = p.file_name;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.error('Download failed')
    });
  }

  fileSize(bytes: number): string {
    if (bytes == null) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  get activeProgress(): any[] {
    return Array.from(this.progress.values());
  }

  get selectedMachine(): any {
    return this.machines.find(m => m.id === this.selectedMachineId) || null;
  }

  get totalPages(): number {
    const t = this.tab === 'programs' ? this.total : this.transfersTotal;
    return Math.max(1, Math.ceil(t / this.limit));
  }

  changePage(delta: number) {
    this.page += delta;
    this.tab === 'programs' ? this.load() : this.loadTransfers();
  }
}
