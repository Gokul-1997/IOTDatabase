/**
 * Unit tests for authGuard (CanActivateFn).
 * Tests that the guard allows/blocks navigation based on localStorage token.
 */

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { authGuard } from './auth.guard';

const fakeRoute = {} as ActivatedRouteSnapshot;
const fakeState = { url: '/dashboard' } as RouterStateSnapshot;

function runGuard() {
  return TestBed.runInInjectionContext(() => authGuard(fakeRoute, fakeState));
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

describe('authGuard', () => {
  test('allows navigation when token exists', () => {
    localStorage.setItem('token', 'valid-jwt');
    expect(runGuard()).toBe(true);
  });

  test('blocks navigation when token is absent', () => {
    expect(runGuard()).toBe(false);
  });

  test('redirects to /login when token is absent', () => {
    runGuard();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
  });

  test('does NOT redirect when token is present', () => {
    localStorage.setItem('token', 'valid-jwt');
    runGuard();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  test('blocks when token key exists but value is empty string', () => {
    localStorage.setItem('token', '');
    expect(runGuard()).toBe(false);
  });
});
