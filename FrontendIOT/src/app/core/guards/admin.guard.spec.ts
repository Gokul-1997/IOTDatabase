/**
 * Unit tests for adminGuard (CanActivateFn).
 * Covers: SNT_SUPER, COMPANY_ADMIN, ADMIN allowed; VIEWER blocked; no user → /login.
 */

import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { adminGuard } from './admin.guard';

const fakeRoute = {} as ActivatedRouteSnapshot;
const fakeState = { url: '/admin' } as RouterStateSnapshot;

function runGuard() {
  return TestBed.runInInjectionContext(() => adminGuard(fakeRoute, fakeState));
}

function seedUser(roles: string[]) {
  localStorage.setItem('user', JSON.stringify({ roles }));
}

let routerSpy: { navigate: ReturnType<typeof vi.fn> };

beforeEach(() => {
  localStorage.clear();
  routerSpy = { navigate: vi.fn() };
  TestBed.configureTestingModule({
    providers: [{ provide: Router, useValue: routerSpy }]
  });
});

afterEach(() => localStorage.clear());

describe('adminGuard', () => {
  test('allows SNT_SUPER', () => {
    seedUser(['SNT_SUPER']);
    expect(runGuard()).toBe(true);
  });

  test('allows COMPANY_ADMIN', () => {
    seedUser(['COMPANY_ADMIN']);
    expect(runGuard()).toBe(true);
  });

  test('allows ADMIN', () => {
    seedUser(['ADMIN']);
    expect(runGuard()).toBe(true);
  });

  test('blocks VIEWER and redirects to /dashboard', () => {
    seedUser(['VIEWER']);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  test('blocks when no user in localStorage → redirects to /login', () => {
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('blocks when user JSON is corrupted → redirects to /login', () => {
    localStorage.setItem('user', '{ bad json }');
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('blocks when roles array is empty → redirects to /dashboard', () => {
    seedUser([]);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  test('allows user with multiple roles including ADMIN', () => {
    seedUser(['VIEWER', 'ADMIN']);
    expect(runGuard()).toBe(true);
  });
});
