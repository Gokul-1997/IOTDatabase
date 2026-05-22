import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end browser tests.
 *
 * Run locally:   npm run e2e
 * In CI:         npm run e2e -- --reporter=github
 *
 * Set BASE_URL env var to point at any environment (dev / staging / prod).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect:  { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    // Uncomment to expand coverage:
    // { name: 'firefox',  use: { ...devices['Desktop Firefox']  } },
    // { name: 'webkit',   use: { ...devices['Desktop Safari']   } }
  ],

  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm start',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
});
