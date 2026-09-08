import { test, expect } from './fixtures/auth';

/**
 * Phase 2 · Screen 1 — Factory Overall Dashboard.
 * Mocks /api/dashboard/factory and /api/charts/meta so the test runs
 * without a live backend, mirroring dashboard.spec.ts.
 */

const metaResponse = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'VMC-1-F' }, { id: 2, machine_serial_no: 'VMC-2-F' }],
    shifts:   [{ id: 10, shift_code: 'MS01', shift_name: 'Morning' }]
  }
};

const factoryResponse = {
  status: 'success',
  data: {
    filters: { date: '2026-08-10', shift_id: null, shift_code: null, machine_id: null },
    updated_at: '2026-08-10T09:30:00.000Z',
    machines: { total: 12, running: 8, idle: 3, breakdown: 1, offline: 0 },
    production: { produced: 420, planned: 500, percent: 84 },
    time: { run_seconds: 29520, idle_seconds: 7200, down_seconds: 3600 },
    oee: { availability: 82, performance: 76, quality: 98, oee: 61, target: 85 },
    energy: {
      kwh: 148.25, month_kwh: 3120.5, currency: 'INR',
      rate_per_kwh: 8, cost_day: 1186, cost_month: 24964
    },
    shiftwise: [
      { shift_code: 'MS01', produced: 220 },
      { shift_code: 'MS02', produced: 200 }
    ],
    downtime: {
      total_seconds: 3600, planned_seconds: 1200, unplanned_seconds: 2400,
      by_reason: [
        { reason: 'Tool Change', category: 'PLANNED',   seconds: 1200, events: 3 },
        { reason: 'Breakdown',   category: 'UNPLANNED', seconds: 2400, events: 2 }
      ]
    },
    alarms: { total: 9, critical: 2, non_critical: 4, information: 3, open: 5 },
    trend: [
      { hour: '2026-08-10T02:00:00.000Z', kwh: 12.5, produced: 40 },
      { hour: '2026-08-10T03:00:00.000Z', kwh: 14.1, produced: 52 }
    ]
  }
};

/**
 * Registered first so the specific routes below win (Playwright uses the
 * most recently registered matching route). Without this, any unmocked
 * call — the layout's notification poll, for one — 401s against the real
 * API, and the auth interceptor logs the stub user out mid-test.
 */
async function mockApi(page: any, factory: any = factoryResponse) {
  await page.route('**/api/**', (route: any) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', success: true, data: [] })
    })
  );
  await page.route('**/api/charts/meta*', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metaResponse) })
  );
  await page.route('**/api/dashboard/factory*', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(factory) })
  );
}

test.describe('Factory Overall Dashboard', () => {

  test('renders machine states, production, OEE, energy and alarms', async ({ authedPage: page }) => {
    await mockApi(page);
    await page.goto('/factory');

    await expect(page.getByRole('heading', { name: /Factory Overall Dashboard/i })).toBeVisible();

    // machine state tiles
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('8',  { exact: true }).first()).toBeVisible();

    // production against plan
    await expect(page.getByText('420')).toBeVisible();
    await expect(page.getByText(/of 500 planned/i)).toBeVisible();
    await expect(page.getByText('84%')).toBeVisible();

    // OEE headline + target
    await expect(page.getByText('61%')).toBeVisible();
    await expect(page.getByText(/Target 85%/i)).toBeVisible();

    // energy, with the configured tariff applied
    await expect(page.getByText(/148\.25/)).toBeVisible();
    await expect(page.getByText(/₹1,186/)).toBeVisible();

    // alarm classes from the agreement
    await expect(page.getByText(/Non-Critical/i)).toBeVisible();
    await expect(page.getByText(/Information/i)).toBeVisible();
  });

  test('shows "Tariff not set" instead of zero when no rate is configured', async ({ authedPage: page }) => {
    const noTariff = JSON.parse(JSON.stringify(factoryResponse));
    noTariff.data.energy.rate_per_kwh = null;
    noTariff.data.energy.cost_day = null;
    noTariff.data.energy.cost_month = null;

    await mockApi(page, noTariff);
    await page.goto('/factory');

    await expect(page.getByText(/Tariff not set/i).first()).toBeVisible();
  });

  test('shows "No plan set" when no production plan exists', async ({ authedPage: page }) => {
    const noPlan = JSON.parse(JSON.stringify(factoryResponse));
    noPlan.data.production.planned = 0;
    noPlan.data.production.percent = null;

    await mockApi(page, noPlan);
    await page.goto('/factory');

    await expect(page.getByText(/No plan set/i)).toBeVisible();
  });

  test('surfaces an error message when the API fails', async ({ authedPage: page }) => {
    await mockApi(page);
    // 500, not 401 — a 401 would trip the auth interceptor's logout path
    // rather than surfacing an error on the page.
    await page.route('**/api/dashboard/factory*', (route: any) =>
      route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({ status: 'error', message: 'Shift not found or access denied' })
      })
    );

    await page.goto('/factory');
    await expect(page.getByText(/Shift not found or access denied/i)).toBeVisible();
  });

});
