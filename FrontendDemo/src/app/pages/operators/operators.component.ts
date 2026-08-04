import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OperatorService } from './operator.service';
import { OperatorFormComponent } from './operator-form.component';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-operators',
  templateUrl: './operators.component.html',
  styleUrl: './operators.component.scss',
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule, MatSlideToggleModule,
    MatInputModule, MatTooltipModule, MatProgressSpinnerModule,
    OperatorFormComponent
  ]
})
export class OperatorsComponent implements OnInit, OnDestroy {

  rows: any[] = [];
  displayedColumns = ['index', 'operator_code', 'operator_name', 'shift', 'machines', 'actions'];

  loading       = false;
  search        = '';
  page          = 1;
  limit         = 10;
  total         = 0;

  showModal     = false;
  modalData: any = null;

  deleteTarget: any = null;
  deleting          = false;
  deleteError       = '';

  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private service: OperatorService,
    private toast:   ToastService,
    private cdr:     ChangeDetectorRef,
    public auth:     AuthService
  ) {}

  ngOnInit() {
    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.page = 1;
      this.load();
    });
    this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load() {
    this.loading = true;
    this.service.getAll({
      page:   this.page,
      limit:  this.limit,
      search: this.search
    }).subscribe({
      next: (res: any) => {
        this.rows    = res.data || res;
        this.total   = res.meta?.total ?? this.rows.length;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => { this.loading = false; this.cdr.markForCheck(); }
    });
  }

  onSearchInput() { this.searchSubject.next(this.search); }

  onPage(e: any) {
    this.page  = e.pageIndex + 1;
    this.limit = e.pageSize;
    this.load();
  }

  rowIndex(i: number): number { return (this.page - 1) * this.limit + i + 1; }

  openCreate() { this.modalData = null; this.showModal = true; }

  openEdit(row: any) {
    this.service.getById(row.id).subscribe(res => {
      this.modalData = res.data;
      this.showModal = true;
      this.cdr.detectChanges();
    });
  }

  onSaved() {
    const wasEdit = !!this.modalData;
    this.showModal = false;
    this.load();
    this.toast.success(wasEdit ? 'Operator updated successfully' : 'Operator created successfully');
    this.modalData = null;
  }

  onClose() { this.showModal = false; this.modalData = null; }

  formatTime(time: string): string {
    if (!time) return '--';
    const [hour, minute] = time.split(':').map(Number);
    const h    = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
  }

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
        this.toast.success('Operator deleted successfully');
      },
      error: (err: any) => {
        this.deleting    = false;
        this.deleteError = err?.error?.message || 'Delete failed. Try again.';
        this.toast.error(this.deleteError);
      }
    });
  }
}
