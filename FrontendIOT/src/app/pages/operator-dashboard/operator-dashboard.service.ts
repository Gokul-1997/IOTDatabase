import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/* Phase 2 · Screen 7 — Operator Performance. */
@Injectable({ providedIn: 'root' })
export class OperatorDashboardService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  /** Only filters the user actually set — a blank one would otherwise
   *  narrow the query to rows with an empty value. */
  private toQuery(f: any): any {
    const q: any = {};
    for (const k of ['from', 'to', 'machine_id', 'shift_id', 'operator_id', 'search', 'page', 'limit']) {
      if (f[k] !== null && f[k] !== undefined && f[k] !== '') q[k] = f[k];
    }
    return q;
  }

  getOperators(filters: any): Observable<any> {
    return this.http.get<any>(`${this.api}/dashboard/operators`, { params: this.toQuery(filters) });
  }

  /** responseType 'blob': a JSON parse would corrupt xlsx and pdf bodies. */
  exportAs(format: 'xlsx' | 'csv' | 'pdf', filters: any): Observable<Blob> {
    const { page, limit, ...rest } = this.toQuery(filters);
    return this.http.get(`${this.api}/dashboard/operators/export/${format}`,
      { params: rest, responseType: 'blob' });
  }
}
