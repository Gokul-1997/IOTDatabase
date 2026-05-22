import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LinesService } from './lines.service';
import { LineFormComponent } from './line-form.component';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-lines',
  templateUrl: './lines.component.html',
  styleUrl: './lines.component.scss',
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule,
    MatButtonModule, MatIconModule, MatInputModule,
    MatSlideToggleModule, MatProgressSpinnerModule, MatTooltipModule,
    LineFormComponent,
  ]
})
export class LinesComponent implements OnInit, OnDestroy {

  rows: any[] = [];
  displayedColumns = ['index', 'name', 'is_active', 'actions'];

  search = '';
  loading = false;

  showForm = false;
  editData: any = null;

  deleteTarget: any = null;
  deleting = false;
  deleteError = '';

  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(
    private service: LinesService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => this.filterRows());

    this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load() {
    this.loading = true;
    this.service.getLines().subscribe({
      next: (res: any) => {
        this.rows = res.data || res || [];
        this.filterRows();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toast.error('Failed to load lines');
        this.loading = false;
      }
    });
  }

  filterRows() {
    if (!this.search) {
      // No filtering needed
      return;
    }
    // Simple filter by name
    const search = this.search.toLowerCase();
    this.rows = this.rows.filter(r => (r.name || '').toLowerCase().includes(search));
  }

  onSearchInput() {
    this.searchSubject.next(this.search);
  }

  openCreate() {
    this.editData = null;
    this.showForm = true;
  }

  openEdit(row: any) {
    this.editData = row;
    this.showForm = true;
  }

  onSaved() {
    this.showForm = false;
    this.editData = null;
    this.load();
  }

  confirmDelete(row: any) {
    this.deleteTarget = row;
    this.deleteError = '';
  }

  cancelDelete() {
    this.deleteTarget = null;
    this.deleteError = '';
  }

  doDelete() {
    if (!this.deleteTarget) return;

    this.deleting = true;
    this.service.deleteLine(this.deleteTarget.id).subscribe({
      next: () => {
        this.toast.success('Line deleted');
        this.cancelDelete();
        this.load();
      },
      error: (err) => {
        this.deleteError = err.error?.message || 'Failed to delete line';
        this.deleting = false;
      }
    });
  }
}
