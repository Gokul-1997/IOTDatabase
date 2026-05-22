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

import { PlantsService } from './plants.service';
import { PlantFormComponent } from './plant-form.component';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-plants',
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, MatProgressSpinnerModule, MatTooltipModule,
    PlantFormComponent
  ],
  templateUrl: './plants.component.html',
  styleUrl: './plants.component.scss'
})
export class PlantsComponent implements OnInit, OnDestroy {

  rows: any[]  = [];
  displayedColumns = ['index', 'plant_code', 'plant_name', 'location', 'is_active', 'actions'];

  search  = '';
  page    = 1;
  limit   = 10;
  total   = 0;
  loading = false;

  showForm  = false;
  editData: any = null;

  deleteTarget: any = null;
  deleting     = false;
  deleteError  = '';

  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private service: PlantsService,
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
    this.service.getPlants({ page: this.page, limit: this.limit, search: this.search })
      .subscribe({
        next: res => {
          this.rows    = res.data;
          this.total   = res.total;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load plants');
          this.cdr.markForCheck();
        }
      });
  }

  onSearchInput() { this.searchSubject.next(this.search); }

  onPage(e: any) {
    this.page  = e.pageIndex + 1;
    this.limit = e.pageSize;
    this.load();
  }

  openCreate() { this.editData = null; this.showForm = true; }
  openEdit(row: any) { this.editData = row; this.showForm = true; }

  onSaved() {
    const wasEdit = !!this.editData;
    this.showForm = false;
    this.load();
    this.toast.success(wasEdit ? 'Plant updated successfully' : 'Plant created successfully');
  }

  toggle(row: any) {
    this.service.toggleStatus(row.id, !row.is_active)
      .subscribe(() => { row.is_active = !row.is_active; this.cdr.markForCheck(); });
  }

  confirmDelete(row: any) { this.deleteTarget = row; this.deleteError = ''; }
  cancelDelete()          { this.deleteTarget = null; this.deleteError = ''; this.deleting = false; }

  doDelete() {
    // Plants service doesn't have delete - show message
    this.deleteError = 'Delete is not supported for plants.';
  }

  rowIndex(i: number): number { return (this.page - 1) * this.limit + i + 1; }
}
