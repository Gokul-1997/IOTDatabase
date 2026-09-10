import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 4 — Periodic Maintenance.
   Shares charts/meta with Screens 1–3 so every dashboard offers the same
   machine list rather than four subtly different ones. */
@Injectable({ providedIn: 'root' })
export class PeriodicDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  getPeriodic(params: {
    machine_id?: number | null;
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Observable<any> {
    const query: any = {};
    if (params.machine_id) query.machine_id = params.machine_id;
    if (params.search)     query.search     = params.search;
    if (params.status)     query.status     = params.status;
    if (params.page)       query.page       = params.page;
    if (params.limit)      query.limit      = params.limit;
    return this.http.get<any>(`${this.api}/dashboard/periodic`, { params: query });
  }

  /* ── the plan itself ── */

  getSchedules(machineId?: number | null): Observable<any> {
    const params: any = {};
    if (machineId) params.machine_id = machineId;
    return this.http.get<any>(`${this.api}/dashboard/periodic/schedules`, { params });
  }

  saveSchedule(schedule: any): Observable<any> {
    return this.http.post<any>(`${this.api}/dashboard/periodic/schedules`, schedule);
  }

  deleteSchedule(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/dashboard/periodic/schedules/${id}`);
  }

  /** Raise the occurrences due now instead of waiting for the next cron tick. */
  runEngine(): Observable<any> {
    return this.http.post<any>(`${this.api}/dashboard/periodic/run`, {});
  }

  /**
   * Download an export.
   *
   * responseType 'blob' matters: the default JSON parse would corrupt an
   * xlsx or pdf body before it ever reached the browser's save dialog.
   */
  exportAs(format: 'xlsx' | 'csv' | 'pdf', params: {
    machine_id?: number | null; search?: string; status?: string;
  }): Observable<Blob> {
    const query: any = {};
    if (params.machine_id) query.machine_id = params.machine_id;
    if (params.search)     query.search     = params.search;
    if (params.status)     query.status     = params.status;
    return this.http.get(`${this.api}/dashboard/periodic/export/${format}`,
      { params: query, responseType: 'blob' });
  }
}
