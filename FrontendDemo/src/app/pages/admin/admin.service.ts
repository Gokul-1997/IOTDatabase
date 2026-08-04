import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ========== USERS ==========
  getUsers(): Observable<any> {
    return this.http.get(`${this.baseUrl}/users`);
  }

  getUserById(id: string | number): Observable<any> {
    return this.http.get(`${this.baseUrl}/users/${id}`);
  }

  createUser(data: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/users`, data);
  }

  updateUser(id: string | number, data: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/users/${id}`, data);
  }

  deleteUser(id: string | number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/users/${id}`);
  }

  // ========== COMPANIES (for dropdown) ==========
  getCompanies(): Observable<any> {
    return this.http.get(`${this.baseUrl}/companies`);
  }

  // ========== ROLES ==========
  getRoles(): Observable<any> {
    return this.http.get(`${this.baseUrl}/roles`);
  }

  getRoleById(id: string | number): Observable<any> {
    return this.http.get(`${this.baseUrl}/roles/${id}`);
  }

  createRole(data: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/roles`, data);
  }

  updateRole(id: string | number, data: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/roles/${id}`, data);
  }

  deleteRole(id: string | number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/roles/${id}`);
  }

  assignRolesToUser(userId: string | number, roleIds: number[]): Observable<any> {
    return this.http.post(`${this.baseUrl}/roles/assign/${userId}`, { role_ids: roleIds });
  }

  // ========== PERMISSIONS ==========
  getPermissions(): Observable<any> {
    return this.http.get(`${this.baseUrl}/roles/permissions/list`);
  }

  assignPermissionsToRole(roleId: string | number, permissionIds: number[]): Observable<any> {
    return this.http.put(`${this.baseUrl}/roles/${roleId}/permissions`, { permission_ids: permissionIds });
  }

  // ========== PAGE PERMISSIONS ==========
  getPagePermissions(): Observable<any> {
    return this.http.get(`${this.baseUrl}/roles/pages/list`);
  }

  seedPagePermissions(): Observable<any> {
    return this.http.post(`${this.baseUrl}/roles/pages/seed`, {});
  }
}
