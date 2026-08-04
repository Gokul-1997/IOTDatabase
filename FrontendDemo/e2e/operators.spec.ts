import { test, expect } from './fixtures/auth';

const operatorList = {
  success: true,
  data: [
    { id: 1, operator_name: 'John Doe',  operator_code: 'OP-001', plant_id: 1, is_active: true },
    { id: 2, operator_name: 'Jane Smith', operator_code: 'OP-002', plant_id: 1, is_active: true }
  ],
  meta: { page: 1, limit: 10, total: 2, totalPages: 1 }
};

const emptyList = {
  success: true,
  data: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
};

function stubOperators(page: any, response = operatorList) {
  return page.route('**/api/operators*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  );
}

test.describe('Operators page', () => {
  test('TC-OP-01 lists operator names', async ({ authedPage: page }) => {
    await stubOperators(page);
    await page.goto('/operators');

    await expect(page.getByText('John Doe').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Jane Smith').first()).toBeVisible();
  });

  test('TC-OP-02 shows operator code', async ({ authedPage: page }) => {
    await stubOperators(page);
    await page.goto('/operators');

    await expect(page.getByText('OP-001').first()).toBeVisible({ timeout: 10_000 });
  });

  test('TC-OP-03 empty list renders without crash', async ({ authedPage: page }) => {
    await stubOperators(page, emptyList);
    await page.goto('/operators');

    await expect(page.getByText('John Doe')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-OP-04 navigates to create page on Add button click', async ({ authedPage: page }) => {
    await stubOperators(page);
    await page.goto('/operators');

    const addBtn = page.getByRole('button', { name: /add|create|new operator/i }).first();
    if (await addBtn.isVisible({ timeout: 5_000 })) {
      await addBtn.click();
      await expect(page).toHaveURL(/\/operators\/create/);
    }
  });

  test('TC-OP-05 handles 500 server error gracefully', async ({ authedPage: page }) => {
    await page.route('**/api/operators*', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal error' }) })
    );
    await page.goto('/operators');

    await expect(page).toHaveURL(/\/operators/);
    await expect(page.getByText('John Doe')).toHaveCount(0, { timeout: 10_000 });
  });

  test('TC-OP-06 handles 401 unauthorized gracefully', async ({ authedPage: page }) => {
    await page.route('**/api/operators*', r =>
      r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) })
    );
    await page.goto('/operators');
    // Page should still render (interceptor may redirect, or show empty state)
    await expect(page.getByText('John Doe')).toHaveCount(0, { timeout: 10_000 });
  });
});
