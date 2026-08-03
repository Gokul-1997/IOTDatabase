import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgramService } from '../../core/services/program.service';
import { MachinesService } from '../machines/machines.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-programs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './programs.component.html'
})
export class ProgramsComponent implements OnInit {
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

  // upload form
  showUpload = false;
  uploadFile: File | null = null;
  uploadName = '';
  uploadDescription = '';
  uploading = false;

  // transfer modal
  transferProgram: any = null;
  selectedMachineId: number | null = null;
  transferring = false;

  constructor(
    private programService: ProgramService,
    private machinesService: MachinesService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.load();
    this.machinesService.getMachines({ page: 1, limit: 1000 }).subscribe({
      next: res => this.machines = (res.data || []).filter((m: any) => m.is_active)
    });
  }

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
      next: () => { this.toast.success('Program deleted'); this.load(); },
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

  openTransfer(p: any) {
    this.transferProgram = p;
    this.selectedMachineId = null;
  }

  doTransfer() {
    if (!this.selectedMachineId) { this.toast.error('Please select a machine'); return; }
    this.transferring = true;
    this.programService.transfer(this.transferProgram.id, this.selectedMachineId).subscribe({
      next: () => {
        this.transferring = false;
        this.transferProgram = null;
        this.toast.success('Program transferred to machine');
      },
      error: err => {
        this.transferring = false;
        this.transferProgram = null;
        this.toast.error(err.error?.message || 'Transfer failed');
        // failure is recorded in transfer history for diagnosis
      }
    });
  }

  fileSize(bytes: number): string {
    if (bytes == null) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
