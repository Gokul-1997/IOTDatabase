import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 5 — Alarm Dashboard & Reports.
   Shares charts/meta with Screens 1–4 so every dashboard offers the same
   machine and shift lists rather than five subtly different ones. */
@Injectable({ providedIn: 'root' })
export class AlarmDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  /** Only filters the user actually set are sent — a blank one would
   *  otherwise narrow the query to rows with an empty value. */
  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'shift_id', 'alarm_type',
                     'alarm_code', 'severity', 'search', 'page', 'limit']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getAlarms(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/alarms`, { params: this.toQuery(filters) });
  }

  /** responseType 'blob' matters: the default JSON parse would corrupt an
   *  xlsx or pdf body before it reached the browser's save dialog. */
  exportAs(format: 'xlsx' | 'csv' | 'pdf', filters: any): Observable<Blob> {
    const { page, limit, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/alarms/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
