import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PlantsService {
  private api = `${environment.apiUrl}/plants`;

  constructor(private http: HttpClient) {}

  getPlants(params: any) {
    return this.http.get<any>(this.api, { params });
  }

  createPlant(data: any) {
    return this.http.post(this.api, data);
  }

  updatePlant(id: number, data: any) {
    return this.http.put(`${this.api}/${id}`, data);
  }

  toggleStatus(id: number, is_active: boolean) {
    return this.http.patch(`${this.api}/${id}/status`, { is_active });
  }
}
