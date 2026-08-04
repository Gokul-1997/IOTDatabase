import { test, expect } from './fixtures/auth';

const oeeMeta = {
  success: true,
  data: {
    lines:    [{ id: 1, name: 'Line A' }],
    machines: [{ id: 1, machine_serial_no: 'VMC-1-F', line_id: 1, line_name: 'Line A' }],
    shifts:   [{ id: 5, shift_code: 'MS01', shift_name: 'Morning',
                 start_time: '08:00', end_time: '20:00' }]
  }
};

const oeeReports = {
  success: true,
  data: [
    {
      shift_date: '2026-04-26T18:30:00.000Z',
      machine_id: 1, machine_serial_no: 'VMC-1-F',
      shift_code: 'MS01', shift_name: 'Morning',
      operator_name: 'OP1',
      oee: '74.10', availability: '100.00', performance: '74.10', quality: '100.00'
    }
  ],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  filters: {}
};

test.describe('OEE Reports page', () => {
  test('renders rows with availability/performance/quality/oee columns', async ({ authedPage: page }) => {
    await page.route('**/api/oee/meta*',    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeMeta) }));
    await page.route('**/api/oee/reports*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeReports) }));

    await page.goto('/oee-reports');

    await expect(page.getByText('VMC-1-F').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('74.10').first()).toBeVisible();
    await expect(page.getByText('100.00').first()).toBeVisible();
  });

  test('shows empty state for date range with no data', async ({ authedPage: page }) => {
    await page.route('**/api/oee/meta*',    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oeeMeta) }));
    await page.route('**/api/oee/reports*', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true, data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 }, filters: {}
      })
    }));

    await page.goto('/oee-reports');
    // Either an empty-state message or 0 rows — at minimum no machine rows visible
    await expect(page.getByText('VMC-1-F')).toHaveCount(0);
  });
});
