import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 8 — OEE Dashboard. */
@Injectable({ providedIn: 'root' })
export class OeeDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'shift_id', 'search',
                     'threshold_good', 'threshold_fair', 'page', 'limit']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getOee(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/oee`, { params: this.toQuery(filters) });
  }

  exportAs(format: 'xlsx' | 'csv' | 'pdf', filters: any): Observable<Blob> {
    const { page, limit, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/oee/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
