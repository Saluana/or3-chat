import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'cd /Users/brendon/Documents/or3/or3-chat && NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_test NUXT_CLERK_SECRET_KEY=sk_live_test HOST=127.0.0.1 PORT=3100 bun .output/server/index.mjs',
    url: 'http://127.0.0.1:3100',
    timeout: 300 * 1000,
    reuseExistingServer: false,
  },
});