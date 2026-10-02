import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createRouter, toWebHandler } from 'h3';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionContext, WorkspaceRole } from '~/core/hooks/hook-types';
import { CanonicalStorageContractFixture } from '../../../sync/gateway/testing/canonical-storage-fixture';
import type { CanonicalStorageQueryRequest } from '../../../sync/gateway/types';

const fixtures = vi.hoisted(() => ({
    session: null as SessionContext | null,
    query: vi.fn(),
}));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: async () => fixtures.session }));
vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({ auth: { enabled: true }, storage: { enabled: true } }),
}));
vi.mock('../../../sync/gateway/registry', () => ({
    getActiveSyncGatewayAdapter: () => ({ queryCanonicalStorage: fixtures.query }),
}));
vi.mock('../../../storage/gateway/registry', async () => {
    const { FsStorageGatewayAdapter } = await import('../../../../node_modules/or3-provider-fs/dist/runtime/server/storage/fs-storage-gateway-adapter.js');
    return { getActiveStorageGatewayAdapter: () => new FsStorageGatewayAdapter() };
});

import presignRoute from '../presign-download.post';
import downloadRoute from '../../../../node_modules/or3-provider-fs/dist/runtime/server/api/storage/fs/download.get.js';
import { resolveFsObjectPath, getFsObjectMetadataPath } from '../../../../node_modules/or3-provider-fs/dist/runtime/server/storage/fs-paths.js';

describe('filesystem download HTTP isolation and signed-link lifetime', () => {
    let root: string;
    let request: ReturnType<typeof toWebHandler>;
    let memberships: Map<string, WorkspaceRole>;
    let canonical: Map<string, CanonicalStorageContractFixture>;
    const content = 'disposable-workspace-a-file';
    const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`;

    function select(userId: string, workspaceId: string) {
        fixtures.session = {
            authenticated: true, provider: 'fixture', providerUserId: userId,
            user: { id: userId }, workspace: { id: workspaceId },
            role: memberships.get(`${userId}:${workspaceId}`),
        } as SessionContext;
    }

    async function presign(workspaceId = 'ws-a', overrides: Record<string, unknown> = {}) {
        return request(new Request('http://fixture.test/presign', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspace_id: workspaceId, hash, ...overrides }),
        }));
    }

    async function issue() {
        select('alice', 'ws-a');
        const response = await presign();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        return await response.json() as { url: string; expiresAt: number };
    }

    async function download(url: string) {
        return request(new Request(new URL(url, 'http://fixture.test')));
    }

    beforeEach(async () => {
        vi.stubGlobal('useRuntimeConfig', () => ({ storage: { enabled: true } }));
        root = await mkdtemp('/tmp/or3-download-isolation-');
        vi.stubEnv('OR3_STORAGE_FS_ROOT', root);
        vi.stubEnv('OR3_STORAGE_FS_TOKEN_SECRET', 'disposable-fixture-signing-key-0123456789');
        vi.stubEnv('OR3_STORAGE_FS_URL_TTL_SECONDS', '60');
        memberships = new Map([
            ['alice:ws-a', 'owner'], ['alice:ws-b', 'editor'],
            ['bob:ws-a', 'editor'], ['bob:ws-b', 'owner'],
        ]);
        canonical = new Map(['ws-a', 'ws-b'].map((workspaceId) => [workspaceId, new CanonicalStorageContractFixture({ workspaceId })]));
        const objectPath = resolveFsObjectPath(root, 'ws-a', hash);
        await mkdir(dirname(objectPath), { recursive: true });
        await writeFile(objectPath, content);
        await writeFile(getFsObjectMetadataPath(objectPath), '{}');
        canonical.get('ws-a')!.records.push({
            kind: 'metadata', hash, storageId: `ws-a:${hash}`, sizeBytes: content.length,
            mimeType: 'image/png', fileKind: 'image', updatedAt: 1,
        });
        fixtures.query.mockReset().mockImplementation((_event, query: CanonicalStorageQueryRequest) => canonical.get(query.scope.workspaceId)!.query(query));
        const router = createRouter();
        router.post('/presign', presignRoute);
        router.get('/api/storage/fs/download', downloadRoute);
        request = toWebHandler(createApp().use(router));
        select('alice', 'ws-a');
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        await rm(root, { recursive: true, force: true });
    });

    it('serves an authorized owner and ignores forged provider object selection', async () => {
        const response = await presign('ws-a', { storage_id: 'ws-b:forged', mime_type: 'text/html' });
        expect(response.status).toBe(200);
        const body = await response.json();
        const file = await download(body.url);
        expect(file.status).toBe(200);
        expect(await file.text()).toBe(content);
        expect(file.headers.get('cache-control')).toContain('no-store');
        expect(file.headers.get('content-type')).toBe('image/png');
    });

    it('denies foreign workspace signing before querying its canonical metadata', async () => {
        select('bob', 'ws-b');
        const response = await presign('ws-a');
        expect(response.status).toBe(403);
        expect(fixtures.query).not.toHaveBeenCalled();
    });

    it('makes another workspace hash and a deleted metadata row indistinguishable', async () => {
        select('bob', 'ws-b');
        const foreign = await presign('ws-b');
        canonical.get('ws-a')!.records.length = 0;
        select('alice', 'ws-a');
        const deleted = await presign();
        expect(foreign.status).toBe(404);
        expect(deleted.status).toBe(404);
        expect((await foreign.json()).statusMessage).toBe((await deleted.json()).statusMessage);
    });

    it.each([
        ['another user in the same workspace', 'bob', 'ws-a', false],
        ['the owner after workspace switching', 'alice', 'ws-b', false],
        ['a removed member', 'alice', 'ws-a', true],
    ])('refuses an already-issued link for %s', async (_case, user, workspace, removed) => {
        const { url } = await issue();
        if (removed) memberships.delete('alice:ws-a');
        select(user as string, workspace as string);
        const response = await download(url);
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain(content);
    });

    it('preserves authorized viewer downloads after a role downgrade', async () => {
        const { url } = await issue();
        memberships.set('alice:ws-a', 'viewer');
        select('alice', 'ws-a');
        const response = await download(url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(content);
    });

    it('enforces the issued link expiry and rejects tampering', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { url, expiresAt } = await issue();
        const valid = await download(url);
        expect(valid.status).toBe(200);
        await valid.text();
        const tampered = await download(`${url}x`);
        expect(tampered.status).toBe(403);
        vi.setSystemTime(expiresAt + 1_000);
        const expired = await download(url);
        expect(expired.status).toBe(403);
        expect(await expired.text()).not.toContain(content);
    });
});
