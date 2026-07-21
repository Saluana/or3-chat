import { defineConfig, devices } from '@playwright/test';

const skipWebServer = process.env.PW_SKIP_WEB_SERVER === 'true';
const requestedPort = Number(process.env.PW_PORT || 3000);
const port = Number.isInteger(requestedPort) ? requestedPort : 3000;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: skipWebServer
    ? undefined
    : {
        command: `bun run dev -- --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        timeout: 120 * 1000,
        reuseExistingServer: !process.env.CI,
      },
});
