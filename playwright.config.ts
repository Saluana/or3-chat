import { defineConfig, devices } from '@playwright/test';

const skipWebServer = process.env.PW_SKIP_WEB_SERVER === 'true';
const requestedPort = Number(process.env.PW_PORT || 3000);
const port = Number.isInteger(requestedPort) ? requestedPort : 3000;
const restartHttps = process.env.OR3_RESTART_E2E === 'true' && process.env.PW_HTTPS_PORT;
const restartSpki = restartHttps && /^[A-Za-z0-9+/]{43}=$/.test(process.env.PW_RESTART_TLS_SPKI ?? '') ? process.env.PW_RESTART_TLS_SPKI : undefined;
const baseURL = restartHttps ? `https://127.0.0.1:${restartHttps}` : `http://127.0.0.1:${port}`;
const isProductionJourneyHarness =
  process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS === 'true';
const isDelegationLiveHarness = process.env.OR3_DELEGATION_LIVE_E2E === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  testIgnore: isDelegationLiveHarness ? undefined : '**/chat-delegation-live.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI || isProductionJourneyHarness ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Context TLS exceptions do not reliably reach Vite's SharedWorker. Trust
    // only this disposable certificate in the fixture's Chromium process.
    ...(restartHttps ? { ignoreHTTPSErrors: true,
      ...(restartSpki ? { launchOptions: { args: [`--ignore-certificate-errors-spki-list=${restartSpki}`] } } : {}),
    } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), headless: process.env.PW_HEADED !== 'true' },
    },
  ],

  webServer: skipWebServer
    ? undefined
    : {
        // Local journey fixtures must not inherit personal Cloud/vault settings.
        // Cloud harnesses that reuse the fixture enable SSR auth explicitly.
        command: `bun run dev -- ${(isDelegationLiveHarness || isProductionJourneyHarness && process.env.SSR_AUTH_ENABLED !== 'true') ? '--or3-offline ' : ''}--host 127.0.0.1 --port ${port}`,
        url: baseURL,
        timeout: 120 * 1000,
        // Tests must exercise the checkout and configuration they started,
        // not an unrelated process that happens to occupy this port.
        // Deliberate externally managed servers use PW_SKIP_WEB_SERVER instead.
        reuseExistingServer: false,
        // Let the dev supervisor stop its detached Nuxt child before exiting.
        // Killing only the supervisor leaves inherited output pipes open.
        gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 30_000 },
        ...(process.env.OR3_FILE_BACKUP_E2E_DIR ? {
          env: { CI: '', TEST: '' },
        } : {}),
        ...(process.env.OR3_RESTART_E2E === 'true' ? {
          // Qualify a normal development server, independently of runner hints.
          // The installed Nitro dev worker skips awaited cleanup in CI/test mode.
          env: { CI: '', TEST: '' },
          ignoreHTTPSErrors: Boolean(restartHttps),
          stdout: 'pipe' as const,
        } : {}),
      },
});
