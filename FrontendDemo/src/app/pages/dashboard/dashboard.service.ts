import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DashboardService {

  private api = environment.apiUrl + '/dashboard';

  constructor(private http: HttpClient) {}

  getLive(page: number = 1, perPage: number = 8): Observable<any> {
    return this.http.get<any>(
      `${this.api}?page=${page}&per_page=${perPage}`
    );
  }

  getMachineDetail(machineId: number): Observable<any> {
    return this.http.get(`${this.api}/live/${machineId}`);
  }

}