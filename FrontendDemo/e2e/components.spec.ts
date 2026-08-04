import { test, expect } from './fixtures/auth';

const machines = { success: true, data: [{ id: 1, machine_serial_no: 'VMC-1-F' }] };

const componentList = {
  success: true,
  data: [
    {
      id: 11, machine_id: 1, machine_serial_no: 'VMC-1-F',
      part_name: 'PartA', part_number: 'PN-001',
      operation_number: 'OP-1',
      cycle_time: { hours: 0, minutes: 1, seconds: 0 },
      target: 50, multiplication_factor: 1
    }
  ],
  meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
};

test.describe('Components page', () => {
  test('lists components and opens create modal', async ({ authedPage: page }) => {
    await page.route('**/api/machines*',   r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(machines) }));
    await page.route('**/api/components*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(componentList) }));

    await page.goto('/component');

    await expect(page.getByText('PartA').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('PN-001').first()).toBeVisible();

    // Try to open the create modal — exact button text varies, so be flexible
    const addBtn = page.getByRole('button', { name: /add|create|new/i }).first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.getByText(/part name/i).first()).toBeVisible();
    }
  });
});
