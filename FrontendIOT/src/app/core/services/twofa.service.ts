import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TwofaService {
  private api = environment.apiUrl + '/auth/2fa';
  constructor(private http: HttpClient) {}

  getStatus() { return this.http.get<any>(`${this.api}/status`); }
  setup() { return this.http.post<any>(`${this.api}/setup`, {}); }
  enable(token: string) { return this.http.post<any>(`${this.api}/enable`, { token }); }
  disable() { return this.http.post<any>(`${this.api}/disable`, {}); }
  verify(token: string) { return this.http.post<any>(`${this.api}/verify`, { token }); }
}
