import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 3 — Preventive Maintenance.
   Shares charts/meta with Screens 1 and 2 so all three offer the same
   machine and shift options. */
@Injectable({ providedIn: 'root' })
export class PreventiveDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  getPreventive(params: {
    date?: string;
    machine_id?: number | null;
    search?: string;
    page?: number;
    limit?: number;
  }): Observable<any> {
    const query: any = {};
    if (params.date)       query.date       = params.date;
    if (params.machine_id) query.machine_id = params.machine_id;
    if (params.search)     query.search     = params.search;
    if (params.page)       query.page       = params.page;
    if (params.limit)      query.limit      = params.limit;
    return this.http.get<any>(`${this.api}/dashboard/preventive`, { params: query });
  }

  /* ── threshold rules: what turns repeated alarms into PM tickets ── */

  getThresholds(): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/preventive/thresholds`);
  }

  saveThreshold(rule: any): Observable<any> {
    return this.http.post<any>(`${this.api}/dashboard/preventive/thresholds`, rule);
  }

  deleteThreshold(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/dashboard/preventive/thresholds/${id}`);
  }

  /** Evaluate the rules now instead of waiting for the next cron tick. */
  runEngine(): Observable<any> {
    return this.http.post<any>(`${this.api}/dashboard/preventive/run`, {});
  }
}
