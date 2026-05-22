import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OperatorService {

  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ------------------------
  // OPERATORS
  // ------------------------
  getAll(params: any = {}) {
    return this.http.get<any>(`${this.api}/operators`, { params });
  }

  create(data: any) {
    return this.http.post(`${this.api}/operators`, data);
  }

  // ------------------------
  // SHIFTS (for dropdown)
  // ------------------------
  getShifts() {
    return this.http.get<any[]>(`${this.api}/shifts`);
  }

  // ------------------------
  // MACHINES (for assignment)
  // ------------------------
  getMachines() {
    return this.http.get<any>(`${this.api}/master/machines`);
  }

  // operator.service.ts

update(id: number, data: any) {
  return this.http.put(`${this.api}/operators/${id}`, data);
}

getById(id: number) {
  return this.http.get<any>(`${this.api}/operators/${id}`);
}

delete(id: number) {
  return this.http.delete(`${this.api}/operators/${id}`);
}
}

