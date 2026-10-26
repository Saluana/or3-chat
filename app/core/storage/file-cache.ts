import type { FileBlobRow, Or3DB } from '~/db/client';
import type { ObjectStorageProvider } from './types';
import type { FilePolicy } from '~~/shared/storage/file-policy';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type CacheProvider = Pick<ObjectStorageProvider, 'id' | 'getPresignedDownloadUrl'>;
const cleanupCursors = new WeakMap<Or3DB, { workspaceId: string; providerId: string; accessedAt: number; hash: string }>();
const cleanupPasses = new WeakMap<Or3DB, Promise<void>>();

/** Count cache bytes across this origin without upgrading/opening other app DBs. */
export async function originCacheBytes(): Promise<number> {
    const inventory = (indexedDB as Partial<IDBFactory>).databases;
    if (!inventory) return Infinity; // No inventory: do not promise a global budget.
    let bytes = 0;
    for (const entry of await inventory.call(indexedDB)) {
        if (!entry.name?.startsWith('or3-db-')) continue;
        bytes += await new Promise<number>((resolve, reject) => {
            const request = indexedDB.open(entry.name!);
            request.onupgradeneeded = () => request.transaction?.abort(); // It was removed after the inventory.
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('file_blobs')) { db.close(); resolve(0); return; }
                const tx = db.transaction('file_blobs', 'readonly');
                const store = tx.objectStore('file_blobs');
                if (!store.indexNames.contains('cache_accessed_at')) { db.close(); resolve(0); return; }
                let total = 0;
                let cacheRows = 0, indexedRows = 0;
                const count = store.index('cache_accessed_at').count();
                count.onsuccess = () => { cacheRows = count.result; };
                const metadataIndex = '[cache_accessed_at+cache_bytes+hash]';
                const keysOnly = store.indexNames.contains(metadataIndex);
                // Older unopened workspaces retain their v29 value-cursor fallback.
                const cursor = keysOnly
                    ? store.index(metadataIndex).openKeyCursor()
                    : store.index('cache_accessed_at').openCursor();
                cursor.onsuccess = () => {
                    const item = cursor.result;
                    if (!item) return;
                    indexedRows++;
                    const size: unknown = keysOnly ? (item.key as IDBValidKey[])[1]
                        : (item as IDBCursorWithValue).value.cache_bytes;
                    total += typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : Infinity;
                    item.continue();
                };
                tx.oncomplete = () => { db.close(); resolve(keysOnly && indexedRows !== cacheRows ? Infinity : total); };
                tx.onerror = () => { db.close(); reject(tx.error); };
            };
        });
    }
    return bytes;
}

function cacheRow(hash: string, blob: Blob, workspaceId: string, providerId: string, storageId: string): FileBlobRow {
    return { hash, blob, cache_accessed_at: Date.now(), cache_workspace_id: workspaceId,
        cache_provider_id: providerId, cache_storage_id: storageId, cache_bytes: blob.size };
}

/** No cross-tab lock means no cache admission. Originals are still protected. */
export async function cacheDownloadedFile(db: Or3DB, workspaceId: string, providerId: string,
    hash: string, storageId: string, blob: Blob, policy: FilePolicy, assertCurrent?: () => Promise<void>): Promise<void> {
    const locks = (navigator as Partial<Navigator>).locks;
    if (!policy.maxCachedFileBytes || blob.size > policy.maxCachedFileBytes || !locks) return;
    await locks.request('or3-file-cache', async () => {
        if (await originCacheBytes() + blob.size > policy.maxCacheBytes) return;
        await db.transaction('rw', db.file_blobs, db.file_transfers, async () => {
            await assertCurrent?.();
            // Never replace protected originals with an evictable cache classification.
            if (await db.file_blobs.get(hash)) return;
            if (await hasUnfinishedUpload(db, hash)) return;
            await db.file_blobs.put(cacheRow(hash, blob, workspaceId, providerId, storageId));
        });
    });
}

export async function touchFileCache(db: Or3DB, hash: string): Promise<void> {
    await db.transaction('rw', db.file_blobs, async () => {
        const row = await db.file_blobs.get(hash);
        if (row?.cache_accessed_at) await db.file_blobs.update(hash, { cache_accessed_at: Date.now() });
    });
}

/** Called only after verified commit and completion of this upload. */
export async function markUploadedFileCached(db: Or3DB, workspaceId: string, providerId: string, hash: string): Promise<void> {
    await db.transaction('rw', db.file_blobs, db.file_meta, db.file_transfers, async () => {
        const row = await db.file_blobs.get(hash);
        const meta = await db.file_meta.get(hash);
        if (!meta?.storage_id || meta.storage_provider_id !== providerId) return;
        // A verified retry resolved prior failures for these exact immutable bytes.
        await db.file_transfers.where('hash').equals(hash)
            .filter(transfer => transfer.direction === 'upload' && transfer.state === 'failed')
            .modify({ state: 'done', last_error: undefined });
        if (!row || await hasUnfinishedUpload(db, hash)) return;
        await db.file_blobs.put(cacheRow(hash, row.blob, workspaceId, providerId, meta.storage_id));
    });
}

async function hasUnfinishedUpload(db: Or3DB, hash: string): Promise<boolean> {
    return Boolean(await db.file_transfers.where('hash').equals(hash)
        .filter(row => row.direction === 'upload' && row.state !== 'done').first());
}

async function eligible(db: Or3DB, row: FileBlobRow, workspaceId: string, providerId: string): Promise<boolean> {
    if (!row.cache_accessed_at || row.cache_workspace_id !== workspaceId || row.cache_provider_id !== providerId) return false;
    const meta = await db.file_meta.get(row.hash);
    if (!meta || meta.deleted || meta.storage_id !== row.cache_storage_id || meta.storage_provider_id !== providerId) return false;
    if (await hasUnfinishedUpload(db, row.hash)) return false;
    return !await db.pending_ops.where('[tableName+pk]').equals(['file_meta', row.hash])
        .filter(op => op.status !== 'applied' && op.status !== 'discarded').first();
}

/** Verify actual current remote bytes, never just a metadata pointer or old receipt. */
async function verifyRemote(row: FileBlobRow, workspaceId: string, provider: CacheProvider): Promise<boolean> {
    if (!/^sha256:[a-f0-9]{64}$/.test(row.hash)) return false;
    const presign = await provider.getPresignedDownloadUrl({ workspaceId, hash: row.hash, storageId: row.cache_storage_id, verifyContent: true });
    if (presign.storageId !== row.cache_storage_id) return false;
    if (presign.verifiedContent?.hash === row.hash && presign.verifiedContent.sizeBytes === row.blob.size) return true;
    const response = await fetch(presign.url, { headers: presign.headers, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const digest = sha256.create();
    let bytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > row.blob.size) return false;
            digest.update(value);
        }
        return bytes === row.blob.size && `sha256:${bytesToHex(digest.digest())}` === row.hash;
    } finally { await reader.cancel().catch(() => {}); }
}

/** Consider 50 candidates and verify at most five per pass, advancing past protected originals. */
export function cleanupFileCache(db: Or3DB, workspaceId: string, provider: CacheProvider, policy: FilePolicy): Promise<void> {
    const active = cleanupPasses.get(db);
    if (active) return active;
    const pass = runCleanupFileCache(db, workspaceId, provider, policy).finally(() => {
        if (cleanupPasses.get(db) === pass) cleanupPasses.delete(db);
    });
    cleanupPasses.set(db, pass);
    return pass;
}

async function runCleanupFileCache(db: Or3DB, workspaceId: string, provider: CacheProvider, policy: FilePolicy): Promise<void> {
    const cutoff = Date.now() - policy.retentionDays * 86_400_000;
    let usage = await originCacheBytes();
    const previous = cleanupCursors.get(db);
    const cursor = previous?.workspaceId === workspaceId && previous.providerId === provider.id ? previous : undefined;
    const candidates = await db.file_blobs.where('cache_accessed_at').aboveOrEqual(cursor?.accessedAt ?? 1)
        .filter(row => row.cache_workspace_id === workspaceId && row.cache_provider_id === provider.id &&
            (!cursor || row.cache_accessed_at! > cursor.accessedAt || row.hash > cursor.hash))
        .limit(50).toArray();
    let verified = 0;
    for (const row of candidates) {
        if (verified >= 5) return;
        cleanupCursors.set(db, { workspaceId, providerId: provider.id, accessedAt: row.cache_accessed_at!, hash: row.hash });
        const expired = row.cache_accessed_at! < cutoff;
        if (!expired && row.blob.size <= policy.maxCachedFileBytes && usage <= policy.maxCacheBytes) continue;
        try {
            if (!await eligible(db, row, workspaceId, provider.id)) continue;
            verified++;
            if (!await verifyRemote(row, workspaceId, provider)) continue;
            await db.transaction('rw', db.file_blobs, db.file_meta, db.file_transfers, db.pending_ops, async () => {
                const current = await db.file_blobs.get(row.hash);
                if (!current || current.cache_accessed_at !== row.cache_accessed_at || current.cache_storage_id !== row.cache_storage_id ||
                    !await eligible(db, current, workspaceId, provider.id)) return;
                await db.file_blobs.delete(row.hash);
                usage -= current.blob.size;
            });
        } catch { /* Failure to prove redundancy means keep the local copy. */ }
    }
    if (candidates.length < 50) cleanupCursors.delete(db);
}
