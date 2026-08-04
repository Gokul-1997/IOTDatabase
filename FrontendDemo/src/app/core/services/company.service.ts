import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ── Companies ──────────────────────────────────
  getCompanies(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/companies`);
  }

  getCompany(id: number): Observable<any> {
    return this.http.get<any>(`${this.api}/companies/${id}`);
  }

  createCompany(data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/companies`, data);
  }

  updateCompany(id: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/companies/${id}`, data);
  }

  deleteCompany(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/companies/${id}`);
  }

  permanentDeleteCompany(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/companies/${id}/permanent`);
  }

  assignPlan(companyId: number, data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/companies/${companyId}/plan`, data);
  }

  getPlanFeatures(companyId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/companies/${companyId}/plan-features`);
  }

  // ── Plans ──────────────────────────────────────
  getPlans(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/plans`);
  }

  getPlan(id: number): Observable<any> {
    return this.http.get<any>(`${this.api}/plans/${id}`);
  }

  createPlan(data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/plans`, data);
  }

  updatePlan(id: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/plans/${id}`, data);
  }

  // ── Company Plants (SNT_SUPER manages plants per company) ──
  getCompanyPlants(companyId: number, params?: any): Observable<any> {
    return this.http.get<any>(`${this.api}/companies/${companyId}/plants`, { params });
  }

  createCompanyPlant(companyId: number, data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/companies/${companyId}/plants`, data);
  }

  updateCompanyPlant(companyId: number, plantId: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/companies/${companyId}/plants/${plantId}`, data);
  }

  toggleCompanyPlantStatus(companyId: number, plantId: number, is_active: boolean): Observable<any> {
    return this.http.patch<any>(`${this.api}/companies/${companyId}/plants/${plantId}/status`, { is_active });
  }

  // ── Permissions ────────────────────────────────
  getGroupedPermissions(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/plans/permissions`);
  }

  seedPermissions(): Observable<any> {
    return this.http.post<any>(`${this.api}/plans/permissions/seed`, {});
  }

  // ── Company Permissions (page access per company) ─
  getCompanyPermissions(companyId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/companies/${companyId}/permissions`);
  }

  assignCompanyPermissions(companyId: number, permissionIds: number[]): Observable<any> {
    return this.http.put<any>(`${this.api}/companies/${companyId}/permissions`, { permission_ids: permissionIds });
  }
}
