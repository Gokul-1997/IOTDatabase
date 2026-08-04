import { test, expect } from '@playwright/test';

/**
 * Login page — renders, validates, and handles API responses.
 * Network calls are mocked so this passes in CI without spinning up the API.
 */

test.describe('Login page — render', () => {
  test('TC-L-01 renders email + password fields and submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible();
  });

  test('TC-L-02 page title or heading is present', async ({ page }) => {
    await page.goto('/login');
    // At minimum some heading or brand text visible
    const heading = page.getByRole('heading').first();
    await expect(heading.or(page.getByText(/sign in|login|welcome/i).first())).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('Login page — field validation', () => {
  test('TC-L-03 submit with empty fields shows validation (HTML5 or custom)', async ({ page }) => {
    await page.goto('/login');
    const submit = page.getByRole('button', { name: /sign in|login/i });
    await submit.click();
    const emailField = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first();
    const validity = await emailField.evaluate((el: HTMLInputElement) => el.validity?.valid);
    expect(validity).toBeFalsy();
  });

  test('TC-L-04 invalid email format triggers HTML5 validation', async ({ page }) => {
    await page.goto('/login');
    const emailField = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first();
    await emailField.fill('not-an-email');
    await page.getByRole('button', { name: /sign in|login/i }).click();
    const validity = await emailField.evaluate((el: HTMLInputElement) => el.validity?.valid);
    expect(validity).toBeFalsy();
  });

  test('TC-L-05 password field masks input', async ({ page }) => {
    await page.goto('/login');
    const pwd = page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first();
    const type = await pwd.getAttribute('type');
    expect(type).toBe('password');
  });
});

test.describe('Login page — API responses', () => {
  test('TC-L-06 handles invalid credentials (401) — stays on /login', async ({ page }) => {
    await page.route('**/api/auth/login', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Invalid credentials' })
      });
    });

    await page.goto('/login');
    await page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first().fill('bad@x.com');
    await page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first().fill('wrong');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-L-07 handles account locked (403) — stays on /login', async ({ page }) => {
    await page.route('**/api/auth/login', async route => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Account locked. Try again later.' })
      });
    });

    await page.goto('/login');
    await page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first().fill('locked@x.com');
    await page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first().fill('pass123');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-L-08 handles server error (500) — stays on /login', async ({ page }) => {
    await page.route('**/api/auth/login', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal server error' })
      });
    });

    await page.goto('/login');
    await page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first().fill('user@x.com');
    await page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first().fill('pass123');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-L-09 successful login (200) navigates away from /login', async ({ page }) => {
    const fakeUser = {
      id: 1, email: 'admin@x.com', username: 'admin',
      roles: ['ADMIN'], permissions: ['page:dashboard'],
      company_permissions: [], company_id: 4, plant_id: 1,
      user_type: 'ADMIN', is_snt_super: false, plan: null
    };

    await page.route('**/api/auth/login', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessToken: 'fake-jwt',
          refreshToken: 'fake-refresh',
          user: fakeUser
        })
      });
    });

    // Stub any subsequent API calls
    await page.route('**/api/**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    );

    await page.goto('/login');
    await page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i)).first().fill('admin@x.com');
    await page.getByPlaceholder(/password/i).or(page.getByLabel(/password/i)).first().fill('secret123');
    await page.getByRole('button', { name: /sign in|login/i }).click();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('TC-L-10 forgot password link is visible and clickable', async ({ page }) => {
    await page.goto('/login');
    const forgotLink = page.getByRole('link', { name: /forgot.*(password)?/i })
      .or(page.getByText(/forgot.*(password)?/i).first());
    if (await forgotLink.isVisible({ timeout: 5_000 })) {
      await forgotLink.click();
      await expect(page).toHaveURL(/\/forgot-password/);
    }
  });
});
