import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { jwtDecode } from 'jwt-decode';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private api = environment.apiUrl + '/auth';
  private refreshTimer: any;

  constructor(private http: HttpClient, private router: Router) {}

  private setSession(res: any): void {
    localStorage.setItem('token', res.accessToken);
    localStorage.setItem('refreshToken', res.refreshToken);
    localStorage.setItem('user', JSON.stringify(res.user));
    this.scheduleRefresh(res.accessToken);
  }

  login(data: any) {
    return this.http.post<any>(`${this.api}/login`, data).pipe(
      tap(res => this.setSession(res))
    );
  }

  refreshToken() {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.http.post<any>(`${this.api}/refresh`, { refreshToken }).pipe(
      tap(res => {
        localStorage.setItem('token', res.accessToken);
        this.scheduleRefresh(res.accessToken);
      })
    );
  }

  logout(): void {
    clearTimeout(this.refreshTimer);
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      this.http.post(`${this.api}/logout`, { refreshToken }).subscribe({ error: () => {} });
    }
    localStorage.clear();
    this.router.navigate(['/login']);
  }

  scheduleRefresh(token: string): void {
    clearTimeout(this.refreshTimer);
    try {
      const decoded: any = jwtDecode(token);
      const refreshTime = decoded.exp * 1000 - Date.now() - 60_000;
      if (refreshTime <= 0) return;
      this.refreshTimer = setTimeout(() => this.refreshToken().subscribe(), refreshTime);
    } catch { this.logout(); }
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  // ── User Context Helpers ───────────────────────
  getUser(): any {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  }

  getRoles(): string[] {
    return this.getUser().roles || [];
  }

  getPermissions(): string[] {
    return this.getUser().permissions || [];
  }

  isSntSuper(): boolean {
    return this.getRoles().includes('SNT_SUPER');
  }

  isCompanyAdmin(): boolean {
    return this.getRoles().includes('COMPANY_ADMIN');
  }

  isAdmin(): boolean {
    const roles = this.getRoles();
    return roles.includes('SNT_SUPER') || roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN');
  }

  getCompanyId(): number | null {
    return this.getUser().company_id || null;
  }

  getPlan(): any {
    return this.getUser().plan || null;
  }

  /** Permissions the company is allowed (set by super user). */
  getCompanyPermissions(): string[] {
    return this.getUser().company_permissions || [];
  }

  /**
   * Check if user has a specific permission.
   * Admins always return true.
   * Also matches `page:machines` if user has `page:machines:view`.
   */
  hasPermission(permission: string): boolean {
    if (this.isSntSuper()) return true;
    // Company admin: check company_permissions
    if (this.isCompanyAdmin()) {
      const companyPerms = this.getCompanyPermissions();
      if (companyPerms.length === 0) return true; // fresh company, no restrictions
      return companyPerms.includes(permission) || companyPerms.some(p => p.startsWith(permission + ':'));
    }
    const perms = this.getPermissions();
    if (perms.includes(permission)) return true;
    return perms.some(p => p.startsWith(permission + ':'));
  }

  /**
   * Check if user has a specific CRUD action on a page.
   * e.g. hasAction('machines', 'create')
   * Company admins check company_permissions; regular users check their role permissions.
   */
  hasAction(module: string, action: string): boolean {
    if (this.isSntSuper()) return true;
    const key = `page:${module}:${action}`;

    // Company admin: check company_permissions (what super user allowed)
    if (this.isCompanyAdmin()) {
      const companyPerms = this.getCompanyPermissions();
      return companyPerms.length === 0 || companyPerms.includes(key);
    }

    // Regular user: check their role permissions
    return this.getPermissions().includes(key);
  }

  /**
   * Check if a widget/section is visible for this user's company.
   * First checks company_permissions (what super user allowed),
   * then checks user's own role permissions.
   * e.g. hasWidget('dashboard', 'partcount')
   */
  hasWidget(module: string, widget: string): boolean {
    if (this.isSntSuper()) return true;
    const key = `page:${module}:${widget}`;
    const companyPerms = this.getCompanyPermissions();
    // Company admin sees everything their company has access to
    if (this.isCompanyAdmin()) {
      return companyPerms.length === 0 || companyPerms.includes(key);
    }
    // Regular users: check company-level access first, then role permissions
    if (companyPerms.length > 0 && !companyPerms.includes(key)) return false;
    return this.getPermissions().includes(key);
  }

  /** Returns the first route the user has permission for. */
  getFirstAccessibleRoute(): string {
    try {
      // SNT_SUPER only accesses admin pages
      if (this.isSntSuper()) return '/admin/companies';

      // COMPANY_ADMIN: find first page from company_permissions
      if (this.isCompanyAdmin()) {
        const companyPerms = this.getCompanyPermissions();
        if (companyPerms.length === 0) return '/dashboard';
        const pageRoutes = [
          { permission: 'page:dashboard',      path: '/dashboard' },
          { permission: 'page:oee-reports',     path: '/oee-reports' },
          { permission: 'page:reports',         path: '/reports' },
          { permission: 'page:charts',          path: '/charts' },
          { permission: 'page:quality',         path: '/quality' },
          { permission: 'page:machines',        path: '/machines' },
        ];
        const first = pageRoutes.find(r =>
          companyPerms.some(p => p.startsWith(r.permission))
        );
        return first ? first.path : '/admin/users';
      }

      const permissions = this.getPermissions();
      const pageRoutes = [
        { permission: 'page:dashboard',      path: '/dashboard' },
        { permission: 'page:oee-reports',     path: '/oee-reports' },
        { permission: 'page:reports',         path: '/reports' },
        { permission: 'page:charts',          path: '/charts' },
        { permission: 'page:quality',         path: '/quality' },
        { permission: 'page:machines',        path: '/machines' },
        { permission: 'page:component',       path: '/component' },
        { permission: 'page:job',             path: '/job' },
        { permission: 'page:shifts',          path: '/shifts' },
        { permission: 'page:operators',       path: '/operators' },
        { permission: 'page:assignments',     path: '/assignments' },
        { permission: 'page:machine-shifts',  path: '/machine-shifts' },
        { permission: 'page:plants',          path: '/plants' },
      ];

      const first = pageRoutes.find(r =>
        permissions.includes(r.permission) || permissions.some(p => p.startsWith(r.permission + ':'))
      );
      return first ? first.path : '/no-access';
    } catch {
      return '/no-access';
    }
  }

  forgotPassword(email: string) {
    return this.http.post(`${this.api}/forgot-password`, { email });
  }

  resetPassword(token: string, password: string) {
    return this.http.post(`${this.api}/reset-password`, { token, password });
  }
}
