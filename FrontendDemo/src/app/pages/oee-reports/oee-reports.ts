import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OeeReportsService } from './oee.service';
import { AuthService } from '../../core/services/auth.service';
import { Subject, takeUntil } from 'rxjs';

import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  standalone: true,
  selector: 'app-oee-reports',
  imports: [
    CommonModule, FormsModule,
    MatPaginatorModule, MatProgressSpinnerModule,
    MatIconModule, MatButtonModule, MatTooltipModule
  ],
  templateUrl: './oee-reports.html',
  styleUrl: './oee-reports.scss'
})
export class OeeReportsComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  Math = Math;

  lines: any[]             = [];
  machines: any[]          = [];
  filteredMachines: any[]  = [];
  shifts: any[]            = [];
  rows: any[]              = [];

  selectedLine: number | null    = null;
  selectedMachine: number | null = null;
  selectedShift: number | null   = null;
  searchText = '';
  fromDate   = '';
  toDate     = '';

  page  = 1;
  limit = 10;
  total = 0;

  sortBy    = 'shift_date';
  sortOrder: 'ASC' | 'DESC' = 'DESC';

  today = this.getTodayLocal();

  loading     = false;
  exporting   = false;
  loadingMeta = false;
  error       = '';

  constructor(private service: OeeReportsService, private cdr: ChangeDetectorRef, public auth: AuthService) {}

  ngOnInit(): void {
    this.fromDate = this.getTodayLocal();
    this.toDate   = this.getTodayLocal();
    this.loadMeta();
  }

  private loadMeta(): void {
    this.loadingMeta = true;
    this.service.getMeta()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.lines            = res.data.lines    || [];
          this.machines         = res.data.machines || [];
          this.shifts           = res.data.shifts   || [];
          this.filteredMachines = [...this.machines];
          this.loadingMeta      = false;
          this.cdr.detectChanges();
          this.loadReports();
        },
        error: (err: any) => {
          this.error       = err.error?.message || 'Failed to load metadata';
          this.loadingMeta = false;
          this.cdr.detectChanges();
        }
      });
  }

  loadReports(): void {
    if (this.loadingMeta) return;
    this.loading = true;
    this.error   = '';

    const filters = {
      line_id:    this.selectedLine,
      machine_id: this.selectedMachine,
      shift_id:   this.selectedShift,
      from_date:  this.fromDate,
      to_date:    this.toDate,
      search:     this.searchText,
      page:       this.page,
      limit:      this.limit,
      sort_by:    this.sortBy,
      sort_order: this.sortOrder
    };

    this.service.getReports(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          this.rows    = res.data || [];
          this.total   = res.pagination?.total || 0;
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: (err: any) => {
          this.error   = err.error?.message || 'Failed to load reports';
          this.loading = false;
          this.cdr.detectChanges();
        }
      });
  }

  onLineChange(): void {
    this.selectedMachine  = null;
    this.filteredMachines = this.selectedLine
      ? this.machines.filter(m => m.line_id == this.selectedLine)
      : [...this.machines];
    this.page = 1;
    this.loadReports();
  }

  onMachineChange(): void { this.page = 1; this.loadReports(); }
  onShiftChange():   void { this.page = 1; this.loadReports(); }
  onDateChange():    void { this.page = 1; this.loadReports(); }
  onSearch():        void { this.page = 1; this.loadReports(); }

  /** mat-paginator emits PageEvent */
  onPage(e: PageEvent): void {
    this.page  = e.pageIndex + 1;
    this.limit = e.pageSize;
    this.loadReports();
  }

  clearFilters(): void {
    this.selectedLine     = null;
    this.selectedMachine  = null;
    this.selectedShift    = null;
    this.searchText       = '';
    this.fromDate         = this.getTodayLocal();
    this.toDate           = this.getTodayLocal();
    this.page             = 1;
    this.filteredMachines = [...this.machines];
    this.loadReports();
  }

  changeSort(column: string): void {
    if (this.sortBy === column) {
      this.sortOrder = this.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.sortBy    = column;
      this.sortOrder = 'ASC';
    }
    this.page = 1;
    this.loadReports();
  }

  getSortIcon(column: string): string {
    if (this.sortBy !== column) return '⇅';
    return this.sortOrder === 'ASC' ? '↑' : '↓';
  }

  exportCSV(): void {
    this.exporting = true;
    this.service.exportCSV({
      line_id:    this.selectedLine,
      machine_id: this.selectedMachine,
      shift_id:   this.selectedShift,
      from_date:  this.fromDate,
      to_date:    this.toDate,
      search:     this.searchText
    });
    setTimeout(() => this.exporting = false, 1000);
  }

  getTodayLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '--';
    const d    = new Date(dateStr);
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  getOeeColor(oee: number): string {
    if (oee >= 85) return '#10b981';
    if (oee >= 75) return '#3b82f6';
    if (oee >= 60) return '#f59e0b';
    return '#ef4444';
  }

  getBarWidth(value: number): string {
    return `${Math.min(value || 0, 100)}%`;
  }

  rowIndex(i: number): number { return (this.page - 1) * this.limit + i + 1; }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
