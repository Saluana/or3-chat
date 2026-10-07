import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import connections from './fixtures/plugin-host-retirement/legacy-connections.json' with { type: 'json' };
import vault from './fixtures/plugin-host-retirement/legacy-vault.json' with { type: 'json' };

test.skip(process.env.OR3_PLUGIN_HOST_RETIREMENT_HARNESS !== 'true', 'Requires the disposable installed host.');

// Upgrade boundary: lost hosts, changed encrypted bytes, premature deletion,
// repeated approval, lost authorization, or requesting the token again. Fixture
// HTTP responses exercise the real governed transport and PIN decryption.
test('upgrades saved 0.1.1 hosts and encrypted credentials without token re-entry', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const password = process.env.OR3_AGENT_INSTALLED_TEST_PASSWORD;
    expect((await page.request.post('/api/basic-auth/sign-in', { headers: { origin }, data: { email: process.env.OR3_AGENT_INSTALLED_TEST_EMAIL, password } })).ok()).toBe(true);
    expect((await page.request.post('/api/admin/auth/login', { headers: { origin }, data: { username: process.env.OR3_AGENT_INSTALLED_TEST_USERNAME, password } })).ok()).toBe(true);
    const session = await (await page.request.get('/api/auth/session')).json();
    const workspaceId = session.session.workspace.id;
    const enabled = async (value: boolean) => {
        expect((await page.request.post('/api/admin/plugins/workspace-enable', { headers: { origin, 'x-or3-admin-intent': 'admin' }, data: { pluginId: 'or3-external-agents', workspaceId, enabled: value } })).ok()).toBe(true);
    };
    let approvals = 0;
    const authenticated: string[] = [];
    page.on('dialog', async dialog => { approvals++; await dialog.accept(); });
    await page.route('https://legacy.example/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'OPTIONS') {
            expect(request.headers().authorization).toBe(`Bearer ${vault.expected}`);
            authenticated.push(path);
        }
        const body = path.endsWith('/health') ? { status: 'ok', runtimeAvailable: true, jobRegistryAvailable: true, approvalBrokerAvailable: true, processId: 1, startedAt: '2026-08-01T00:00:00.000Z' }
            : path.endsWith('/capabilities') ? { runtimeProfile: 'local', hosted: false, hostId: 'legacy-host', approvalBroker: { available: true, enabled: true }, approvals: {}, execAvailable: true, sandboxEnabled: false, sandboxRequired: false, networkPolicy: {} }
            : path.endsWith('/chat-runners') ? { runners: [] }
            : path.endsWith('/sessions') ? { sessions: [] }
            : { status: 'ready', ready: true };
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }, body: JSON.stringify(body) });
    });
    try {
        await enabled(false);
        await page.goto('/chat');
        const welcome = page.locator('[data-welcome-card]');
        await expect(welcome).toBeVisible();
        await welcome.getByRole('button', { name: 'Dismiss welcome' }).click();
        await page.evaluate(async ({ connections, vault }) => {
            const source = await (await fetch('/_nuxt/composables/plugins/trusted-host-context.ts')).text();
            const dbUrl = source.match(/from ["']([^"']+\/db\/client\.ts[^"']*)["']/u)?.[1];
            if (!dbUrl) throw new Error('Host database module unavailable');
            const { getDb } = await import(/* @vite-ignore */ dbUrl);
            const { setKvByName, tombstoneKvByName } = await import(/* @vite-ignore */ `/_nuxt/db/kv.ts`);
            const db = getDb();
            await tombstoneKvByName('or3.plugin.or3-external-agents.storage.connections', db);
            await tombstoneKvByName('or3.plugin-host.or3-external-agents.network-approvals', db);
            await setKvByName(connections.key, connections.value, db);
            localStorage.removeItem('or3.plugin.or3-external-agents.secret.vault');
            localStorage.setItem(vault.key, vault.value);
        }, { connections, vault });
        await enabled(true);
        await page.reload();
        await expect(page.getByRole('button', { name: 'Agents', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Agents', exact: true }).click();
        await page.locator('section[aria-label="Agents"]').getByRole('button', { name: 'Connection settings' }).click();
        await expect(page.getByLabel('Device PIN', { exact: true })).toBeVisible();
        await page.getByLabel('Device PIN', { exact: true }).fill(vault.pin);
        await page.getByRole('button', { name: 'Unlock Legacy Host', exact: true }).click();
        await expect.poll(() => authenticated.includes('/internal/v1/health')).toBe(true);
        await expect(page.getByLabel('Device PIN', { exact: true })).toBeHidden();
        expect(approvals).toBe(1);
        const migrated = await page.evaluate(async ({ key, value }) => {
            const source = await (await fetch('/_nuxt/composables/plugins/trusted-host-context.ts')).text();
            const url = source.match(/from ["']([^"']+\/db\/client\.ts[^"']*)["']/u)![1]!;
            const { getDb } = await import(/* @vite-ignore */ url);
            const { getKvByName } = await import(/* @vite-ignore */ '/_nuxt/db/kv.ts');
            const db = getDb();
            const sourceRow = await getKvByName(key, db);
            const scoped = await getKvByName('or3.plugin.or3-external-agents.storage.connections', db);
            return { legacyDeleted: !sourceRow || Boolean(sourceRow.deleted), scoped: JSON.parse(scoped.value), legacyVaultRemoved: localStorage.getItem('or3.external-agents.credentials.v1') === null, vaultPreserved: localStorage.getItem('or3.plugin.or3-external-agents.secret.vault') === value };
        }, { key: connections.key, value: vault.value });
        expect(migrated.legacyDeleted).toBe(true);
        expect(migrated.legacyVaultRemoved).toBe(true);
        expect(migrated.vaultPreserved).toBe(true);
        expect(JSON.parse(migrated.scoped).hosts[0]).toMatchObject({ id: 'legacy-host', credentialRef: vault.reference });
        await page.reload();
        await expect(page.getByRole('button', { name: 'Agents', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Agents', exact: true }).click();
        await expect(page.locator('section[aria-label="Agents"]')).toContainText('Legacy Host');
        expect(approvals).toBe(1);
        const dir = resolve('output/playwright/plugin-host-retirement');
        await mkdir(dir, { recursive: true });
        await page.screenshot({ path: resolve(dir, 'agents-upgraded.png'), animations: 'disabled' });
        await writeFile(resolve(dir, 'upgrade.json'), `${JSON.stringify({ approvals, authenticated, ...migrated }, null, 2)}\n`);
    } finally { await enabled(true); }
});
