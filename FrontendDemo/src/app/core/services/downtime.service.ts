import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DowntimeService {
  private api = environment.apiUrl + '/downtime';
  constructor(private http: HttpClient) {}

  getReasons() { return this.http.get<any>(`${this.api}/reasons`); }
  createReason(data: any) { return this.http.post<any>(`${this.api}/reasons`, data); }
  updateReason(id: number, data: any) { return this.http.put<any>(`${this.api}/reasons/${id}`, data); }
  getEvents(params: any = {}) { return this.http.get<any>(`${this.api}/events`, { params }); }
  logEvent(data: any) { return this.http.post<any>(`${this.api}/events`, data); }
  getSummary(params: any = {}) { return this.http.get<any>(`${this.api}/summary`, { params }); }
}
