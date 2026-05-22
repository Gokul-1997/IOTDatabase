import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AlarmService {
  private api = environment.apiUrl + '/alarms';
  constructor(private http: HttpClient) {}

  getAlarms(params: any = {}) { return this.http.get<any>(this.api, { params }); }
  resolveAlarm(id: number, note: string) { return this.http.patch(`${this.api}/${id}/resolve`, { resolution_note: note }); }
  getPreferences() { return this.http.get<any>(`${this.api}/preferences`); }
  updatePreferences(prefs: any) { return this.http.put<any>(`${this.api}/preferences`, prefs); }
}
