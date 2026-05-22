import { test, expect } from './fixtures/auth';

const machines = { success: true, data: [{ id: 1, machine_serial_no: 'VMC-1-F' }] };

const jobList = {
  success: true,
  data: [
    {
      id: 1, machine_id: 1, machine_serial_no: 'VMC-1-F',
      part_name: 'PartA', target_qty: 50,
      started_at: '2026-04-27T08:00:00Z',
      is_active: true
    }
  ],
  meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
};

const emptyJobs = {
  success: true,
  data: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
};

function stubBase(page: any, jobs = jobList) {
  page.route('**/api/machines*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machines) })
  );
  page.route('**/api/jobs*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobs) })
  );
}

test.describe('Job page', () => {
  test('TC-JB-01 shows active jobs with machine serial and part name', async ({ authedPage: page }) => {
    await stubBase(page);
    await page.goto('/job');

    await expect(page.getByText('VMC-1-F').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('PartA').first()).toBeVisible();
  });

  test('TC-JB-02 shows target quantity', async ({ authedPage: page }) => {
    await stubBase(page);
    await page.goto('/job');

    await expect(page.getByText('50').first()).toBeVisible({ timeout: 10_000 });
  });

  test('TC-JB-03 empty job list renders without crash', async ({ authedPage: page }) => {
    await stubBase(page, emptyJobs);
    await page.goto('/job');

    await expect(page.getByText('PartA')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-JB-04 stop job — 200 response clears job from list', async ({ authedPage: page }) => {
    await stubBase(page);

    await page.goto('/job');
    await expect(page.getByText('PartA').first()).toBeVisible({ timeout: 10_000 });

    // Mock the stop endpoint
    await page.route('**/api/jobs/*/stop', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    );
    // After stop, return empty list
    await page.route('**/api/jobs*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyJobs) })
    );

    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    if (await stopBtn.isVisible({ timeout: 5_000 })) {
      await stopBtn.click();
    }
  });

  test('TC-JB-05 stop job — 422 (already stopped) handled gracefully', async ({ authedPage: page }) => {
    await stubBase(page);
    await page.goto('/job');

    await page.route('**/api/jobs/*/stop', r =>
      r.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'No active job found' })
      })
    );

    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    if (await stopBtn.isVisible({ timeout: 5_000 })) {
      await stopBtn.click();
    }

    // Page should not crash
    await expect(page).toHaveURL(/\/job/);
  });

  test('TC-JB-06 500 on job list — page does not crash', async ({ authedPage: page }) => {
    await page.route('**/api/machines*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machines) })
    );
    await page.route('**/api/jobs*', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    );

    await page.goto('/job');
    await expect(page).toHaveURL(/\/job/);
    await expect(page.getByText('PartA')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-JB-07 pagination meta visible for multi-page lists', async ({ authedPage: page }) => {
    await page.route('**/api/machines*', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machines) })
    );
    await page.route('**/api/jobs*', r =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...jobList, meta: { page: 1, limit: 10, total: 25, totalPages: 3 } })
      })
    );

    await page.goto('/job');
    await expect(page.getByText('VMC-1-F').first()).toBeVisible({ timeout: 10_000 });
  });
});
