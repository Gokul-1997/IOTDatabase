import { test, expect } from './fixtures/auth';

/**
 * Dashboard renders with stubbed API data.
 * We mock /api/dashboard so the test does not need a live backend.
 */

const dashboardResponse = {
  success: true,
  data: {
    shift: { shift_code: 'MS01', shiftElapsedMinutes: 414, plannedMinutes: 720 },
    summary: { total: 3, running: 2, idle: 1 },
    machines: [
      {
        machine_id: 1, machine_serial_no: 'VMC-1-F',
        operator_name: 'OP1', part_name: 'PartA',
        status: 'RUNNING', alarm: false,
        run_minutes: 200, idle_minutes: 50,
        run_time: '03:20:00', idle_time: '00:50:00',
        produced_qty: 12, achieved_qty: 12,
        target_qty: 50, utilization: 24
      },
      {
        machine_id: 2, machine_serial_no: 'VMC-2-F',
        operator_name: 'OP2', part_name: 'PartB',
        status: 'IDLE', alarm: false,
        run_minutes: 0, idle_minutes: 250,
        run_time: '00:00:00', idle_time: '04:10:00',
        produced_qty: 0, achieved_qty: 0,
        target_qty: 30, utilization: 0
      },
      {
        machine_id: 3, machine_serial_no: 'VMC-3-F',
        operator_name: '--', part_name: null,
        status: 'RUNNING', alarm: true,
        run_minutes: 100, idle_minutes: 100,
        run_time: '01:40:00', idle_time: '01:40:00',
        produced_qty: 5, achieved_qty: 5,
        target_qty: 0, utilization: 0
      }
    ]
  }
};

test.describe('Dashboard', () => {
  test('renders the machine summary and per-machine cards', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dashboardResponse)
      });
    });

    await page.goto('/dashboard');

    // Total counts
    await expect(page.getByText(/Total\s*[:\-]?\s*3/i)).toBeVisible();
    await expect(page.getByText(/Running\s*[:\-]?\s*2/i)).toBeVisible();
    await expect(page.getByText(/Idle\s*[:\-]?\s*1/i)).toBeVisible();

    // Machine cards
    await expect(page.getByText('VMC-1-F').first()).toBeVisible();
    await expect(page.getByText('VMC-2-F').first()).toBeVisible();
    await expect(page.getByText('VMC-3-F').first()).toBeVisible();
  });

  test('handles empty machine list', async ({ authedPage: page }) => {
    await page.route('**/api/dashboard*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            shift: { shift_code: 'MS01', shiftElapsedMinutes: 0, plannedMinutes: 720 },
            summary: { total: 0, running: 0, idle: 0 },
            machines: []
          }
        })
      });
    });

    await page.goto('/dashboard');
    await expect(page.getByText(/Total\s*[:\-]?\s*0/i)).toBeVisible();
  });
});
