import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';

/* Phase 2 · Screen 1 — Factory Overall Dashboard.
   Filter metadata comes from charts/meta, which already returns the
   company's active machines and shifts in the shape the selects need. */
@Injectable({ providedIn: 'root' })
export class FactoryService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMeta(): Observable<any> {
    return this.http.get<any>(`${this.api}/charts/meta`);
  }

  getFactory(params: { date?: string; shift_id?: number | null; machine_id?: number | null }): Observable<any> {
    const query: any = {};
    if (params.date)       query.date       = params.date;
    if (params.shift_id)   query.shift_id   = params.shift_id;
    if (params.machine_id) query.machine_id = params.machine_id;
    return this.http.get<any>(`${this.api}/dashboard/factory`, { params: query });
  }
}
