import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 9 — Energy Monitoring. */
@Injectable({ providedIn: 'root' })
export class EnergyDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'search', 'page', 'limit']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getEnergy(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/energy`, { params: this.toQuery(filters) });
  }

  getSettings(): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/energy/settings`);
  }

  saveSettings(s: any): Observable<any> {
    return this.http.post<any>(`${this.api}/dashboard/energy/settings`, s);
  }

  exportAs(format: 'xlsx' | 'csv' | 'pdf', filters: any): Observable<Blob> {
    const { page, limit, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/energy/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
