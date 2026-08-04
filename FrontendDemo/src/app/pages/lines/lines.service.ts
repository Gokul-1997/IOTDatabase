import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class LinesService {
    private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getLines(): Observable<any> {
    return this.http.get(`${this.api}/lines`);
  }

  createLine(data: any): Observable<any> {
    return this.http.post(`${this.api}/lines`, data);
  }

  updateLine(id: number, data: any): Observable<any> {
    return this.http.put(`${this.api}/lines/${id}`, data);
  }

  deleteLine(id: number): Observable<any> {
    return this.http.delete(`${this.api}/lines/${id}`);
  }
}
