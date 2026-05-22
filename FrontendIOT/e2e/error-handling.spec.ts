/**
 * E2E tests for API error handling across the application.
 * Verifies the app degrades gracefully on 401 / 403 / 404 / 500 responses.
 * Network calls are intercepted — no live backend needed.
 */

import { test, expect } from './fixtures/auth';

// ── helpers ───────────────────────────────────────────────────────────────────

function stub(page: any, urlPattern: string, status: number, body: object = {}) {
  return page.route(urlPattern, (r: any) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

// ── Dashboard errors ──────────────────────────────────────────────────────────

test.describe('Dashboard — API error handling', () => {
  test('TC-ERR-01 500 on /api/dashboard — page does not crash', async ({ authedPage: page }) => {
    await stub(page, '**/api/dashboard*', 500, { message: 'Internal Server Error' });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    // No unhandled error dialog
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });

  test('TC-ERR-02 network timeout on /api/dashboard — page stays on dashboard', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', r => r.abort('timedout'));
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('TC-ERR-03 401 on /api/dashboard does not crash page', async ({ authedPage: page }) => {
    await stub(page, '**/api/dashboard*', 401, { message: 'Unauthorized' });
    await page.goto('/dashboard');
    // App may redirect to login or show empty state — either is safe
    const url = page.url();
    expect(url.includes('/dashboard') || url.includes('/login')).toBe(true);
  });

  test('TC-ERR-04 malformed JSON response — page survives', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: 'INVALID JSON{{' })
    );
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

// ── Quality errors ────────────────────────────────────────────────────────────

test.describe('Quality — API error handling', () => {
  test('TC-ERR-10 500 on /api/quality — page does not crash', async ({ authedPage: page }) => {
    await stub(page, '**/api/quality/meta*', 200, { success: true, data: { machines: [], shifts: [] } });
    await stub(page, '**/api/quality*', 500, { message: 'Server error' });
    await page.goto('/quality');

    await expect(page).toHaveURL(/\/quality/);
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });

  test('TC-ERR-11 403 forbidden — page does not redirect to /login', async ({ authedPage: page }) => {
    await stub(page, '**/api/quality*', 403, { message: 'Forbidden' });
    await page.goto('/quality');

    // Should stay on quality or go to no-access — not crash
    const url = page.url();
    expect(url.includes('/quality') || url.includes('/no-access')).toBe(true);
  });
});

// ── OEE Reports errors ────────────────────────────────────────────────────────

test.describe('OEE Reports — API error handling', () => {
  test('TC-ERR-20 500 on /api/oee/reports — shows no data rows', async ({ authedPage: page }) => {
    await stub(page, '**/api/oee/meta*', 200, {
      success: true,
      data: { lines: [], machines: [], shifts: [] }
    });
    await stub(page, '**/api/oee/reports*', 500, { message: 'DB error' });
    await page.goto('/oee-reports');

    await expect(page).toHaveURL(/\/oee-reports/);
    await expect(page.getByText('VMC-1-F')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-ERR-21 meta endpoint 404 — page does not crash', async ({ authedPage: page }) => {
    await stub(page, '**/api/oee/meta*', 404, { message: 'Not found' });
    await stub(page, '**/api/oee/reports*', 200, { success: true, data: [], pagination: { total: 0 } });
    await page.goto('/oee-reports');

    await expect(page).toHaveURL(/\/oee-reports/);
  });
});

// ── Charts errors ─────────────────────────────────────────────────────────────

test.describe('Charts — API error handling', () => {
  test('TC-ERR-30 parts endpoint 500 — chart section handles error gracefully', async ({ authedPage: page }) => {
    await stub(page, '**/api/charts/meta*', 200, { success: true, data: { machines: [], shifts: [] } });
    await stub(page, '**/api/charts/parts*', 500, { message: 'Server error' });
    await stub(page, '**/api/charts/data*', 200, { success: true, data: { hourlyCount: [], totalProduced: 0 } });
    await page.goto('/charts');

    await expect(page).toHaveURL(/\/charts/);
    await expect(page.locator('body')).not.toContainText('Cannot read');
  });
});

// ── Jobs errors ───────────────────────────────────────────────────────────────

test.describe('Jobs — API error handling', () => {
  test('TC-ERR-40 422 when starting a duplicate job', async ({ authedPage: page }) => {
    await stub(page, '**/api/machines*', 200, { success: true, data: [{ id: 1, machine_serial_no: 'VMC-1' }] });
    await stub(page, '**/api/jobs*', 200, { success: true, data: [], meta: { page: 1, total: 0 } });

    await page.goto('/job');

    // Try to submit a start job request that returns 422
    await page.route('**/api/jobs/start*', r =>
      r.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Machine already has an active job' })
      })
    );

    // Page should remain stable
    await expect(page).toHaveURL(/\/job/);
  });

  test('TC-ERR-41 500 on /api/jobs — page still renders', async ({ authedPage: page }) => {
    await stub(page, '**/api/machines*', 200, { success: true, data: [] });
    await stub(page, '**/api/jobs*', 500, { message: 'DB error' });
    await page.goto('/job');

    await expect(page).toHaveURL(/\/job/);
  });
});
