import { defineConfig, devices } from '@playwright/test';

/**
 * Containment qualification profile (task 4.13).
 *
 * Runs the same probe suite in each real engine the plan names: Chromium,
 * Firefox, WebKit (desktop Safari engine) and WebKit with the mobile Safari
 * device profile. The app is started with the probe routes enabled, auth and sync
 * disabled so the harness needs no credentials, and a dedicated port so a
 * developer's own dev server is untouched.
 */

const requestedPort = Number(process.env.PW_CONTAINMENT_PORT || 3121);
const port = Number.isInteger(requestedPort) ? requestedPort : 3121;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['**/plugin-containment.spec.ts'],
    fullyParallel: false,
    workers: 1,
    forbidOnly: true,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL,
        trace: 'off',
        screenshot: 'off',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    ],
    webServer: process.env.PW_SKIP_WEB_SERVER === 'true'
        ? undefined
        : {
        command: `env SSR_AUTH_ENABLED=false OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false OR3_BACKGROUND_STREAMING_ENABLED=false OR3_CONTAINMENT_PROBE_ENABLED=true bun run dev -- --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        timeout: 180 * 1000,
        reuseExistingServer: process.env.PW_SKIP_WEB_SERVER === 'true',
    },
});
