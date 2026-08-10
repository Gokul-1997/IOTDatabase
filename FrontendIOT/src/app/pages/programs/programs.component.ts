import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramService } from '../../core/services/program.service';
import { MachinesService } from '../machines/machines.service';
import { ToastService } from '../../core/services/toast.service';
import { SocketService } from '../../core/services/socket.service';

@Component({
  selector: 'app-programs',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  overwritePrompt: { programIds: number[]; machineIds: number[]; names: string[] } | null = null;

  private statusTimer: any = null;

  constructor(
    private programService: ProgramService,
    private machinesService: MachinesService,
    private toast: ToastService,
    private socket: SocketService
  ) {}

  ngOnInit() {
    this.load();
    this.machinesService.getMachines({ page: 1, limit: 1000 }).subscribe({
      next: res => this.machines = (res.data || []).filter((m: any) => m.is_active)
    });

    this.socket.onTransferProgress(p => {
      this.progress.set(p.transfer_id, p);
      // drop the bar shortly after it completes so the list settles
      if (p.percent === 100) {
        setTimeout(() => this.progress.delete(p.transfer_id), 1500);
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
      next: res => { this.programs = res.data || []; this.total = res.total || 0; this.loading = false; },
      error: () => this.loading = false
    });
  }

  loadTransfers() {
    this.loading = true;
    this.programService.getTransfers({ page: this.page, limit: this.limit }).subscribe({
      next: res => { this.transfers = res.data || []; this.transfersTotal = res.total || 0; this.loading = false; },
      error: () => this.loading = false
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
      next: res => { this.machineOnline = !!res.data?.online; this.checkingStatus = false; },
      error: () => { this.machineOnline = false; this.checkingStatus = false; }
    });
  }

  loadMachineFiles() {
    if (!this.selectedMachineId) return;
    this.loadingFiles = true;
    this.programService.getMachineFiles(this.selectedMachineId, this.machineSearch).subscribe({
      next: res => { this.machineFiles = res.data || []; this.loadingFiles = false; },
      error: err => {
        this.machineFiles = [];
        this.loadingFiles = false;
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

    this.transferring = true;
    this.programService.transferBatch(programIds, machineIds, overwrite).subscribe({
      next: res => {
        this.transferring = false;
        this.overwritePrompt = null;

        const existing = (res.data?.results || []).filter((r: any) => r.status === 'EXISTS');
        if (existing.length) {
          // ask once, then resend the whole batch with overwrite
          this.overwritePrompt = {
            programIds, machineIds,
            names: existing.map((r: any) => r.program_name)
          };
          return;
        }

        if (res.data?.failed) this.toast.error(`${res.data.failed} of ${res.data.total} transfers failed`);
        else this.toast.success(res.message || 'Transfer complete');

        this.selectedProgramIds.clear();
        this.loadMachineFiles();
      },
      error: err => {
        this.transferring = false;
        this.toast.error(err.error?.message || 'Transfer failed');
      }
    });
  }

  confirmOverwrite() {
    if (!this.overwritePrompt) return;
    this.sendSelected(true);
  }

  cancelOverwrite() { this.overwritePrompt = null; }

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
        this.uploadFile = null;
        this.uploadName = '';
        this.uploadDescription = '';
        this.toast.success('Program uploaded');
        this.load();
      },
      error: err => {
        this.uploading = false;
        this.toast.error(err.error?.message || 'Upload failed');
      }
    });
  }

  deleteProgram(p: any) {
    if (!confirm(`Delete program "${p.name}"?`)) return;
    this.programService.delete(p.id).subscribe({
      next: () => { this.toast.success('Program deleted'); this.selectedProgramIds.delete(p.id); this.load(); },
      error: err => this.toast.error(err.error?.message || 'Delete failed')
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
