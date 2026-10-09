import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { defaultProjectSettings, PROJECT_POST_TYPES } from '../../shared/projects/workspace';

const adminCredentials = {
    username: process.env.OR3_ADMIN_E2E_USERNAME ?? '',
    password: process.env.OR3_ADMIN_E2E_PASSWORD ?? '',
};

function isTempDataDirectory(candidate: string): boolean {
    if (!isAbsolute(candidate)) return false;

    const resolved = resolve(candidate);
    const tempRoots = [
        resolve(tmpdir()),
        '/tmp',
        '/private/tmp',
        '/var/folders',
        '/private/var/folders',
    ];
    return tempRoots.some(
        (root) =>
            resolved.startsWith(`${root}${sep}or3-admin-auth-e2e-`)
    );
}

const configuredAdminDataDir = process.env.OR3_ADMIN_DATA_DIR ?? '';
const isolatedAdminHarnessReady =
    process.env.OR3_ADMIN_AUTH_E2E_HARNESS === 'true' &&
    isTempDataDirectory(configuredAdminDataDir) &&
    resolve(configuredAdminDataDir) !== resolve(process.cwd(), '.data') &&
    Boolean(adminCredentials.username && adminCredentials.password);

test.describe('OR3 Cloud Auth Integration', () => {
    test.beforeEach(async ({ context }) => {
        if (!isolatedAdminHarnessReady) return;
        // This lane uses disposable local stores and never needs a provider API.
        await context.route('**/*', (route) => {
            const host = new URL(route.request().url()).hostname;
            return host === '127.0.0.1' || host === 'localhost'
                ? route.continue()
                : route.abort('blockedbyclient');
        });
    });

    test('Base app exposes auth session endpoint and login UI', async ({ page }) => {
        const response = await page.request.get('/api/auth/session');
        expect(response.ok()).toBeTruthy();

        const payload = await response.json();
        expect(payload).toEqual({
            session: null,
            appAccessAllowed: false,
        });

        const cacheControl = response.headers()['cache-control'];
        expect(cacheControl).toContain('no-store');

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await expect(
            page.getByRole('button', { name: /sign in|login/i })
        ).toBeVisible();
    });

    test('Admin routes redirect unauthenticated users to login', async ({ page }) => {
        await page.goto('/admin');
        await page.waitForLoadState('networkidle');

        expect(page.url()).toContain('/admin/login');
        await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();
    });

    test('Admin login establishes a session', async ({ page }, info) => {
        test.skip(
            !isolatedAdminHarnessReady,
            'Requires OR3_ADMIN_AUTH_E2E_HARNESS=true, credentials, and an absolute temporary OR3_ADMIN_DATA_DIR'
        );

        const sessionProbe = await page.request.get('/api/admin/auth/session');
        if (sessionProbe.status() === 404) {
            test.skip(true, 'Admin is disabled in this environment');
        }

        await page.goto('/admin/login');
        const origin = new URL(page.url()).origin;

        const loginResponse = await page.request.post('/api/admin/auth/login', {
            data: {
                username: adminCredentials.username,
                password: adminCredentials.password,
            },
            headers: {
                origin,
                'x-or3-admin-intent': 'admin',
            },
        });

        if (!loginResponse.ok()) {
            const text = await loginResponse.text();
            throw new Error(`Admin login failed: ${loginResponse.status()} ${text}`);
        }

        expect(loginResponse.headers()['set-cookie']).toBeTruthy();

        await page.goto('/admin/workspaces');

        const sessionResponse = await page.request.get('/api/admin/auth/session');
        expect(sessionResponse.ok()).toBeTruthy();

        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.authenticated).toBe(true);
        expect(['super_admin', 'workspace_admin']).toContain(sessionPayload.kind);
        const evidencePath = info.outputPath('admin-auth-session.json');
        writeFileSync(evidencePath, JSON.stringify({
            authenticated: sessionPayload.authenticated,
            kind: sessionPayload.kind,
            localProvider: process.env.OR3_SYNC_PROVIDER,
        }, null, 2));
        await info.attach('admin-auth-session', {
            path: evidencePath,
            contentType: 'application/json',
        });
    });
});

if (process.env.OR3_WORKSPACE_CLOUD_E2E === 'true') {
    test('workspace cloud profile distinguishes queued local files from synced originals', async ({ page }, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1600, height: 1000 });
        const origin = new URL(info.project.use.baseURL!).origin;
        const login = await page.request.post('/api/basic-auth/sign-in', {
            headers: { origin, 'x-or3-cloud-intent': 'mutation' },
            data: { email: process.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL, password: process.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD },
        });
        expect(login.ok(), await login.text()).toBe(true);
        await page.goto('/');
        const welcome = page.getByRole('button', { name: 'Dismiss welcome', exact: true });
        await welcome.click({ timeout: 30_000 });
        await page.getByRole('button', { name: 'Files', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Workspace Files', exact: true })).toBeVisible();
        // Warm production intake and preview chunks before cutting the network.
        // Development assets are lazy-loaded, independently of storage/sync I/O.
        const warmName = 'warm-' + randomUUID() + '.txt';
        await page.getByLabel('Upload files', { exact: true }).setInputFiles({ name: warmName, mimeType: 'text/plain', buffer: Buffer.from('Warm original') });
        await page.getByRole('button', { name: 'Open ' + warmName, exact: true }).click();
        const warmPreview = page.getByRole('complementary', { name: 'File preview', exact: true });
        await expect(warmPreview).toContainText('Synced', { timeout: 60_000 });
        await warmPreview.getByRole('button', { name: 'Close', exact: true }).click();
        const name = 'queued-' + randomUUID() + '.txt';
        const bytes = Buffer.from('Queued original ' + randomUUID());
        await page.context().setOffline(true);
        try {
            await page.getByLabel('Upload files', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: bytes });
            await page.getByRole('button', { name: 'Open ' + name, exact: true }).click();
            const preview = page.getByRole('complementary', { name: 'File preview', exact: true });
            await expect(preview).toContainText('Saved locally · Waiting to sync');
            await info.attach('queued-original', { body: await page.screenshot(), contentType: 'image/png' });
        } finally { await page.context().setOffline(false); }
        await expect(page.getByRole('complementary', { name: 'File preview', exact: true })).toContainText('Synced', { timeout: 60_000 });
        await info.attach('synced-original', { body: await page.screenshot(), contentType: 'image/png' });
    });

    test('workspace cloud profile preserves catalog text and original bytes through authenticated sync', async ({ page, browser }, info) => {
        test.setTimeout(180_000);
        const directory = process.env.OR3_WORKSPACE_CLOUD_E2E_DIR ?? '';
        expect(isAbsolute(directory) && directory.includes('/or3-workspace-cloud-e2e-')).toBe(true);
        const origin = new URL(info.project.use.baseURL!).origin;
        const headers = { origin, 'x-or3-cloud-intent': 'mutation' };
        const signIn = async (request: typeof page.request) => {
            const response = await request.post('/api/basic-auth/sign-in', { headers,
                data: { email: process.env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL, password: process.env.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD } });
            expect(response.ok(), await response.text()).toBe(true);
            const session = await request.get('/api/auth/session');
            const payload = await session.json();
            expect(payload.appAccessAllowed).toBe(true);
            expect(payload.session.role).toBe('owner');
            return payload.session as { workspace: { id: string }; user: { id: string } };
        };
        const session = await signIn(page.request);
        const workspaceId = session.workspace.id;
        const bytes = Buffer.from('Saffron authenticated cloud catalog evidence.');
        const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        const presignResponse = await page.request.post('/api/storage/presign-upload', { headers,
            data: { workspace_id: workspaceId, hash, mime_type: 'text/plain', size_bytes: bytes.length, file_kind_capability: 'v1' } });
        expect(presignResponse.ok(), await presignResponse.text()).toBe(true);
        const presign = await presignResponse.json();
        const uploaded = await page.request.fetch(presign.url, { method: presign.method || 'POST', data: bytes, headers: { ...presign.headers, 'content-type': 'text/plain' } });
        const uploadBody = await uploaded.text();
        expect(uploaded.ok(), uploadBody).toBe(true);
        const uploadReceipt = uploadBody ? JSON.parse(uploadBody) : {};
        const storageId = presign.storageId ?? uploadReceipt.storageId;
        expect(typeof storageId).toBe('string');
        const storageProvider = process.env.NUXT_PUBLIC_STORAGE_PROVIDER;
        expect(['fs', 'convex']).toContain(storageProvider);
        const committed = await page.request.post('/api/storage/commit', { headers, data: {
            workspace_id: workspaceId, hash, storage_id: storageId, intent_id: presign.intentId,
            storage_provider_id: storageProvider, mime_type: 'text/plain', size_bytes: bytes.length,
            name: 'cloud-proof.txt', kind: 'file', file_kind_capability: 'v1',
        } });
        expect(committed.ok(), await committed.text()).toBe(true);
        const postId = 'workspace-cloud-proof';
        const metadata = { version: 1, trashed_at: null, text: { coverage: 'full', indexed_bytes: bytes.length } };
        const catalog = { id: postId, title: 'Authenticated cloud proof', post_type: 'or3:file', content: bytes.toString(),
            file_hashes: JSON.stringify([hash]), meta: JSON.stringify({ plugin_key: 'retain', 'or3.workspace-item': metadata }),
            created_at: 1, updated_at: 1, clock: 1, deleted: false };
        const op = (tableName: string, pk: string, payload: unknown, clock = 1) => ({ id: randomUUID(), tableName, pk, payload,
            operation: 'put', stamp: { deviceId: 'cloud-proof-device', opId: randomUUID(), hlc: `${Date.now()}:0:cloud-proof`, clock },
            createdAt: Date.now(), attempts: 0, status: 'pending' });
        const projectId = 'persistent-cloud-project';
        const projectRecord = (id: string, type: string, content: unknown, refs: string[] = []) => ({id,title:projectId,post_type:type,
            content:JSON.stringify(content),meta:JSON.stringify([{key:'or3.workspace-item',value:{version:1,projectRecord:true}}]),file_hashes:JSON.stringify(refs),clock:1,created_at:1,updated_at:1,deleted:false});
        const projectRecords = [
            projectRecord(`project-settings-${projectId}`,PROJECT_POST_TYPES.settings,{...defaultProjectSettings(),instructions:'Saffron cloud instructions',brief:'Saffron brief',tools:{github:{mode:'ask',resources:['owner/repo']}}}),
            projectRecord('persistent-cloud-memory',PROJECT_POST_TYPES.memory,{version:1,text:'Saffron explicit decision',kind:'decision'}),
            projectRecord('persistent-cloud-source',PROJECT_POST_TYPES.source,{version:1,item_id:postId,kind:'file',title:'Cloud knowledge',mode:'always',current_revision_id:'r2',
                revisions:[{id:'r1',original_hash:hash,text_hash:hash,status:'ready',coverage:'full',created_at:1,locations:[]},{id:'r2',original_hash:hash,text_hash:hash,status:'ready',coverage:'full',created_at:2,locations:[]}]},[hash]),
        ];
        const push = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId }, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [
            op('file_meta', hash, { hash, name: 'cloud-proof.txt', mime_type: 'text/plain', kind: 'file', size_bytes: bytes.length,
                ref_count: 1, storage_id: storageId, storage_provider_id: storageProvider, deleted: false, created_at: 1, updated_at: 1, clock: 1 }),
            op('posts', postId, catalog),
            op('projects',projectId,{id:projectId,name:'Persistent cloud project',data:[{kind:'file',id:postId}],clock:1,created_at:1,updated_at:1,deleted:false}),
            ...projectRecords.map(row => op('posts',row.id,row)),
        ] } });
        expect(push.ok(), await push.text()).toBe(true);
        expect((await push.json()).results.every((result: { success: boolean }) => result.success)).toBe(true);
        // The device loses the first response, then retries the exact operation.
        // A canonical replay must not allocate a second version or duplicate row.
        const retryOp = op('posts', 'cloud-replay-proof', { ...catalog, id: 'cloud-replay-proof', title: 'Replay proof' });
        const retryBody = { scope: { workspaceId }, fileKindCapability: 'v1', workspaceItemCapability: 'v1', ops: [retryOp] };
        const firstDelivery = await page.request.post('/api/sync/push', { headers, data: retryBody });
        expect(firstDelivery.ok()).toBe(true);
        const firstReceipt = await firstDelivery.json();
        const replay = await page.request.post('/api/sync/push', { headers, data: retryBody });
        expect(replay.ok()).toBe(true);
        const replayReceipt = await replay.json();
        expect(replayReceipt.serverVersion).toBe(firstReceipt.serverVersion);
        expect(replayReceipt.results).toEqual([expect.objectContaining({
            opId: retryOp.stamp.opId, success: true,
            serverVersion: firstReceipt.results[0].serverVersion,
        })]);
        const oldReader = await page.request.post('/api/sync/pull', { headers,
            data: { scope: { workspaceId }, cursor: 0, limit: 100, fileKindCapability: 'v1' } });
        expect(oldReader.status()).toBe(426);
        const oldWriter = await page.request.post('/api/sync/push', { headers, data: { scope: { workspaceId },
            ops: [op('posts', postId, { ...catalog, post_type: 'doc', meta: '' }, 2)] } });
        expect(oldWriter.status()).toBe(426);
        const second = await browser.newContext({ baseURL: origin });
        try {
            await signIn(second.request);
            const snapshot = await second.request.post('/api/sync/snapshot', { headers,
                data: { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
            expect(snapshot.ok(), await snapshot.text()).toBe(true);
            const snapshotItems = (await snapshot.json()).items;
            expect(snapshotItems).toContainEqual(expect.objectContaining({ kind: 'row', pk: postId, payload: expect.objectContaining(catalog) }));
            expect(snapshotItems.filter((item: { pk: string }) => item.pk === 'cloud-replay-proof')).toHaveLength(1);
            for (const record of projectRecords) expect(snapshotItems).toContainEqual(expect.objectContaining({pk:record.id,payload:expect.objectContaining(record)}));
            await info.attach('project-provider-roundtrip',{contentType:'application/json',body:JSON.stringify({projectId,hash,projectRecords:projectRecords.map(row=>({id:row.id,content:row.content,file_hashes:row.file_hashes})),assertions:['second authenticated device preserved settings, brief, tool allowlist, decisions and all source revisions']})});
            const download = await second.request.post('/api/storage/presign-download', { headers,
                data: { workspace_id: workspaceId, hash, storage_id: storageId, file_kind_capability: 'v1' } });
            expect(download.ok(), await download.text()).toBe(true);
            const original = await second.request.get((await download.json()).url);
            expect(original.ok()).toBe(true);
            expect(await original.body()).toEqual(bytes);
            const newDevice = await second.newPage();
            const moduleFailures: string[] = [];
            newDevice.on('requestfailed', request => moduleFailures.push(`${request.url()} ${request.failure()?.errorText}`));
            // Exercise the actual sync plugin and palette, not a test importer.
            await newDevice.goto('/');
            await expect(async () => {
                await newDevice.reload();
                await expect(newDevice.getByRole('button', { name: 'Open command palette' }).first()).toBeVisible({ timeout: 5_000 });
            }).toPass({ timeout: 45_000 });
            await info.attach('cloud-browser-module-loads', { body: JSON.stringify(moduleFailures), contentType: 'application/json' });
            await newDevice.getByRole('button', { name: 'Dismiss welcome', exact: true }).click({ timeout: 30_000 });
            const openPalette = async () => {
                await expect(async () => {
                    await newDevice.getByRole('button', { name: 'Open command palette' }).first().click();
                    await expect(newDevice.locator('[data-test="command-palette-input"]')).toBeVisible({ timeout: 1_000 });
                }).toPass({ timeout: 30_000 });
            };
            await openPalette();
            await newDevice.locator('[data-test="command-palette-input"]').fill('Saffron');
            await expect(newDevice.getByText('Authenticated cloud proof', { exact: true })).toBeVisible({ timeout: 30_000 });
            await newDevice.keyboard.press('Escape');
            await newDevice.reload();
            await openPalette();
            await newDevice.locator('[data-test="command-palette-input"]').fill('Saffron');
            await expect(newDevice.getByText('Authenticated cloud proof', { exact: true })).toBeVisible({ timeout: 30_000 });
            await info.attach('new-device-cloud-search', { body: await newDevice.screenshot(), contentType: 'image/png' });
            await info.attach('cloud-original-bytes', { body: bytes, contentType: 'text/plain' });
            await info.attach('cloud-canonical-snapshot', { body: JSON.stringify(await snapshot.json()), contentType: 'application/json' });
            const created = await second.request.post('/api/workspaces', { headers, data: { name: 'Isolated switch target' } });
            expect(created.ok(), await created.text()).toBe(true);
            const targetId = (await created.json()).id;
            const switched = await second.request.post('/api/workspaces/active', { headers, data: { id: targetId } });
            expect(switched.ok()).toBe(true);
            const staleScope = await second.request.post('/api/sync/snapshot', { headers,
                data: { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
            expect(staleScope.status()).toBe(403);
            const targetSnapshot = await second.request.post('/api/sync/snapshot', { headers,
                data: { scope: { workspaceId: targetId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
            expect(targetSnapshot.ok()).toBe(true);
            expect(await targetSnapshot.text()).not.toContain('Saffron');
            expect((await second.request.post('/api/workspaces/active', { headers, data: { id: workspaceId } })).ok()).toBe(true);

            const member = await browser.newContext({ baseURL: origin });
            try {
                const registered = await member.request.post('/api/basic-auth/register', { headers, data: {
                    email: 'member@example.test', password: 'DisposableMember!123', confirmPassword: 'DisposableMember!123',
                } });
                expect(registered.ok(), await registered.text()).toBe(true);
                const memberSession = await (await member.request.get('/api/auth/session')).json();
                const adminHeaders = { origin, 'x-or3-admin-intent': 'admin' };
                const adminLogin = await page.request.post('/api/admin/auth/login', { headers: adminHeaders, data: {
                    username: 'workspace-e2e-admin', password: 'DisposableAdminE2e!123',
                } });
                expect(adminLogin.ok(), await adminLogin.text()).toBe(true);
                const admitted = await page.request.post('/api/admin/workspace/members/upsert', { headers: adminHeaders, data: {
                    workspaceId, provider: 'basic-auth', emailOrProviderId: memberSession.session.providerUserId, role: 'viewer',
                } });
                expect(admitted.ok(), await admitted.text()).toBe(true);
                expect((await member.request.post('/api/workspaces/active', { headers, data: { id: workspaceId } })).ok()).toBe(true);
                const view = await member.request.post('/api/sync/snapshot', { headers,
                    data: { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
                expect(view.ok(), await view.text()).toBe(true);
                expect(await view.text()).toContain('Saffron');
                const denied = await member.request.post('/api/sync/push', { headers, data: retryBody });
                expect(denied.status()).toBe(403);
                const revoked = await page.request.post('/api/admin/workspace/members/remove', { headers: adminHeaders,
                    data: { workspaceId, userId: memberSession.session.user.id } });
                expect(revoked.ok(), await revoked.text()).toBe(true);
                const revokedRead = await member.request.post('/api/sync/snapshot', { headers,
                    data: { scope: { workspaceId }, pageSize: 100, fileKindCapability: 'v1', workspaceItemCapability: 'v1' } });
                expect(revokedRead.status()).toBe(403);
                const revokedDownload = await member.request.post('/api/storage/presign-download', { headers,
                    data: { workspace_id: workspaceId, hash, storage_id: storageId, file_kind_capability: 'v1' } });
                expect(revokedDownload.status()).toBe(403);
            } finally { await member.close(); }
        } finally { await second.close(); }
    });
}
