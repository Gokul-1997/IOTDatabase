/**
 * E2E navigation and route-guard tests.
 * Verifies that protected routes redirect unauthenticated users to /login,
 * and that authenticated users can reach their permitted pages.
 * No live backend needed — network calls are stubbed where required.
 */

import { test as base, expect, Page } from '@playwright/test';
import { test as authedTest } from './fixtures/auth';

// ── unauthenticated fixture (no localStorage seed) ────────────────────────────

const test = base;

// ── guard: unauthenticated user redirected to /login ─────────────────────────

test.describe('Route guards — unauthenticated', () => {
  const protectedPaths = [
    '/dashboard',
    '/machines',
    '/operators',
    '/shifts',
    '/quality',
    '/charts',
    '/oee-reports',
    '/job',
    '/component',
    '/plants',
    '/assignments',
  ];

  for (const path of protectedPaths) {
    test(`TC-NAV-U-${path} redirects to /login`, async ({ page }) => {
      // Ensure no auth token
      await page.goto('/login');
      await page.evaluate(() => localStorage.clear());

      await page.goto(path);
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    });
  }
});

// ── public routes accessible without auth ─────────────────────────────────────

test.describe('Public routes — no auth required', () => {
  test('TC-NAV-PUB-01 /login renders the login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible({ timeout: 10_000 });
  });

  test('TC-NAV-PUB-02 /forgot-password renders email input', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── authenticated user reaches pages ─────────────────────────────────────────

authedTest.describe('Authenticated navigation', () => {
  authedTest('TC-NAV-AUTH-01 /dashboard loads without /login redirect', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', r =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { shift: {}, summary: { total: 0, running: 0, idle: 0 }, machines: [] }
        })
      })
    );
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  authedTest('TC-NAV-AUTH-02 /machines loads without /login redirect', async ({ authedPage: page }) => {
    await page.route('**/api/machines*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], meta: { total: 0 } }) })
    );
    await page.goto('/machines');
    await expect(page).toHaveURL(/\/machines/);
  });

  authedTest('TC-NAV-AUTH-03 /oee-reports loads without /login redirect', async ({ authedPage: page }) => {
    await page.route('**/api/oee/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    );
    await page.goto('/oee-reports');
    await expect(page).toHaveURL(/\/oee-reports/);
  });

  authedTest('TC-NAV-AUTH-04 root path / redirects to a valid page', async ({ authedPage: page }) => {
    await page.route('**/api/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    );
    await page.goto('/');
    // Should redirect somewhere, not stay at bare "/"
    await expect(page).not.toHaveURL(/^http:\/\/localhost:4200\/?$/, { timeout: 10_000 });
  });

  authedTest('TC-NAV-AUTH-05 /no-access page renders without crashing', async ({ authedPage: page }) => {
    await page.goto('/no-access');
    await expect(page).toHaveURL(/\/no-access/);
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });
});

// ── 404 / unknown routes ──────────────────────────────────────────────────────

test.describe('Unknown routes', () => {
  test('TC-NAV-404 unknown path does not crash the app', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-xyz123');
    // App should handle it — redirect, show 404, or show login — but not throw
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });
});
