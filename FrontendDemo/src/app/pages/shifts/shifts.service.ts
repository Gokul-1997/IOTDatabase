import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ShiftsService {
  private api = environment.apiUrl + '/shifts';

  constructor(private http: HttpClient) { }

  getShifts() {
    return this.http.get<any>(`${this.api}`);
  }
  create(data: any) {
    return this.http.post(this.api, data);
  }
  toggle(id: number, status: boolean) {
    return this.http.patch(`${this.api}/${id}/status`, {
      is_active: status
    });
  }
  update(id: number, data: any) {
    return this.http.put(`${this.api}/${id}`, data);
  }

  delete(id: number) {
    return this.http.delete(`${this.api}/${id}`);
  }
}
