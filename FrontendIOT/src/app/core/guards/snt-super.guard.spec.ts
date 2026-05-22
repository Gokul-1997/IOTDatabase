/**
 * Unit tests for sntSuperGuard (CanActivateFn).
 * Only SNT_SUPER role passes; all others are redirected to /admin/users.
 */

import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { sntSuperGuard } from './snt-super.guard';

const fakeRoute = {} as ActivatedRouteSnapshot;
const fakeState = { url: '/admin/companies' } as RouterStateSnapshot;

function runGuard() {
  return TestBed.runInInjectionContext(() => sntSuperGuard(fakeRoute, fakeState));
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

describe('sntSuperGuard', () => {
  test('allows SNT_SUPER', () => {
    seedUser(['SNT_SUPER']);
    expect(runGuard()).toBe(true);
  });

  test('blocks COMPANY_ADMIN → redirects to /admin/users', () => {
    seedUser(['COMPANY_ADMIN']);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/admin/users']);
  });

  test('blocks ADMIN → redirects to /admin/users', () => {
    seedUser(['ADMIN']);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/admin/users']);
  });

  test('blocks VIEWER → redirects to /admin/users', () => {
    seedUser(['VIEWER']);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/admin/users']);
  });

  test('blocks empty roles → redirects to /admin/users', () => {
    seedUser([]);
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/admin/users']);
  });

  test('blocks when no user in localStorage → redirects to /login', () => {
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('blocks when user JSON is corrupted → redirects to /login', () => {
    localStorage.setItem('user', 'NOT JSON');
    expect(runGuard()).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });
});
