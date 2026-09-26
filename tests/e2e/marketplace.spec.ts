import { expect, test, type Page } from '@playwright/test';

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
}

async function openMarketplace(
    page: Page,
    pageTitle = 'Discover'
): Promise<void> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
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
    test('an owner can browse and sees the exact reason an install is blocked', async ({ page }) => {
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
        // The install button stays disabled while a block is unresolved.
        await expect(page.getByTestId('marketplace-install')).toBeDisabled();
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
        await page.setViewportSize({ width: 390, height: 844 });
        await stubMarketplace(page, { role: 'owner' });
        // The sidebar is a drawer at this width; the supported deep link opens
        // the same app without depending on the drawer's off-canvas state.
        await openMarketplaceDirect(page);
        await page.getByTestId('marketplace-card').first().click();

        // Long names wrap instead of forcing horizontal scrolling.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(2);

        // One visible primary action: the install button.
        expect(await page.getByTestId('marketplace-install').count()).toBe(1);
        // The dashboard shell is the only dialog: the plugin detail renders in
        // place instead of stacking a nested modal over the dashboard.
        await expect(page.locator('[role="dialog"]')).toHaveCount(1);
        await expect(
            page.getByTestId('marketplace-discover').locator('[role="dialog"]')
        ).toHaveCount(0);
    });
});
