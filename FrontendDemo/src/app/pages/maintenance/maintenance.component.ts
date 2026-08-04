import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MaintenanceService } from '../../core/services/maintenance.service';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './maintenance.component.html'
})
export class MaintenanceComponent implements OnInit {
  activeTab: 'schedules' | 'logs' | 'mttr' = 'schedules';
  schedules: any[] = [];
  logs: any[] = [];
  mttr: any[] = [];
  upcoming: any[] = [];
  loading = false;
  showForm = false;
  form: any = { title: '', machine_id: '', maintenance_type: 'PREVENTIVE', scheduled_at: '', estimated_duration_minutes: 60, assigned_to: '', recurrence: 'NONE' };
  logForm: any = { title: '', machine_id: '', maintenance_type: 'CORRECTIVE', started_at: '', completed_at: '', technician_name: '', work_performed: '', status: 'COMPLETED' };
  showLogForm = false;

  readonly types = ['PREVENTIVE', 'CORRECTIVE', 'PREDICTIVE', 'INSPECTION'];
  readonly statuses = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  readonly recurrences = ['NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY'];

  constructor(private svc: MaintenanceService) {}

  ngOnInit() { this.loadSchedules(); this.loadUpcoming(); }

  loadSchedules() {
    this.loading = true;
    this.svc.getSchedules().subscribe({ next: r => { this.schedules = r.data || []; this.loading = false; }, error: () => this.loading = false });
  }

  loadLogs() {
    this.loading = true;
    this.svc.getLogs().subscribe({ next: r => { this.logs = r.data || []; this.loading = false; }, error: () => this.loading = false });
  }

  loadMTTR() { this.svc.getMTTR().subscribe({ next: r => this.mttr = r.data || [] }); }
  loadUpcoming() { this.svc.getUpcoming(7).subscribe({ next: r => this.upcoming = r.data || [] }); }

  setTab(tab: typeof this.activeTab) {
    this.activeTab = tab;
    if (tab === 'logs') this.loadLogs();
    if (tab === 'mttr') this.loadMTTR();
  }

  saveSchedule() {
    this.svc.createSchedule(this.form).subscribe({
      next: () => { this.showForm = false; this.form = { title: '', machine_id: '', maintenance_type: 'PREVENTIVE', scheduled_at: '', estimated_duration_minutes: 60, assigned_to: '', recurrence: 'NONE' }; this.loadSchedules(); }
    });
  }

  saveLog() {
    this.svc.createLog(this.logForm).subscribe({
      next: () => { this.showLogForm = false; this.logForm = { title: '', machine_id: '', maintenance_type: 'CORRECTIVE', started_at: '', completed_at: '', technician_name: '', work_performed: '', status: 'COMPLETED' }; this.loadLogs(); }
    });
  }

  deleteSchedule(id: number) {
    if (!confirm('Remove this schedule?')) return;
    this.svc.deleteSchedule(id).subscribe({ next: () => this.loadSchedules() });
  }

  statusClass(s: string) {
    const m: any = { SCHEDULED: 'bg-blue-100 text-blue-700', IN_PROGRESS: 'bg-yellow-100 text-yellow-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-gray-100 text-gray-700', OVERDUE: 'bg-red-100 text-red-700' };
    return m[s] || 'bg-gray-100 text-gray-700';
  }
}
