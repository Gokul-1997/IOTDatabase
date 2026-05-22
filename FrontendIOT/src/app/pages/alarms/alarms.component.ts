import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlarmService } from '../../core/services/alarm.service';

@Component({
  selector: 'app-alarms',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './alarms.component.html'
})
export class AlarmsComponent implements OnInit {
  alarms: any[] = [];
  pagination: any = {};
  loading = false;
  filter = { is_resolved: 'false', machine_id: '', page: 1, limit: 20 };
  resolveNote = '';
  resolvingId: number | null = null;

  constructor(private alarmService: AlarmService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params: any = { ...this.filter };
    Object.keys(params).forEach(k => !params[k] && delete params[k]);
    this.alarmService.getAlarms(params).subscribe({
      next: res => { this.alarms = res.data || []; this.pagination = res.pagination || {}; this.loading = false; },
      error: () => this.loading = false
    });
  }

  resolve(id: number) {
    this.alarmService.resolveAlarm(id, this.resolveNote).subscribe({
      next: () => { this.resolvingId = null; this.resolveNote = ''; this.load(); }
    });
  }

  severityClass(severity: string) {
    const map: any = { CRITICAL: 'bg-red-100 text-red-700', HIGH: 'bg-orange-100 text-orange-700', MEDIUM: 'bg-yellow-100 text-yellow-700', LOW: 'bg-blue-100 text-blue-700' };
    return map[severity] || 'bg-gray-100 text-gray-700';
  }
}
