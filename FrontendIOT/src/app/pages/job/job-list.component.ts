import { ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { JobService } from './job.service';
import { JobCreateModalComponent } from './job-create-modal.component';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-job-list',
  imports: [
    CommonModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule,
    JobCreateModalComponent
  ],
  templateUrl: './job-list.component.html'
})
export class JobListComponent implements OnInit {

  activeColumns  = ['machine', 'part', 'target', 'started_at', 'action'];
  historyColumns = ['machine', 'part', 'target', 'started_at', 'ended_at', 'status'];

  activeSource  = new MatTableDataSource<any>();
  historySource = new MatTableDataSource<any>();

  showModal     = false;
  tab: 'active' | 'history' = 'active';

  // Stop confirmation
  confirmRow:  any    = null;
  stopping     = false;
  stopError    = '';

  /*
   * Setter-based ViewChild, not a plain one.
   *
   * Each paginator lives inside an *ngIf on the tab, so on first load only
   * the active one exists — historyPaginator was undefined when loadHistory()
   * ran, the `if (this.historyPaginator)` guard silently skipped the
   * assignment, and nothing ever re-attached it when the tab was switched.
   * History pagination could therefore never work. Active had the same race
   * against ngAfterViewInit.
   *
   * A setter fires every time the view creates or destroys the element, so
   * the paginator attaches whenever its tab is shown, however late that is.
   */
  @ViewChild('activePaginator') set activePaginator(p: MatPaginator) {
    if (p) { this.activeSource.paginator = p; this.cdr.markForCheck(); }
  }

  @ViewChild('historyPaginator') set historyPaginator(p: MatPaginator) {
    if (p) { this.historySource.paginator = p; this.cdr.markForCheck(); }
  }

  constructor(
    private service: JobService,
    public auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadActive();
    this.loadHistory();
  }

  /** Switch which list is on screen. */
  setTab(tab: 'active' | 'history') {
    this.tab = tab;
    this.cdr.markForCheck();
  }

  /*
   * The app runs zoneless (Angular 21, no zone.js), so assigning .data inside
   * an HTTP callback schedules no render on its own — the tables stayed empty
   * until the user happened to click something else.
   */
  loadActive() {
    this.service.getJobs().subscribe({
      next: (res: any) => { this.activeSource.data = res.data || []; this.cdr.markForCheck(); },
      error: () => { this.activeSource.data = []; this.cdr.markForCheck(); }
    });
  }

  loadHistory() {
    this.service.getJobHistory().subscribe({
      next: (res: any) => { this.historySource.data = res.data || []; this.cdr.markForCheck(); },
      error: () => { this.historySource.data = []; this.cdr.markForCheck(); }
    });
  }

  openCreate() { this.showModal = true; }

  closeModal() {
    this.showModal = false;
    this.loadActive();
    this.loadHistory();
  }

  // Show confirmation dialog
  requestStop(row: any) {
    this.confirmRow = row;
    this.stopError  = '';
  }

  cancelStop() {
    this.confirmRow = null;
    this.stopping   = false;
    this.stopError  = '';
  }

  confirmStop() {
    if (!this.confirmRow) return;
    this.stopping  = true;
    this.stopError = '';

    this.service.stopJob(this.confirmRow.machine_id).subscribe({
      next: () => {
        this.stopping   = false;
        this.confirmRow = null;
        this.cdr.markForCheck();
        this.loadActive();
        this.loadHistory();
      },
      error: (err: any) => {
        this.stopping  = false;
        this.stopError = err?.error?.message || 'Failed to stop job.';
        this.cdr.markForCheck();
      }
    });
  }

  fmt(dt: string | null): string {
    if (!dt) return '--';
    const d   = new Date(dt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
