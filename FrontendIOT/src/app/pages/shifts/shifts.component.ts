import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ShiftsService } from './shifts.service';
import { ShiftFormComponent } from './shift-form.component';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-shifts',
  templateUrl: './shifts.component.html',
  styleUrl: './shifts.component.scss',
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, MatProgressSpinnerModule, MatTooltipModule,
    ShiftFormComponent,
  ]
})
export class ShiftsComponent implements OnInit, OnDestroy {

  rows: any[]         = [];
  filteredRows: any[] = [];
  pagedRows: any[]    = [];

  displayedColumns = ['index', 'shift_code', 'shift_name', 'time', 'break_minutes', 'is_active', 'actions'];

  search  = '';
  loading = false;
  page    = 0;
  limit   = 10;

  showModal = false;
  modalData: any = null;

  deleteTarget: any = null;
  deleting          = false;
  deleteError       = '';

  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private service: ShiftsService,
    private toast:   ToastService,
    private cdr:     ChangeDetectorRef,
    public auth:     AuthService
  ) {}

  ngOnInit() {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => this.applyFilter());

    this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load() {
    this.loading = true;
    this.service.getShifts().subscribe({
      next: res => {
        this.rows    = res.data;
        this.loading = false;
        this.applyFilter();
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; }
    });
  }

  onSearchInput() { this.searchSubject.next(this.search); }

  applyFilter() {
    const val = this.search.toLowerCase();
    this.filteredRows = val
      ? this.rows.filter(r =>
          r.shift_code.toLowerCase().includes(val) ||
          (r.shift_name || '').toLowerCase().includes(val))
      : [...this.rows];
    this.page = 0;
    this.updatePage();
  }

  onPage(e: any) {
    this.page  = e.pageIndex;
    this.limit = e.pageSize;
    this.updatePage();
  }

  updatePage() {
    const start    = this.page * this.limit;
    this.pagedRows = this.filteredRows.slice(start, start + this.limit);
  }

  rowIndex(i: number) { return this.page * this.limit + i + 1; }

  formatTime(time: string): string {
    if (!time) return '--';
    const [hour, minute] = time.split(':').map(Number);
    const h    = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
  }

  openCreate() { this.modalData = null; this.showModal = true; }
  openEdit(row: any) { this.modalData = row; this.showModal = true; }

  onSaved() {
    const wasEdit = !!this.modalData;
    this.showModal = false;
    this.modalData = null;
    this.load();
    this.toast.success(wasEdit ? 'Shift updated successfully' : 'Shift created successfully');
  }

  onClose() { this.showModal = false; this.modalData = null; }

  confirmDelete(row: any) { this.deleteTarget = row; this.deleteError = ''; }
  cancelDelete()          { this.deleteTarget = null; this.deleteError = ''; this.deleting = false; }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting    = true;
    this.deleteError = '';
    this.service.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting     = false;
        this.deleteTarget = null;
        this.load();
        this.toast.success('Shift deleted successfully');
      },
      error: (err: any) => {
        this.deleting    = false;
        this.deleteError = err?.error?.message || 'Failed to delete shift';
        this.toast.error(this.deleteError);
      }
    });
  }

  toggle(row: any) {
    this.service.toggle(row.id, !row.is_active)
      .subscribe(() => { row.is_active = !row.is_active; this.cdr.markForCheck(); });
  }
}
