import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const qualificationDir = resolve('output/playwright/marketplace-admin');

/**
 * Dashboard > Marketplace user journeys (task 6.6).
 *
 * The marketplace is an authenticated dashboard app, so the journey needs a
 * signed-in session. Identity is simulated at the network boundary — the same
 * technique the original harness used, with the field shapes the app actually
 * reads (`/api/auth/session` for the app session and its `authRequired` gate,
 * `/api/admin/auth/session` with `kind` for install authority) — so the journey
 * is deterministic without a live registry, a published package, a real
 * provider account or an administrator:
 *
 *   PW_PORT=3120 bunx playwright test tests/e2e/marketplace.spec.ts
 *
 * The host's marketplace data endpoints are stubbed the same way. What is under
 * test is the UI journey: discovery, the actionable block list, the member
 * request path, keyboard reachability and the mobile layout.
 */

/** A signed-in local session with a workspace, as the client context expects. */
function sessionPayload(authenticated: boolean) {
    return {
        session: authenticated
            ? {
                  authenticated: true,
                  provider: 'e2e-harness',
                  providerUserId: 'e2e-super-admin',
                  user: { id: 'usr_e2e_admin', email: 'e2e@example.test', displayName: 'E2E Admin' },
                  workspace: { id: 'ws_e2e', name: 'E2E Workspace' },
                  role: 'owner',
                  entitlements: [],
              }
            : null,
        appAccessAllowed: authenticated,
    };
}

const PUBLISHED = {
    configured: true,
    catalog: {
        total: 1,
        items: [
            {
                pluginId: 'or3.sample-utility',
                name: 'Sample Utility',
                summary: 'Summarise the document you are reading.',
                publisher: { namespace: 'or3', displayName: 'OR3', official: true },
                price: { kind: 'free' },
            },
        ],
    },
};

const PREFLIGHT_BLOCKED = {
    pluginId: 'or3.sample-utility',
    requestedVersion: null,
    status: 'blocked',
    blocks: [
        {
            code: 'registry-install-disabled',
            message: 'Registry installation is turned off on this instance.',
            action: 'enable-install',
        },
    ],
    registry: { configured: true, installEnabled: false, origin: 'https://registry.example', keys: 1 },
    host: {
        or3Version: '0.3.0',
        pluginApiVersion: '2.0.0',
        trustModes: ['isolated-client'],
        grants: ['ui.dashboard.register'],
        features: ['or3-portable-client-v1'],
    },
    release: {
        releaseId: 'rel_1',
        version: '1.0.0',
        archiveSha256: `sha256-${'a'.repeat(64)}`,
        packageTreeSha256: `sha256-${'b'.repeat(64)}`,
        profile: 'or3-portable-client-v1',
        publishedAt: '2026-01-01T00:00:00.000Z',
        license: 'MIT',
    },
    advisories: { latestSequence: 3, acceptedSequence: 3, quarantined: false },
    storage: { freeBytes: 1, ok: true },
};

const PREFLIGHT_INSTALLABLE = {
    ...PREFLIGHT_BLOCKED,
    status: 'installable',
    blocks: [],
    registry: { ...PREFLIGHT_BLOCKED.registry, installEnabled: true },
    host: { ...PREFLIGHT_BLOCKED.host, client: { profile: 'or3-portable-client-v1', qualifiedBrowsers: ['chromium'], staticHost: false } },
    release: { ...PREFLIGHT_BLOCKED.release, authoritySha256: `sha256-${'c'.repeat(64)}`, requestedGrants: [] },
};

function pausedOperation() {
    return {
        operationId: 'op_disposable', pluginId: 'or3.sample-utility', workspaceId: 'ws_e2e', version: '1.0.0',
        stage: 'candidate-recorded', status: 'paused', percentComplete: 60, needsSetup: true,
        resumable: true, retryable: true, canceled: false, updatedAt: Date.now(),
        release: { releaseId: 'rel_1', archiveSha256: PREFLIGHT_INSTALLABLE.release.archiveSha256,
            packageTreeSha256: PREFLIGHT_INSTALLABLE.release.packageTreeSha256,
            manifestSha256: `sha256-${'d'.repeat(64)}`,
            authoritySha256: PREFLIGHT_INSTALLABLE.release.authoritySha256 },
        failure: { code: 'setup-required', stage: 'candidate-recorded', message: 'Finish workspace setup', retryable: true },
    };
}

async function stubMarketplace(
    page: Page,
    options: { readonly role: 'owner' | 'member' }
): Promise<void> {
    await page.route('**/api/auth/session', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(sessionPayload(true)),
        })
    );
    // `kind` is what the marketplace account check reads; a member (or a
    // workspace-admin without deployment authority) gets the request path.
    await page.route('**/api/admin/auth/session', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                authenticated: true,
                kind: options.role === 'owner' ? 'super_admin' : 'workspace_admin',
            }),
        })
    );
    await page.route('**/api/plugins/marketplace/catalog*', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(PUBLISHED),
        })
    );
    await page.route('**/api/plugins/marketplace/or3.sample-utility', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                configured: true,
                entry: {
                    pluginId: 'or3.sample-utility',
                    name: 'Sample Utility',
                    summary: 'Summarise the document you are reading.',
                    releases: [{ version: '1.0.0' }],
                },
            }),
        })
    );
    await page.route('**/api/plugins/marketplace/preflight', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(PREFLIGHT_BLOCKED),
        })
    );
}

/**
 * Open the dashboard, the Marketplace tile and the requested page, the way a
 * user would: hydration has to finish before the rail renders.
 */
/**
 * Open the marketplace the way the sidebar does. A dashboard deep link
 * (`?dashboard=marketplace&page=discover`) is the same destination without the
 * sidebar, which is what a mobile viewport uses.
 */
async function openMarketplaceDirect(page: Page): Promise<void> {
    await page.goto('/?dashboard=marketplace&page=discover');
    await expect(page.getByTestId('marketplace-discover')).toBeVisible({ timeout: 30_000 });
    const welcome = page.locator('[data-welcome-card]');
    if (await welcome.count()) await welcome.locator('button[aria-label="Dismiss welcome"]').click();
}

async function openMarketplace(
    page: Page,
    pageTitle = 'Discover'
): Promise<void> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const welcome = page.locator('[data-welcome-card]');
    if (await welcome.count()) await welcome.locator('button[aria-label="Dismiss welcome"]').click();
    await page.getByRole('button', { name: 'Dashboard' }).first().click({ timeout: 30_000 });
    await page
        .locator('#dashboard-plugin-grid [aria-label="Marketplace"]')
        .first()
        .click({ timeout: 30_000 });
    await page
        .locator('#dashboard-landing-grid')
        .getByRole('button', { name: pageTitle })
        .click({ timeout: 30_000 });
}

test.describe('marketplace journeys', () => {
    test('a dashboard deep link does not stack the first-run chat welcome over Marketplace', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.goto('/chat?dashboard=marketplace&page=discover');
        await expect(page.getByTestId('marketplace-discover')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('[data-welcome-card]')).toHaveCount(0);
    });

    test('a workspace-bound detail link refuses to resume in another workspace', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.goto('/?dashboard=marketplace&plugin=or3.sample-utility&workspace=ws_other');
        await expect(page.getByTestId('marketplace-discover')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('marketplace-workspace-mismatch')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTestId('marketplace-detail')).toHaveCount(0);
        await mkdir(qualificationDir, { recursive: true });
        await page.screenshot({ path: resolve(qualificationDir, 'workspace-mismatch.png'), animations: 'disabled' });
        await page.goto('/chat?dashboard=marketplace&plugin=or3.sample-utility&workspace=ws_e2e');
        await expect(page.getByTestId('marketplace-detail')).toBeVisible({ timeout: 30_000 });
        await page.unroute('**/api/auth/session');
        await page.route('**/api/auth/session', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ...sessionPayload(true), session: {
                ...sessionPayload(true).session, workspace: { id: 'ws_other', name: 'Other Workspace' },
            } }),
        }));
        await page.reload();
        await expect(page.getByTestId('marketplace-workspace-mismatch')).toBeVisible({ timeout: 30_000 });
        await page.unroute('**/api/auth/session');
        await page.route('**/api/auth/session', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(sessionPayload(true)),
        }));
        await page.goto('/chat?dashboard=marketplace&plugin=or3.sample-utility&workspace=ws_e2e&setup=1');
        await expect(page.getByTestId('marketplace-configure')).toBeVisible({ timeout: 5_000 });
    });

    test('an owner can browse and sees the exact reason an install is blocked', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await stubMarketplace(page, { role: 'owner' });
        await openMarketplace(page);

        const discover = page.getByTestId('marketplace-discover');
        await expect(discover).toBeVisible({ timeout: 30_000 });
        await expect(discover).toContainText('Sample Utility');

        // Keyboard: the search field is reachable and operable without a mouse.
        const search = page.getByRole('textbox', { name: 'Search the marketplace' });
        await search.focus();
        await expect(search).toBeFocused();
        await search.fill('sample');
        await search.press('Enter');

        await page.getByTestId('marketplace-card').first().click();
        await expect(page.getByTestId('marketplace-block').first()).toContainText(
            'registry-install-disabled'
        );
        // The block carries a recommended fix, not just a code.
        await expect(page.getByTestId('marketplace-block').first()).toContainText(
            'Open instance settings'
        );
        // The unqualified browser and disabled registry cannot offer an install action.
        await expect(page.getByTestId('marketplace-install')).toHaveCount(0);
        const closeDetails = page.getByRole('button', { name: 'Close details' });
        await closeDetails.focus();
        await closeDetails.press('Enter');
        await expect(search).toBeFocused();
    });

    test('a member gets a copyable administrator request instead of an install action', async ({
        page,
    }) => {
        await stubMarketplace(page, { role: 'member' });
        await openMarketplace(page);

        const discover = page.getByTestId('marketplace-discover');
        await expect(discover).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('marketplace-card').first().click();

        await expect(page.getByTestId('marketplace-copy-request')).toBeVisible();
        await expect(page.getByTestId('marketplace-install')).toHaveCount(0);
    });

    test('an owner can enter the install guide for a reviewed release', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.unroute('**/api/plugins/marketplace/preflight');
        await page.route('**/api/plugins/marketplace/preflight', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(PREFLIGHT_INSTALLABLE),
        }));
        await openMarketplaceDirect(page);
        await page.getByTestId('marketplace-card').first().click();
        await expect(page.getByTestId('marketplace-install')).toBeVisible();
        await expect(page).toHaveURL(/plugin=or3\.sample-utility/);
        await page.reload();
        await expect(page).toHaveURL(/plugin=or3\.sample-utility/);
        await expect(page.getByTestId('marketplace-detail')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('marketplace-install')).toBeVisible();
    });

    test('a paused install returns to the same release after an expired admin session and reload', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.unroute('**/api/plugins/marketplace/preflight');
        await page.route('**/api/plugins/marketplace/preflight', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(PREFLIGHT_INSTALLABLE),
        }));
        let recorded = false;
        let starts = 0;
        await page.route('**/api/admin/plugins/acquisitions?pluginId=or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operations: recorded ? [pausedOperation()] : [] }),
        }));
        await page.route('**/api/admin/plugins/acquisitions', (route) => {
            starts += 1;
            recorded = true;
            return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ statusCode: 401, statusMessage: 'Session expired' }) });
        });
        await page.goto('/chat?dashboard=marketplace&plugin=or3.sample-utility&version=1.0.0&workspace=ws_e2e');
        await expect(page.getByTestId('marketplace-install')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('marketplace-install').click();
        await expect(page.getByTestId('marketplace-detail')).toContainText('Sign in again');
        await page.reload();
        await expect(page.getByTestId('marketplace-continue')).toBeVisible({ timeout: 10_000 });
        expect(starts).toBe(1);
    });

    test('a blocked update keeps the current version separate from the candidate', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: `sha256-${'a'.repeat(64)}` },
                        candidate: { packageDigest: `sha256-${'b'.repeat(64)}` }, previous: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: `sha256-${'a'.repeat(64)}`, issueCodes: [] },
                    display: { version: '1.0.0', selectedDigest: `sha256-${'a'.repeat(64)}`,
                        candidateVersion: '2.0.0', candidateDigest: `sha256-${'b'.repeat(64)}`, canOpen: true },
                }],
            }),
        }));
        await page.route('**/api/admin/plugins/acquisitions?pluginId=or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operations: [] }),
        }));
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/canary', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, status: 'blocked' }),
        }));
        await page.goto('/chat?dashboard=marketplace&page=updates');
        await expect(page.getByTestId('marketplace-updates')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('marketplace-updates')).toContainText('Current 1.0.0');
        await expect(page.getByTestId('marketplace-updates')).toContainText('Update being checked: 2.0.0');
        await page.getByTestId('marketplace-update-activate').click();
        await expect(page.getByTestId('marketplace-updates')).toContainText('Update check: blocked');
        await expect(page.getByTestId('marketplace-updates')).toContainText('Current 1.0.0');
    });

    test('Installed Configure leaves an old acquisition and opens the current version', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: `sha256-${'a'.repeat(64)}` }, candidate: null, previous: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: `sha256-${'a'.repeat(64)}`, issueCodes: [] },
                    display: { version: '1.0.0', selectedDigest: `sha256-${'a'.repeat(64)}`, canOpen: true },
                }],
            }),
        }));
        const setupRequests: string[] = [];
        await page.route('**/api/plugins/or3.sample-utility/setup-plan*', (route) => {
            setupRequests.push(route.request().url());
            return route.fulfill({ status: 409, contentType: 'application/json', body: '{}' });
        });
        await page.goto('/chat?dashboard=marketplace&page=installed&plugin=or3.sample-utility&workspace=ws_e2e&acquisition=acq_old&installRequest=req_old&rollout=old');
        await expect(page.getByTestId('marketplace-installed')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('marketplace-installed').getByRole('button', { name: 'Configure' }).click();
        await expect(page).toHaveURL(/page=configure/);
        await expect.poll(() => setupRequests.length).toBeGreaterThan(0);
        const request = new URL(setupRequests.at(-1)!);
        expect(request.searchParams.get('slot')).toBe('current');
        expect(request.searchParams.has('operationId')).toBe(false);
        expect(new URL(page.url()).searchParams.has('acquisition')).toBe(false);
    });

    test('a paused update keeps its recovery controls beside the current version', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        const currentDigest = `sha256-${'a'.repeat(64)}`;
        const candidateDigest = `sha256-${'b'.repeat(64)}`;
        await page.route('**/api/plugins/marketplace/or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true,
                entry: { pluginId: 'or3.sample-utility', name: 'Sample Utility', releases: [{ version: '2.0.0' }] } }),
        }));
        await page.route('**/api/plugins/marketplace/preflight', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ...PREFLIGHT_INSTALLABLE,
                requestedVersion: '2.0.0', release: { ...PREFLIGHT_INSTALLABLE.release, version: '2.0.0' } }),
        }));
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: currentDigest }, candidate: { packageDigest: candidateDigest }, previous: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: currentDigest, issueCodes: [] },
                    display: { version: '1.0.0', selectedDigest: currentDigest,
                        candidateVersion: '2.0.0', candidateDigest, canOpen: true },
                }],
            }),
        }));
        await page.route('**/api/admin/plugins/acquisitions?pluginId=or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true,
                operations: [{ ...pausedOperation(), version: '2.0.0' }] }),
        }));
        await page.goto('/chat?dashboard=marketplace&page=discover&plugin=or3.sample-utility&version=2.0.0&workspace=ws_e2e&acquisition=op_disposable');
        await expect(page.getByTestId('marketplace-detail')).toContainText('Version 1.0.0 is selected');
        await expect(page.getByTestId('marketplace-continue')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
    });

    test('a selected update keeps confirmation and recovery visible after its candidate clears', async ({ page }) => {
        test.setTimeout(50_000);
        await stubMarketplace(page, { role: 'owner' });
        let promoted = false;
        const currentDigest = `sha256-${'a'.repeat(64)}`;
        const candidateDigest = `sha256-${'b'.repeat(64)}`;
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: promoted ? candidateDigest : currentDigest },
                        candidate: promoted ? null : { packageDigest: candidateDigest }, previous: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: promoted ? candidateDigest : currentDigest, issueCodes: [] },
                    display: { version: promoted ? '2.0.0' : '1.0.0', selectedDigest: promoted ? candidateDigest : currentDigest,
                        candidateVersion: promoted ? null : '2.0.0', candidateDigest: promoted ? null : candidateDigest, canOpen: true },
                }],
            }),
        }));
        await page.route('**/api/admin/plugins/acquisitions?pluginId=or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operations: [] }),
        }));
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/canary', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'passed' }),
        }));
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/promote', (route) => {
            promoted = true;
            return route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ workspaceEnablement: 'enabled' }) });
        });
        await page.goto('/chat?dashboard=marketplace&page=updates');
        await expect(page.getByTestId('marketplace-update-activate')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('marketplace-update-activate').click();
        await expect(page.getByTestId('marketplace-update-confirmation')).toContainText('Confirming the installed update', { timeout: 10_000 });
        await expect(page.getByTestId('marketplace-update-confirmation')).toContainText('The installation stands', { timeout: 35_000 });
        await expect(page.getByTestId('marketplace-update-retry-confirmation')).toBeVisible();
        await expect(page.getByTestId('marketplace-update-copy-diagnostics')).toBeVisible();
        expect(promoted).toBe(true);
    });

    test('a blocked promotion names the other workspace and links to its repair context', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        const currentDigest = `sha256-${'a'.repeat(64)}`;
        const candidateDigest = `sha256-${'b'.repeat(64)}`;
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: currentDigest }, candidate: { packageDigest: candidateDigest }, previous: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: currentDigest, issueCodes: [] },
                    display: { version: '1.0.0', selectedDigest: currentDigest,
                        candidateVersion: '2.0.0', candidateDigest, canOpen: true },
                }],
            }),
        }));
        await page.route('**/api/admin/plugins/acquisitions?pluginId=or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operations: [] }),
        }));
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/canary', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'passed' }),
        }));
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/promote', (route) => route.fulfill({
            status: 409, contentType: 'application/json', body: JSON.stringify({
                statusCode: 409, statusMessage: 'Workspace setup required', data: {
                    code: 'workspace-preflight-blocked', blockingCount: 1,
                    blockingWorkspaces: [{ workspaceId: 'ws_other', code: 'setup-required' }],
                },
            }),
        }));
        await page.goto('/chat?dashboard=marketplace&page=updates');
        await page.getByTestId('marketplace-update-activate').click({ timeout: 30_000 });
        await expect(page.getByTestId('marketplace-update-workspace-blocks')).toContainText('ws_other · setup-required', { timeout: 10_000 });
        await page.getByTestId('marketplace-update-workspace-blocks').getByRole('link', { name: 'Open workspace setup' }).click();
        await expect(page.getByTestId('marketplace-workspace-mismatch')).toBeVisible({ timeout: 30_000 });
    });

    test('restore opens one exact impact review from the plugin detail', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        const currentDigest = `sha256-${'a'.repeat(64)}`;
        const previousDigest = `sha256-${'b'.repeat(64)}`;
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: currentDigest }, previous: { packageDigest: previousDigest }, candidate: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: currentDigest, issueCodes: [] },
                    display: { version: '2.0.0', selectedDigest: currentDigest, canOpen: true },
                }],
            }),
        }));
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/rollback-review', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                ok: true, pluginId: 'or3.sample-utility', currentVersion: '2.0.0', previousVersion: '1.0.0',
                currentDigest, previousDigest, pointerRevision: 3, enabledWorkspaces: 2,
                enabledWorkspaceIds: ['ws_e2e', 'ws_other'], enabledWorkspaceSha256: `sha256-${'c'.repeat(64)}`, blocking: [],
            }),
        }));
        await page.goto('/chat?dashboard=marketplace&page=installed');
        await expect(page.getByTestId('marketplace-installed')).toBeVisible();
        await expect(page.getByTestId('marketplace-installed').getByRole('button', { name: 'Restore previous version' })).toHaveCount(0);
        await page.getByTestId('marketplace-installed').getByRole('link', { name: 'View details' }).click();
        await page.getByTestId('marketplace-installed-rollback').click();
        await expect(page.getByRole('paragraph').filter({ hasText: '2.0.0 → 1.0.0' })).toBeVisible();
        await page.getByText('Workspaces affected (2)').click();
        await expect(page.getByText('ws_other')).toBeVisible();
    });

    test('update consent binds the enabled workspace set and a stale set never starts acquisition', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        const enabledWorkspaceSha256 = `sha256-${'e'.repeat(64)}`;
        const proposed = { ...PREFLIGHT_INSTALLABLE.release, version: '2.0.0',
            requestedGrants: ['settings.read'], approvalRequired: true,
            affectedWorkspaces: 1000, enabledWorkspaceSha256,
            addedAccess: [{ kind: 'grant-added', detail: 'settings.read' }],
            authority: { trust: 'isolated-client', grants: ['settings.read'], features: [], engines: [],
                destinations: [], connectionScopes: [], dataScopes: [], writes: [], setupHooks: [], dependencies: [] },
        };
        await page.route('**/api/admin/plugins-page', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                    pluginId: 'or3.sample-utility', workspaceEnabled: true,
                    pointer: { current: { packageDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256 }, candidate: null, previous: null },
                    startup: { status: 'ready', selectedSlot: 'current', selectedDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256, issueCodes: [] },
                    display: { version: '1.0.0', selectedDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256, canOpen: true },
                }],
            }),
        }));
        await page.route('**/api/admin/plugins/updates', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: true,
                checkedAt: Date.now(), plugins: [{ pluginId: 'or3.sample-utility', installedVersion: '1.0.0',
                    latestVersion: '2.0.0', status: 'update-available', release: proposed }] }),
        }));
        let approvalBody: Record<string, unknown> | null = null;
        let starts = 0;
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/grants', async (route) => {
            approvalBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({ status: 409, contentType: 'application/json',
                body: JSON.stringify({ statusCode: 409, statusMessage: 'The enabled workspace set changed since review.' }) });
        });
        await page.route('**/api/admin/plugins/acquisitions', (route) => {
            starts += 1;
            return route.fulfill({ status: 500, body: 'Unexpected acquisition' });
        });
        await page.goto('/chat?dashboard=marketplace&page=updates');
        await expect(page.getByTestId('marketplace-updates')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('marketplace-update-check').click();
        await expect(page.getByTestId('marketplace-update-available')).toContainText('1,000 enabled workspace', { timeout: 10_000 });
        await page.getByTestId('marketplace-update-grant-approve').check();
        await page.getByTestId('marketplace-update-review').click();
        await expect.poll(() => approvalBody).not.toBeNull();
        expect(approvalBody).toMatchObject({ deploymentWide: true, version: '2.0.0',
            expectedEnabledWorkspaceSha256: enabledWorkspaceSha256, expectedWorkspaceId: 'ws_e2e' });
        expect(starts).toBe(0);
    });

    test('install consent precedes a setup pause and the same operation resumes after return', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        const reviewed = { ...PREFLIGHT_INSTALLABLE, release: {
            ...PREFLIGHT_INSTALLABLE.release, requestedGrants: ['settings.read'],
            authority: { trust: 'isolated-client', grants: ['settings.read'], features: [], engines: [],
                destinations: [], connectionScopes: [], dataScopes: [], writes: [], setupHooks: [], dependencies: [] },
        } };
        await page.unroute('**/api/plugins/marketplace/preflight');
        await page.route('**/api/plugins/marketplace/preflight', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(reviewed),
        }));
        let approved = false;
        let starts = 0;
        await page.route('**/api/admin/plugins/packages/or3.sample-utility/grants', (route) => {
            approved = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await page.route('**/api/admin/plugins/acquisitions?pluginId=or3.sample-utility', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operations: starts ? [pausedOperation()] : [] }),
        }));
        await page.route('**/api/admin/plugins/acquisitions', (route) => {
            starts += 1;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operation: pausedOperation() }) });
        });
        await page.route('**/api/admin/plugins/acquisitions/op_disposable/status', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, operation: pausedOperation() }),
        }));
        await page.goto('/chat?dashboard=marketplace&plugin=or3.sample-utility&version=1.0.0&workspace=ws_e2e');
        const install = page.getByTestId('marketplace-install');
        await expect(install).toBeDisabled({ timeout: 30_000 });
        await page.getByTestId('marketplace-grant-approve').check();
        await expect(install).toBeEnabled();
        await install.click();
        await expect(page.getByTestId('marketplace-continue')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
        expect(approved).toBe(true);
        expect(starts).toBe(1);
        await page.getByRole('button', { name: 'Finish setup' }).click();
        await expect(page.getByTestId('marketplace-configure')).toBeVisible();
        await page.getByRole('button', { name: 'Back to installation' }).click();
        await expect(page.getByTestId('marketplace-detail')).toBeVisible();
        await expect(page.getByTestId('marketplace-continue')).toBeVisible();
        expect(starts).toBe(1);
    });

    test('an old Configure link is rejected instead of editing a newer candidate', async ({ page }) => {
        await stubMarketplace(page, { role: 'owner' });
        let requestedPlanUrl = '';
        await page.route('**/api/plugins/or3.sample-utility/setup-plan*', (route) => {
            requestedPlanUrl = route.request().url();
            return route.fulfill({ status: 409, contentType: 'application/json',
                body: JSON.stringify({ statusCode: 409, statusMessage: 'This install operation is no longer pending.' }) });
        });
        await page.goto('/chat?dashboard=marketplace&page=configure&plugin=or3.sample-utility&workspace=ws_e2e&version=1.0.0&acquisition=acq_old&from=discover');
        await expect(page.getByTestId('marketplace-configure')).toBeVisible();
        await expect(page.getByRole('alert').filter({ hasText: 'setup link is stale' })).toBeVisible();
        expect(new URL(requestedPlanUrl).searchParams.get('operationId')).toBe('acq_old');
        expect(new URL(requestedPlanUrl).searchParams.get('version')).toBe('1.0.0');
        expect(new URL(requestedPlanUrl).searchParams.get('workspace')).toBe('ws_e2e');
    });

    test('a workspace rollout reopens with server progress after the browser page closes', async ({ page }) => {
        const rolloutId = `rol_${'f'.repeat(32)}`;
        let mutation: { processing: boolean; failure: string | null } | null = null;
        const operation = { id: rolloutId, revision: 12, pluginId: 'or3.sample-utility', status: 'running',
            packageDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256, enabled: true, selection: 'all-existing',
            includeFutureWorkspaces: false, futureDefaultApplied: false, total: 25, filteredTotal: 25,
            alreadyEnabled: 0, toChange: 25, previouslyDisabled: 25, previewBlocked: 0, permissionReviewsNeeded: 0,
            counts: { pending: 1, applied: 24, 'already-applied': 0, blocked: 0, failed: 0, skipped: 0 },
            page: 1, items: [],
        };
        const installRoutes = async (target: Page) => {
            await stubMarketplace(target, { role: 'owner' });
            await target.route('**/api/admin/plugins-page', (route) => route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify({
                    workspaceId: 'ws_e2e', role: 'owner', canManageSitePlugins: true,
                    enabledPlugins: ['or3.sample-utility'], plugins: [], packagePlugins: [{
                        pluginId: 'or3.sample-utility', workspaceEnabled: true,
                        pointer: { current: { packageDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256 }, candidate: null, previous: null },
                        startup: { status: 'ready', selectedSlot: 'current', selectedDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256, issueCodes: [] },
                        display: { version: '1.0.0', selectedDigest: PREFLIGHT_INSTALLABLE.release.packageTreeSha256, canOpen: true },
                    }],
                }),
            }));
            await target.route('**/api/admin/plugins/rollouts/workspaces*', (route) => route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }),
            }));
            await target.route(`**/api/admin/plugins/rollouts/${rolloutId}*`, (route) => route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify({ operation, release: null, mutation }),
            }));
        };
        const link = `/chat?dashboard=marketplace&plugin=or3.sample-utility&workspace=ws_e2e&rollout=${rolloutId}`;
        await installRoutes(page);
        await page.goto(link);
        await expect(page.getByRole('region', { name: 'Workspace plugin rollout' })).toContainText('Applied 24', { timeout: 30_000 });
        await page.close();
        const reopened = await page.context().newPage();
        await installRoutes(reopened);
        await reopened.goto(link);
        await expect(reopened.getByRole('region', { name: 'Workspace plugin rollout' })).toContainText('Applied 24', { timeout: 30_000 });
        await expect(reopened.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
        await reopened.route(`**/api/admin/plugins/rollouts/${rolloutId}/continue`, (route) => route.fulfill({
            status: 202, contentType: 'application/json', body: JSON.stringify({ operation, processing: true }),
        }));
        await reopened.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(reopened.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
        mutation = { processing: false, failure: 'The reviewed release changed' };
        await reopened.getByRole('button', { name: 'Refresh progress' }).click();
        await expect(reopened.getByRole('alert')).toContainText('The reviewed release changed');
        await expect(reopened.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
        await reopened.close();
    });

    test('an unconfigured instance explains the gap instead of showing an empty store', async ({
        page,
    }) => {
        await stubMarketplace(page, { role: 'owner' });
        await page.unroute('**/api/plugins/marketplace/catalog*');
        await page.route('**/api/plugins/marketplace/catalog*', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ configured: false, catalog: null }),
            })
        );
        await openMarketplace(page);
        await expect(page.getByTestId('marketplace-unconfigured')).toBeVisible({
            timeout: 30_000,
        });
    });

    test('mobile layout keeps one primary action and no nested dialogs', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 844 });
        await stubMarketplace(page, { role: 'owner' });
        await page.unroute('**/api/plugins/marketplace/preflight');
        await page.route('**/api/plugins/marketplace/preflight', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({
                ...PREFLIGHT_BLOCKED, blocks: [{ ...PREFLIGHT_BLOCKED.blocks[0],
                    message: `Registry error ${'x'.repeat(320)}` }],
            }),
        }));
        // The sidebar is a drawer at this width; the supported deep link opens
        // the same app without depending on the drawer's off-canvas state.
        await openMarketplaceDirect(page);
        await page.getByTestId('marketplace-card').first().click();
        await expect(page.getByTestId('marketplace-block').first()).toBeVisible();

        // Long names wrap instead of forcing horizontal scrolling.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(2);

        // The unsupported browser has no install action; the reason stays visible.
        await expect(page.getByTestId('marketplace-install')).toHaveCount(0);
        // The dashboard shell is the only dialog: the plugin detail renders in
        // place instead of stacking a nested modal over the dashboard.
        await expect(page.locator('[role="dialog"]')).toHaveCount(1);
        await expect(
            page.getByTestId('marketplace-discover').locator('[role="dialog"]')
        ).toHaveCount(0);
        await mkdir(qualificationDir, { recursive: true });
        await page.screenshot({ path: resolve(qualificationDir, 'mobile-discovery.png'), animations: 'disabled' });
        await writeFile(resolve(qualificationDir, 'receipt.json'), `${JSON.stringify({
            suite: 'marketplace-admin', browser: 'chromium', mobileWidth: 375,
            checks: ['approved catalog UI and remediation', 'member request', 'unconfigured registry',
                'workspace-bound deep link and session switch', 'scoped setup link', 'no stacked welcome',
                'keyboard focus returns to search', 'install guide entry', 'consent before setup', 'expired admin recovery', 'same operation after reload',
                'blocked update keeps current version', 'Installed Configure clears stale acquisition', 'paused update recovery beside current version',
                'update consent binds enabled workspace set', 'stale Configure link rejected',
                'single restore entry opens exact impact review',
                'rollout progress survives closed browser page',
                'mobile no overflow'],
            pluginId: 'or3.sample-utility', data: 'stubbed marketplace responses',
        }, null, 2)}\n`);
    });
});
