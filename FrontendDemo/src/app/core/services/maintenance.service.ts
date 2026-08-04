import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MaintenanceService {
  private api = environment.apiUrl + '/maintenance';
  constructor(private http: HttpClient) {}

  getSchedules(params: any = {}) { return this.http.get<any>(`${this.api}/schedules`, { params }); }
  createSchedule(data: any) { return this.http.post<any>(`${this.api}/schedules`, data); }
  updateSchedule(id: number, data: any) { return this.http.put<any>(`${this.api}/schedules/${id}`, data); }
  deleteSchedule(id: number) { return this.http.delete(`${this.api}/schedules/${id}`); }
  getLogs(params: any = {}) { return this.http.get<any>(`${this.api}/logs`, { params }); }
  createLog(data: any) { return this.http.post<any>(`${this.api}/logs`, data); }
  getUpcoming(days = 7) { return this.http.get<any>(`${this.api}/upcoming`, { params: { days } }); }
  getMTTR(params: any = {}) { return this.http.get<any>(`${this.api}/mttr`, { params }); }
}
