import { test, expect } from './fixtures/auth';

const meta = {
  success: true,
  data: {
    machines: [{ id: 1, machine_serial_no: 'VMC-1-F' }],
    shifts:   [{ id: 5, shift_code: 'MS01', shift_name: 'Morning',
                 start_time: '08:00', end_time: '20:00' }]
  }
};

const partTiming = {
  success: true,
  data: [
    { part_no: 1, run_min: 12.0, idle_min: 1.5 },
    { part_no: 2, run_min: 11.5, idle_min: 2.0 },
    { part_no: 3, run_min: 12.5, idle_min: 1.0 }
  ],
  totalRunMin: 36.0,
  totalIdleMin: 4.5
};

const hourly = {
  success: true,
  data: {
    hourlyCount: [
      { hour: '08:00', produced: 5 },
      { hour: '09:00', produced: 7 },
      { hour: '10:00', produced: 6 }
    ],
    totalProduced: 18
  }
};

test.describe('Charts page', () => {
  test('shows part-wise run/idle and hourly count using stubbed API', async ({ authedPage: page }) => {
    await page.route('**/api/charts/meta*',  r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }));
    await page.route('**/api/charts/parts*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(partTiming) }));
    await page.route('**/api/charts/data*',  r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hourly) }));

    await page.goto('/charts');

    // Header and totals visible
    await expect(page.getByText(/charts/i).first()).toBeVisible();

    // Wait until data loaded — totals row from getPartTiming
    await expect(page.getByText(/Total Parts/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
