/**
 * Unit tests for AuthService — pure logic methods only.
 * HttpClient and Router are stubbed; no real HTTP calls are made.
 */

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

// ── helpers ──────────────────────────────────────────────────────────────────

function seedUser(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 1,
    email: 'test@example.com',
    roles: ['ADMIN'],
    permissions: ['page:dashboard', 'page:machines'],
    company_permissions: ['page:dashboard', 'page:machines:view'],
    user_type: 'ADMIN',
    company_id: 4,
    plan: { plan_code: 'PRO', tier: 2 },
    ...overrides
  };
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('token', 'fake-token');
  return user;
}

function clearSession() {
  localStorage.clear();
}

// ── setup ────────────────────────────────────────────────────────────────────

let service: AuthService;
let routerSpy: { navigate: ReturnType<typeof vi.fn> };

beforeEach(() => {
  clearSession();
  routerSpy = { navigate: vi.fn() };

  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
    providers: [
      AuthService,
      { provide: Router, useValue: routerSpy }
    ]
  });

  service = TestBed.inject(AuthService);
});

afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  clearSession();
});

// ── isLoggedIn ────────────────────────────────────────────────────────────────

describe('AuthService.isLoggedIn', () => {
  test('returns false when no token in localStorage', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  test('returns true when token exists in localStorage', () => {
    localStorage.setItem('token', 'some-jwt');
    expect(service.isLoggedIn()).toBe(true);
  });
});

// ── getUser ───────────────────────────────────────────────────────────────────

describe('AuthService.getUser', () => {
  test('returns empty object when no user in localStorage', () => {
    clearSession();
    expect(service.getUser()).toEqual({});
  });

  test('returns parsed user object', () => {
    seedUser({ email: 'me@example.com' });
    expect(service.getUser().email).toBe('me@example.com');
  });

  test('returns empty object when user JSON is corrupted', () => {
    localStorage.setItem('user', '{ not valid json !!');
    expect(service.getUser()).toEqual({});
  });
});

// ── getRoles / getPermissions ─────────────────────────────────────────────────

describe('AuthService.getRoles / getPermissions', () => {
  test('getRoles returns array from user', () => {
    seedUser({ roles: ['ADMIN', 'VIEWER'] });
    expect(service.getRoles()).toEqual(['ADMIN', 'VIEWER']);
  });

  test('getRoles returns [] when no user', () => {
    expect(service.getRoles()).toEqual([]);
  });

  test('getPermissions returns permissions array', () => {
    seedUser({ permissions: ['page:dashboard', 'page:machines'] });
    expect(service.getPermissions()).toEqual(['page:dashboard', 'page:machines']);
  });

  test('getPermissions returns [] when no user', () => {
    expect(service.getPermissions()).toEqual([]);
  });
});

// ── role helpers ──────────────────────────────────────────────────────────────

describe('AuthService role checks', () => {
  test('isSntSuper returns true for SNT_SUPER role', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.isSntSuper()).toBe(true);
  });

  test('isSntSuper returns false for ADMIN role', () => {
    seedUser({ roles: ['ADMIN'] });
    expect(service.isSntSuper()).toBe(false);
  });

  test('isCompanyAdmin returns true for COMPANY_ADMIN role', () => {
    seedUser({ roles: ['COMPANY_ADMIN'] });
    expect(service.isCompanyAdmin()).toBe(true);
  });

  test('isAdmin returns true for SNT_SUPER', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.isAdmin()).toBe(true);
  });

  test('isAdmin returns true for COMPANY_ADMIN', () => {
    seedUser({ roles: ['COMPANY_ADMIN'] });
    expect(service.isAdmin()).toBe(true);
  });

  test('isAdmin returns true for ADMIN role', () => {
    seedUser({ roles: ['ADMIN'] });
    expect(service.isAdmin()).toBe(true);
  });

  test('isAdmin returns false for plain VIEWER role', () => {
    seedUser({ roles: ['VIEWER'] });
    expect(service.isAdmin()).toBe(false);
  });
});

// ── hasPermission ─────────────────────────────────────────────────────────────

describe('AuthService.hasPermission', () => {
  test('SNT_SUPER always returns true', () => {
    seedUser({ roles: ['SNT_SUPER'], permissions: [] });
    expect(service.hasPermission('page:machines')).toBe(true);
  });

  test('exact match returns true for regular user', () => {
    seedUser({ roles: ['ADMIN'], permissions: ['page:dashboard'] });
    expect(service.hasPermission('page:dashboard')).toBe(true);
  });

  test('prefix match returns true (page:machines matches page:machines:view)', () => {
    seedUser({ roles: ['ADMIN'], permissions: ['page:machines:view'] });
    expect(service.hasPermission('page:machines')).toBe(true);
  });

  test('returns false when permission not in list', () => {
    seedUser({ roles: ['ADMIN'], permissions: ['page:dashboard'] });
    expect(service.hasPermission('page:machines')).toBe(false);
  });

  test('COMPANY_ADMIN with empty company_permissions returns true (no restrictions)', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.hasPermission('page:anything')).toBe(true);
  });

  test('COMPANY_ADMIN checks company_permissions list', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:dashboard'] });
    expect(service.hasPermission('page:dashboard')).toBe(true);
    expect(service.hasPermission('page:machines')).toBe(false);
  });
});

// ── hasAction ─────────────────────────────────────────────────────────────────

describe('AuthService.hasAction', () => {
  test('SNT_SUPER can do any action', () => {
    seedUser({ roles: ['SNT_SUPER'], permissions: [] });
    expect(service.hasAction('machines', 'create')).toBe(true);
  });

  test('exact key match: page:machines:create', () => {
    seedUser({ roles: ['ADMIN'], permissions: ['page:machines:create'] });
    expect(service.hasAction('machines', 'create')).toBe(true);
  });

  test('missing key returns false', () => {
    seedUser({ roles: ['ADMIN'], permissions: ['page:machines:view'] });
    expect(service.hasAction('machines', 'create')).toBe(false);
  });

  test('COMPANY_ADMIN with no company_permissions can do all actions', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.hasAction('machines', 'delete')).toBe(true);
  });

  test('COMPANY_ADMIN restricted by company_permissions', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:machines:view'] });
    expect(service.hasAction('machines', 'view')).toBe(true);
    expect(service.hasAction('machines', 'create')).toBe(false);
  });
});

// ── hasWidget ─────────────────────────────────────────────────────────────────

describe('AuthService.hasWidget', () => {
  test('SNT_SUPER can see all widgets', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(true);
  });

  test('COMPANY_ADMIN with no restrictions sees all widgets', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(true);
  });

  test('regular user sees widget when company allows and user has permission', () => {
    seedUser({
      roles: ['ADMIN'],
      permissions: ['page:dashboard:partcount'],
      company_permissions: ['page:dashboard:partcount']
    });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(true);
  });

  test('regular user blocked when company_permissions does not include widget', () => {
    seedUser({
      roles: ['ADMIN'],
      permissions: ['page:dashboard:partcount'],
      company_permissions: ['page:dashboard:oee']
    });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(false);
  });

  test('regular user blocked when they lack role permission', () => {
    seedUser({
      roles: ['ADMIN'],
      permissions: ['page:dashboard:oee'],
      company_permissions: []
    });
    expect(service.hasWidget('dashboard', 'partcount')).toBe(false);
  });
});

// ── getCompanyId / getPlan ─────────────────────────────────────────────────────

describe('AuthService.getCompanyId / getPlan', () => {
  test('getCompanyId returns company_id from user', () => {
    seedUser({ company_id: 42 });
    expect(service.getCompanyId()).toBe(42);
  });

  test('getCompanyId returns null when no user', () => {
    clearSession();
    expect(service.getCompanyId()).toBeNull();
  });

  test('getPlan returns plan object', () => {
    seedUser({ plan: { plan_code: 'BASIC', tier: 1 } });
    expect(service.getPlan()).toEqual({ plan_code: 'BASIC', tier: 1 });
  });

  test('getPlan returns null when no plan', () => {
    seedUser({ plan: undefined });
    expect(service.getPlan()).toBeNull();
  });
});

// ── getFirstAccessibleRoute ───────────────────────────────────────────────────

describe('AuthService.getFirstAccessibleRoute', () => {
  test('SNT_SUPER always goes to /admin/companies', () => {
    seedUser({ roles: ['SNT_SUPER'] });
    expect(service.getFirstAccessibleRoute()).toBe('/admin/companies');
  });

  test('COMPANY_ADMIN with no restrictions goes to /dashboard', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: [] });
    expect(service.getFirstAccessibleRoute()).toBe('/dashboard');
  });

  test('COMPANY_ADMIN routes to first matching company permission', () => {
    seedUser({
      roles: ['COMPANY_ADMIN'],
      company_permissions: ['page:oee-reports:view']
    });
    expect(service.getFirstAccessibleRoute()).toBe('/oee-reports');
  });

  test('regular user routes to first matching permission', () => {
    seedUser({
      roles: ['ADMIN'],
      permissions: ['page:machines:view']
    });
    expect(service.getFirstAccessibleRoute()).toBe('/machines');
  });

  test('regular user gets /no-access when no matching permissions', () => {
    seedUser({ roles: ['ADMIN'], permissions: [] });
    expect(service.getFirstAccessibleRoute()).toBe('/no-access');
  });

  test('COMPANY_ADMIN with no matching company_perms goes to /admin/users', () => {
    seedUser({ roles: ['COMPANY_ADMIN'], company_permissions: ['page:unknown'] });
    expect(service.getFirstAccessibleRoute()).toBe('/admin/users');
  });

  test('returns /no-access when localStorage is corrupted', () => {
    localStorage.setItem('user', '{{bad json}}');
    expect(service.getFirstAccessibleRoute()).toBe('/no-access');
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('AuthService.logout', () => {
  test('clears localStorage and navigates to /login', () => {
    const http = TestBed.inject(HttpTestingController);
    seedUser();

    service.logout();

    // drains the optional POST /logout call
    const req = http.match(r => r.url.includes('/auth/logout'));
    req.forEach(r => r.flush({}));

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('does not call logout API when no refreshToken stored', () => {
    const http = TestBed.inject(HttpTestingController);
    clearSession();

    service.logout();
    http.expectNone(r => r.url.includes('/auth/logout'));

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });
});

// ── getCompanyPermissions ─────────────────────────────────────────────────────

describe('AuthService.getCompanyPermissions', () => {
  test('returns company_permissions array from user', () => {
    seedUser({ company_permissions: ['page:dashboard', 'page:machines:view'] });
    expect(service.getCompanyPermissions()).toEqual(['page:dashboard', 'page:machines:view']);
  });

  test('returns [] when no user stored', () => {
    clearSession();
    expect(service.getCompanyPermissions()).toEqual([]);
  });
});
