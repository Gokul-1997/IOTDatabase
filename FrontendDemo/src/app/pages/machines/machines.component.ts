import {
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { MachinesService } from './machines.service';
import { MachineFormComponent } from './machine-form.component';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { Sort } from '@angular/material/sort';

// Maps Material sort column names → DB prefixed column names expected by backend
const SORT_MAP: Record<string, string> = {
  name:               'l.name',
  machine_serial_no:  'm.machine_serial_no',
  model:              'm.model',
  controller:         'm.controller',
  spindle_rpm:        'm.spindle_rpm',
  is_active:          'm.is_active'
};

@Component({
  standalone: true,
  selector: 'app-machines',
  imports: [
    CommonModule, FormsModule, MachineFormComponent,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, MatChipsModule, MatBadgeModule
  ],
  templateUrl: './machines.component.html',
  styleUrl: './machines.component.scss'
})
export class MachinesComponent implements OnInit, OnDestroy {

  rows: any[]  = [];
  displayedColumns = [
    'index',
    'name',
    'machine_serial_no',
    'model',
    'controller',
    'spindle_rpm',
    'x_axis',
    'y_axis',
    'z_axis',
    'fourth_axis',
    'fifth_axis',
    'twin_spindle',
    'twin_table',
    'atc_tool_capacity',
    'mmc_no',
    'image_url',
    'api_key',
    'is_active',
    'actions'
  ];

  search   = '';
  page     = 1;
  limit    = 10;
  total    = 0;
  loading  = false;

  sortBy  = 'm.id';
  sortDir: 'asc' | 'desc' = 'desc';

  showForm   = false;
  editData: any = null;

  deleteTarget: any = null;
  deleting     = false;
  deleteError  = '';

  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private service: MachinesService,
    private cdr:     ChangeDetectorRef,
    private toast:   ToastService,
    public  auth:    AuthService
  ) {}

  ngOnInit() {
    // Debounce search so backend is only hit 400ms after user stops typing
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
    this.service.getMachines({
      search:  this.search,
      page:    this.page,
      limit:   this.limit,
      sortBy:  this.sortBy,
      sortDir: this.sortDir
    }).subscribe({
      next: res => {
        this.rows    = res.data;
        this.total   = res.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load machines.');
        this.cdr.markForCheck();
      }
    });
  }

  onSearchInput() {
    this.searchSubject.next(this.search);
  }

  sortedColumn: string = '';
  onSort(e: any) {
    this.sortedColumn = e.direction ? e.active : '';
    if (!e.active || !e.direction) return;
    this.sortBy  = SORT_MAP[e.active] ?? 'm.id';
    this.sortDir = e.direction as 'asc' | 'desc';
    this.load();
  }
  
    isSorted(col: string) {
      return this.sortedColumn === col;
    }

  onPage(e: any) {
    this.page  = e.pageIndex + 1;
    this.limit = e.pageSize;
    this.load();
  }

  openCreate() {
    this.editData = null;
    this.showForm = true;
  }

  openEdit(row: any) {
    this.editData = row;
    this.showForm = true;
  }

  toggle(row: any) {
    this.service.toggle(row.id, !row.is_active)
      .subscribe(() => {
        row.is_active = !row.is_active;
        this.cdr.markForCheck();
      });
  }

  onSaved() {
    this.showForm = false;
    this.load();
    this.toast.success(this.editData ? 'Machine updated successfully' : 'Machine created successfully');
  }

  confirmDelete(row: any) {
    this.deleteTarget = row;
    this.deleteError  = '';
  }

  cancelDelete() {
    this.deleteTarget = null;
    this.deleteError  = '';
    this.deleting     = false;
  }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting    = true;
    this.deleteError = '';

    this.service.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting     = false;
        this.deleteTarget = null;
        this.load();
        this.toast.success('Machine deleted successfully');
      },
      error: (err: any) => {
        this.deleting    = false;
        this.deleteError = err?.error?.message || 'Delete failed. Try again.';
        this.toast.error(this.deleteError);
      }
    });
  }




  rowIndex(i: number): number {
    return (this.page - 1) * this.limit + i + 1;
  }

  copyApiKey(apiKey: string) {
    navigator.clipboard.writeText(apiKey).then(() => {
      this.toast.success('API Key copied to clipboard');
    }).catch(() => {
      this.toast.error('Failed to copy API Key');
    });
  }
}
