import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Or3DB } from '~/db/client';
import { cleanupFileCache, originCacheBytes } from '../file-cache';
import { DEFAULT_FILE_POLICY } from '~~/shared/storage/file-policy';

// Failure inventory: an old done marker can outlive its remote object; queued,
// failed and concurrent uploads can be the only copy; legacy bytes have no
// provenance; expiry must reclaim bytes only, preserving metadata/references.
// Protected or unavailable early rows must not starve later redundant bytes;
// equal access timestamps must still allow the bounded scan to advance.
// Real Dexie transactions own this contract; only the remote object I/O is faked.
let db: Or3DB;
const bytes = new TextEncoder().encode('original');
const hash = 'sha256:0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5';
const provider = { id: 'fs', getPresignedDownloadUrl: vi.fn(async () => ({ url: 'https://storage.test/original', storageId: 'object-1' })) };
beforeEach(async () => {
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    db = new Or3DB(`or3-cache-test-${crypto.randomUUID()}`);
    await db.open();
    await db.file_meta.put({ hash, name: 'original.txt', mime_type: 'text/plain', kind: 'file', size_bytes: bytes.length, storage_id: 'object-1', storage_provider_id: 'fs', ref_count: 1, created_at: 1, updated_at: 1, clock: 1, deleted: false });
    await db.file_blobs.put({ hash, blob: new NodeBlob([bytes]) as unknown as Blob, cache_accessed_at: 1, cache_workspace_id: 'workspace', cache_provider_id: 'fs', cache_storage_id: 'object-1', cache_bytes: bytes.length });
});
afterEach(async () => { await db.delete(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each(['queued', 'running', 'failed', 'pending_upload', 'remote_missing'])('retains an expired original with a %s upload', async state => {
    await db.file_transfers.put({ id: 'upload', hash, workspace_id: 'workspace', direction: 'upload', state: state as any, bytes_total: 0, bytes_done: 0, attempts: 0, created_at: 1, updated_at: 1 });
    await cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY);
    expect(await db.file_blobs.get(hash)).toBeDefined();
});
it('retains the local copy when a previously committed remote object is unavailable', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    await cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY);
    expect(await db.file_blobs.get(hash)).toBeDefined();
});
it('retains the local copy when remote bytes are corrupt', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('corrupt!'));
    await cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY);
    expect(await db.file_blobs.get(hash)).toBeDefined();
});
it('rechecks a new upload after remote verification and retains its source', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
        await db.file_transfers.put({ id: 'racing-upload', hash, workspace_id: 'workspace', direction: 'upload', state: 'queued', bytes_total: 0, bytes_done: 0, attempts: 0, created_at: 1, updated_at: 1 });
        return new Response(bytes);
    });
    await cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY);
    expect(await db.file_blobs.get(hash)).toBeDefined();
});
it('reclaims only verified redundant bytes and preserves canonical metadata', async () => {
    await cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY);
    expect(await db.file_blobs.get(hash)).toBeUndefined();
    expect((await db.file_meta.get(hash))?.storage_id).toBe('object-1');
});
// Concurrent transfer completions must share one eviction verification. Remote
// I/O is held open to expose duplicate full-original reads before either deletes.
it('joins overlapping cleanup passes for the same workspace and provider', async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const passes = [cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY),
        cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY)];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const requests = vi.mocked(fetch).mock.calls.length;
    release(new Response(bytes));
    await Promise.all(passes);
    expect(requests).toBe(1);
    expect(await db.file_blobs.get(hash)).toBeUndefined();
});
it('keeps a v28 legacy original unclassified and protected after upgrade and reopen', async () => {
    const metadata = (await db.file_meta.get(hash))!;
    const name = db.name;
    await db.delete();
    const legacy = new Dexie(name);
    legacy.version(28).stores({ file_meta: 'hash', file_blobs: 'hash' });
    try {
        await legacy.open();
        await legacy.table('file_meta').put(metadata);
        await legacy.table('file_blobs').put({ hash, blob: new NodeBlob([bytes]) });
    } finally { legacy.close(); }

    db = new Or3DB(name);
    await db.open();
    expect(db.verno).toBe(30);
    expect(await db.file_blobs.get(hash)).toEqual({ hash, blob: expect.any(NodeBlob) });
    // The new sparse index exists, but migrating must not enroll legacy bytes.
    expect(await db.file_blobs.where('cache_accessed_at').aboveOrEqual(1).count()).toBe(0);
    await cleanupFileCache(db, 'workspace', provider as any, {
        ...DEFAULT_FILE_POLICY, maxCachedFileBytes: 0, maxCacheBytes: 0, retentionDays: 1,
    });
    db.close();
    db = new Or3DB(name);
    await db.open();
    const retained = await db.file_blobs.get(hash);
    expect(retained).toEqual({ hash, blob: expect.any(NodeBlob) });
    expect(Array.from(new Uint8Array(await retained!.blob.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(await db.file_meta.get(hash)).toEqual(metadata);
    expect(await db.pending_ops.count()).toBe(0);
});

it.each(['trash', 'upload', 'unavailable'] as const)('advances past protected %s rows without deleting them', async protection => {
    const protectedHashes = Array.from({ length: 50 }, (_, index) => `sha256:${'0'.repeat(60)}${index.toString(16).padStart(4, '0')}`);
    const meta = (await db.file_meta.get(hash))!;
    const cached = (await db.file_blobs.get(hash))!;
    // Every row has the same access time; advance by both timestamp and hash.
    for (const key of protectedHashes) {
        await db.file_meta.put({ ...meta, hash: key, deleted: protection === 'trash' });
        await db.file_blobs.put({ ...cached, hash: key });
        if (protection === 'upload') await db.file_transfers.put({ id: key, hash: key, workspace_id: 'workspace', direction: 'upload', state: 'queued', bytes_total: bytes.length, bytes_done: 0, attempts: 0, created_at: 1, updated_at: 1 });
    }
    if (protection === 'unavailable') {
        provider.getPresignedDownloadUrl.mockImplementation(async (options?: any) => ({ url: options?.hash === hash ? 'https://storage.test/original' : 'https://storage.test/missing', storageId: 'object-1' }));
        vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/missing') ? new Response(null, { status: 404 }) : new Response(bytes));
    }
    for (let pass = 0; pass < 12; pass++) await cleanupFileCache(db, 'workspace', provider as any, DEFAULT_FILE_POLICY);
    expect(await db.file_blobs.get(hash)).toBeUndefined();
    expect(await db.file_blobs.count()).toBe(50);
    expect(await db.file_transfers.count()).toBe(protection === 'upload' ? 50 : 0);
});

// Cache admission must count bytes across workspaces without materializing Blob
// values; the existing eviction cases use a non-origin test DB and cannot catch it.
it.each([bytes.length, undefined, NaN, -1])('counts cache metadata conservatively without reading originals (%s)', async cacheBytes => {
    const inventoryDb = new Or3DB(`or3-db-cache-inventory-${crypto.randomUUID()}`);
    await inventoryDb.open();
    try {
        await inventoryDb.file_blobs.put({ ...(await db.file_blobs.get(hash))!, cache_bytes: cacheBytes });
        const reads = vi.spyOn(IDBIndex.prototype, 'openCursor');
        expect(await originCacheBytes()).toBe(cacheBytes === bytes.length ? bytes.length : Infinity);
        expect(reads).not.toHaveBeenCalled();
        reads.mockRestore();
    } finally { await inventoryDb.delete(); }
});

// Provider-attested checksum/size proves the actual committed object without
// transferring its bytes. A mismatched receipt must never authorize eviction.
it.each([true, false])('uses an exact provider content proof (valid=%s)', async valid => {
    const proofProvider = { ...provider, getPresignedDownloadUrl: vi.fn(async () => ({
        url: 'https://storage.test/original', storageId: 'object-1',
        verifiedContent: { hash: valid ? hash : `sha256:${'0'.repeat(64)}`, sizeBytes: bytes.length },
    })) };
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    await cleanupFileCache(db, 'workspace', proofProvider as any, DEFAULT_FILE_POLICY);
    expect(Boolean(await db.file_blobs.get(hash))).toBe(!valid);
    if (valid) expect(fetch).not.toHaveBeenCalled();
});
