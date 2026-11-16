import { Blob as NodeBlob } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createCloudBackupStreamCheck, scanCloudBackup } from '~~/shared/storage/workspace-archive';
import type { PendingOp } from '~~/shared/sync/types';
import { restoreCloudWorkspace } from '../cloud-workspace-backup';

const context = vi.hoisted(() => ({
    workspaceId: 'source',
    db: { syncHistoryAtOpen: 'history-I', sync_state: { get: async () => ({ phase: 'ready', historyIncarnation: 'history-I' }) } },
    update: vi.fn(),
}));
vi.mock('~/db/client', () => ({ getActiveWorkspaceId: () => context.workspaceId, getDb: () => context.db }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => ({ authenticated: true, user: { id: 'owner' }, workspace: { id: context.workspaceId } }),
}));
vi.mock('~/core/workspace/gateway-workspace-api', () => ({
    createGatewayWorkspaceApi: () => ({
        create: async () => ({ id: 'destination' }),
        setActive: async ({ id }: { id: string }) => { context.workspaceId = id; },
        update: context.update,
    }),
}));
vi.mock('~/core/storage/transfer-queue', () => ({
    getStorageTransferQueue: () => ({
        getWorkspaceId: () => context.workspaceId,
        uploadDirect: async (row: object) => ({ ...row, storage_id: 'destination-object' }),
    }),
}));
vi.mock('~/core/storage/provider-registry', () => ({ getActiveStorageProvider: () => ({ commitUpload: true }) }));
vi.mock('~/core/storage/file-policy', () => ({ loadFilePolicy: async () => ({ maxUploadBytes: 1024 }) }));
afterEach(() => { vi.unstubAllGlobals(); context.workspaceId = 'source'; context.update.mockReset(); });

// Failure inventory: truncation, altered bytes, missing originals, duplicate file
// identities, and device secrets must all fail before creating a destination.
// Fixtures encode the wire format independently of the production writer.
function archive(options: { corrupt?: boolean; omitFile?: boolean; truncate?: boolean; secret?: boolean; body?: string; extraRows?: number } = {}) {
    const chunks: Uint8Array[] = [new TextEncoder().encode('OR3CLOUD1\n')];
    const digest = createHash('sha256');
    const append = (header: object, body = new Uint8Array()) => {
        const line = new TextEncoder().encode(JSON.stringify(header) + '\n');
        chunks.push(line, body); digest.update(line); digest.update(body);
    };
    append({ type: 'meta', version: 1, size: 0, workspaceName: 'Original workspace' });
    const bytes = new TextEncoder().encode(options.body ?? 'original');
    const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const meta = { hash, name: 'original.txt', mime_type: 'text/plain', kind: 'file', size_bytes: bytes.length, storage_id: 'source-object', storage_provider_id: 'fs', ref_count: 1, clock: 1, created_at: 1, updated_at: 1, deleted: false };
    const row = new TextEncoder().encode(JSON.stringify(meta));
    append({ type: 'row', table: 'file_meta', size: row.length }, row);
    for (let index = 0; index < (options.extraRows ?? 0); index++) {
        const extra = new TextEncoder().encode(JSON.stringify({ id: `setting-${index}`, name: `setting-${index}`, value: 'saved', clock: 1, created_at: 1, updated_at: 1, deleted: false }));
        append({ type: 'row', table: 'kv', size: extra.length }, extra);
    }
    if (options.secret) {
        const secret = new TextEncoder().encode(JSON.stringify({ id: 'kv:openrouter_api_key', name: 'openrouter_api_key', value: 'secret', clock: 1, created_at: 1, updated_at: 1, deleted: false }));
        append({ type: 'row', table: 'kv', size: secret.length }, secret);
    }
    if (!options.omitFile) append({ type: 'file', hash, size: bytes.length }, bytes);
    if (!options.truncate) chunks.push(new TextEncoder().encode(JSON.stringify({ type: 'end', size: 0, rows: (options.secret ? 2 : 1) + (options.extraRows ?? 0), files: options.omitFile ? 0 : 1, sha256: digest.digest('hex') }) + '\n'));
    if (options.corrupt) chunks[chunks.length - 2] = new TextEncoder().encode('corrupt!');
    return new NodeBlob(chunks) as unknown as Blob;
}
it('validates a complete archive without materializing its original into memory', async () => {
    const file = archive();
    const found: string[] = [];
    const meta = await scanCloudBackup(file, async frame => { if (frame.header.type === 'file') found.push(await frame.body.text()); });
    expect(meta.workspaceName).toBe('Original workspace');
    expect(found).toEqual(['original']);
});
it.each([{ truncate: true }, { corrupt: true }, { omitFile: true }, { secret: true }])('rejects an unsafe archive %j', async options => {
    await expect(scanCloudBackup(archive(options))).rejects.toThrow();
});

// Failure inventory for download completion: headers can cross network chunks;
// an original can itself end with JSON resembling the archive terminal marker.
it('recognizes a complete download with arbitrarily split frames', async () => {
    const check = createCloudBackupStreamCheck();
    for (const byte of new Uint8Array(await archive().arrayBuffer())) check.write(Uint8Array.of(byte));
    expect(() => check.finish()).not.toThrow();
});
it('rejects a truncated download whose original imitates a terminal marker', async () => {
    const check = createCloudBackupStreamCheck();
    check.write(new Uint8Array(await archive({ truncate: true,
        body: `\n${JSON.stringify({ type: 'end', size: 0, rows: 1, files: 1, sha256: 'a'.repeat(64) })}\n`,
    }).arrayBuffer()));
    expect(() => check.finish()).toThrow();
});

// Real archive restore + gateway transport: discovery, paged identity binding,
// rate-limit retry and partial-batch failure were absent from archive-only tests.
it.each(['stable', 'snapshot-reset', 'push-reset', 'snapshot-response-reset', 'push-response-reset'] as const)(
    'restores only within one gateway history (%s)', async mode => {
        const file = archive({ extraRows: 50 });
        const saved: PendingOp[] = [];
        const requests: Array<{ path: string; historyIncarnation?: string | null }> = [];
        let history = 'history-I';
        let pushAttempts = 0;
        let snapshotPages = 0;
        const reply = (body: unknown, status = 200, headers?: Record<string, string>) =>
            new Response(JSON.stringify(body), { status, headers });
        vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            requests.push({ path, historyIncarnation: body.historyIncarnation });
            expect(body.scope.workspaceId).toBe('destination');
            expect(body.historyIncarnationCapability).toBe('incarnation-v1');
            if (path.endsWith('/snapshot')) {
                snapshotPages++;
                if (body.pageToken && mode === 'snapshot-reset') history = 'history-J';
                if (body.historyIncarnation !== history && !(body.historyIncarnation === null && !body.pageToken)) {
                    return reply({ data: { code: 'OR3_SYNC_HISTORY_CHANGED', historyIncarnation: history, requiresSnapshot: true } }, 409);
                }
                if (body.pageToken && mode === 'snapshot-response-reset') history = 'history-J';
                const hash = 'sha256:' + createHash('sha256').update('original').digest('hex');
                return reply({ historyIncarnation: history, workspaceId: 'destination', snapshotId: 'snapshot-I', highWatermark: 1,
                    items: body.pageToken ? [] : [{ kind: 'row', tableName: 'file_meta', pk: hash, payload: {}, revision: { clock: 8, hlc: 'saved', opId: 'upload' } }],
                    nextPageToken: body.pageToken ? null : 'page-2' });
            }
            expect(path).toBe('/api/sync/push');
            pushAttempts++;
            if (saved.length && mode === 'push-reset') history = 'history-J';
            if (body.historyIncarnation !== history) {
                return reply({ data: { code: 'OR3_SYNC_HISTORY_CHANGED', historyIncarnation: history, requiresSnapshot: true } }, 409);
            }
            if (mode === 'stable' && pushAttempts === 1) return reply({}, 429, { 'Retry-After': '1' });
            saved.push(...body.ops);
            if (mode === 'push-response-reset') history = 'history-J';
            return reply({ historyIncarnation: history, serverVersion: saved.length,
                results: body.ops.map((op: PendingOp) => ({ opId: op.stamp.opId, success: true, applied: true })) });
        });
        const session = { refresh: async () => {} } as Parameters<typeof restoreCloudWorkspace>[1];
        const progress = vi.fn();
        if (mode === 'stable') {
            await restoreCloudWorkspace(file, session, progress);
            expect(saved).toHaveLength(51);
            expect(saved[0]?.payload).toMatchObject({ storage_id: 'destination-object', clock: 9 });
            expect(context.workspaceId).toBe('destination');
            expect(context.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Original workspace (restored)' }));
            expect(progress).toHaveBeenLastCalledWith(100);
            expect(pushAttempts).toBe(3);
        } else {
            await expect(restoreCloudWorkspace(file, session, progress)).rejects.toThrow(/incomplete.*history changed/i);
            expect(context.workspaceId).toBe('source');
            expect(context.update).not.toHaveBeenCalled();
            expect(saved).toHaveLength(mode === 'push-reset' || mode === 'push-response-reset' ? 50 : 0);
        }
        expect(snapshotPages).toBe(2);
        expect(requests[0]?.historyIncarnation).toBeNull();
        expect(requests.slice(1).every(request => request.historyIncarnation === 'history-I')).toBe(true);
        expect(await file.text()).toContain('source-object');
    }
);
