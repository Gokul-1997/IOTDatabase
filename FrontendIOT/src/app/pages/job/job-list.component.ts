import { Component, OnInit, ViewChild } from '@angular/core';
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

  @ViewChild('activePaginator')  activePaginator!:  MatPaginator;
  @ViewChild('historyPaginator') historyPaginator!: MatPaginator;

  constructor(private service: JobService, public auth: AuthService) {}

  ngOnInit() {
    this.loadActive();
    this.loadHistory();
  }

  loadActive() {
    this.service.getJobs().subscribe((res: any) => {
      this.activeSource.data = res.data || [];
      if (this.activePaginator) this.activeSource.paginator = this.activePaginator;
    });
  }

  loadHistory() {
    this.service.getJobHistory().subscribe((res: any) => {
      this.historySource.data = res.data || [];
      if (this.historyPaginator) this.historySource.paginator = this.historyPaginator;
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
        this.loadActive();
        this.loadHistory();
      },
      error: (err: any) => {
        this.stopping  = false;
        this.stopError = err?.error?.message || 'Failed to stop job.';
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
