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

/**
 * A structurally valid (unsigned) JWT with a far-future `exp`.
 * AppComponent calls AuthService.scheduleRefresh() on bootstrap, which
 * jwtDecode()s the stored token and logs out on any parse failure — so an
 * opaque string like 'stub-token' would clear storage and bounce the test
 * to /login before the page ever renders. Only the payload is read
 * client-side; requests are mocked, so no signature is needed.
 */
function stubJwt(): string {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '1', exp })}.e2e`;
}

async function seedAuth(page: Page) {
  const token = stubJwt();
  await page.addInitScript((jwt: string) => {
    const stubUser = {
      id: 1,
      email: 'test@example.com',
      username: 'test',
      plant_id: 1,
      company_id: 4,
      user_type: 'ADMIN',
      is_snt_super: false,
      // Deliberately NOT SNT_SUPER: permissionGuard redirects that role away
      // from ordinary pages to /admin/companies. ADMIN with an empty
      // company_permissions list is the "fresh company" case the guard
      // treats as full access.
      roles: ['ADMIN'],
      permissions: [],
      company_permissions: []
    };
    // Key names must match AuthService: 'token' / 'refreshToken'.
    localStorage.setItem('token', jwt);
    localStorage.setItem('refreshToken', jwt);
    localStorage.setItem('user', JSON.stringify(stubUser));
  }, token);
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    await seedAuth(page);
    await use(page);
  }
});

export { expect } from '@playwright/test';
