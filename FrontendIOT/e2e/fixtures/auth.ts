import { test as base, Page } from '@playwright/test';

/**
 * Reusable authenticated test fixture.
 * Skips the real login form by writing a stub JWT/user into localStorage —
 * faster and stable across UI redesigns. Override with TEST_USER env vars
 * if you want to run against a real backend.
 *
 * The stub matches the shape your AuthService stores. If your code reads
 * a different key, update `seedAuth` below.
 */

type AuthFixtures = {
  authedPage: Page;
};

async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    const stubUser = {
      id: 1,
      email: 'test@example.com',
      username: 'test',
      plant_id: 1,
      company_id: 4,
      user_type: 'ADMIN',
      is_snt_super: true,    // grants every page guard
      roles: ['SNT_SUPER', 'ADMIN'],
      permissions: ['*'],
      company_permissions: ['*']
    };
    localStorage.setItem('access_token', 'e2e-stub-token');
    localStorage.setItem('refresh_token', 'e2e-stub-refresh');
    localStorage.setItem('user', JSON.stringify(stubUser));
  });
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    await seedAuth(page);
    await use(page);
  }
});

export { expect } from '@playwright/test';
