import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProductionPlanService {
  private api = environment.apiUrl + '/production-plans';
  constructor(private http: HttpClient) {}

  getPlans(params: any = {}) { return this.http.get<any>(this.api, { params }); }
  createPlan(data: any) { return this.http.post<any>(this.api, data); }
  updatePlan(id: number, data: any) { return this.http.put<any>(`${this.api}/${id}`, data); }
  deletePlan(id: number) { return this.http.delete(`${this.api}/${id}`); }
  getVariance(params: any = {}) { return this.http.get<any>(`${this.api}/variance`, { params }); }
}
