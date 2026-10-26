import { workspaceRevision } from '~~/shared/posts/workspace-revision';
import { WORKSPACE_CHANGE_KEY } from '~~/shared/posts/document-change';
import { getDb, type Or3DB } from './client';
import { getWriteTxTableNames, newId, nextClock, nowSec } from './util';
import type { Post } from './schema';
import type { TipTapDocument } from '~/types/database';
import { collectDocumentFileHashes } from '~/utils/documents/document-content';
import {
    assertRevisionSyncPayloadSize,
    type DocumentRevisionEncoding,
    type DocumentRevisionSnapshot,
} from '~/utils/documents/revision-codec';
import {
    decodeRevisionInWorker,
    encodeRevisionInWorker,
} from '~/utils/documents/revision-codec-client';

export const DOCUMENT_REVISION_POST_TYPE = 'or3:document-revision' as const;
export const DOCUMENT_REVISION_CHUNK_POST_TYPE = 'or3:document-revision-chunk' as const;
export const DOCUMENT_REVISION_BUDGET_BYTES = 5 * 1024 * 1024;

export type DocumentRevisionSource = 'auto' | 'manual' | 'ai' | 'restore';

export interface DocumentRevisionManifest {
    version: 1;
    revisionId: string;
    documentId: string;
    source: DocumentRevisionSource;
    createdAt: number;
    titleContentHash: string;
    encoding: DocumentRevisionEncoding;
    originalBytes: number;
    encodedBytes: number;
    chunkIds: string[];
    fileHashes: string[];
}

export interface CompleteDocumentRevision {
    manifest: DocumentRevisionManifest;
    snapshot: DocumentRevisionSnapshot;
}

function parseManifest(row: Post): DocumentRevisionManifest | null {
    if (row.deleted || row.postType !== DOCUMENT_REVISION_POST_TYPE) return null;
    try {
        const value = JSON.parse(row.content) as Partial<DocumentRevisionManifest>;
        if (
            value.version !== 1
            || typeof value.revisionId !== 'string'
            || value.revisionId !== row.id
            || value.documentId !== row.title
            || !Array.isArray(value.chunkIds)
            || !value.chunkIds.length || value.chunkIds.length > 4096
            || !value.chunkIds.every((id, index) => id === `${row.id}:chunk:${index}`)
            || typeof value.titleContentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.titleContentHash)
            || (value.encoding !== 'gzip-base64url' && value.encoding !== 'identity-base64url')
            || !Number.isSafeInteger(value.createdAt) || value.createdAt! < 0 || value.createdAt! > 8_640_000_000_000
            || !Number.isSafeInteger(value.originalBytes) || value.originalBytes! < 0
            || !Number.isSafeInteger(value.encodedBytes) || value.encodedBytes! < 0
        ) return null;
        return {
            version: 1,
            revisionId: value.revisionId,
            documentId: value.documentId,
            source: value.source === 'manual' || value.source === 'ai' || value.source === 'restore'
                ? value.source
                : 'auto',
            createdAt: value.createdAt as number,
            titleContentHash: value.titleContentHash,
            encoding: value.encoding,
            originalBytes: value.originalBytes as number,
            encodedBytes: value.encodedBytes as number,
            chunkIds: value.chunkIds,
            fileHashes: Array.isArray(value.fileHashes)
                ? value.fileHashes.filter((hash): hash is string => typeof hash === 'string')
                : [],
        };
    } catch {
        return null;
    }
}

function makePost(input: {
    id: string;
    title: string;
    content: string;
    postType: typeof DOCUMENT_REVISION_POST_TYPE | typeof DOCUMENT_REVISION_CHUNK_POST_TYPE;
    createdAt: number;
    fileHashes?: string[];
}): Post {
    return {
        id: input.id,
        title: input.title,
        content: input.content,
        postType: input.postType,
        meta: '',
        file_hashes: input.fileHashes?.length ? JSON.stringify(input.fileHashes) : null,
        created_at: input.createdAt,
        updated_at: input.createdAt,
        deleted: false,
        clock: nextClock(),
    };
}

async function manifestRows(documentId: string, db: Or3DB): Promise<Post[]> {
    return db.posts
        .where('[postType+title]')
        .equals([DOCUMENT_REVISION_POST_TYPE, documentId])
        .and((row) => !row.deleted)
        .toArray();
}

export async function readDocumentRevision(
    manifest: DocumentRevisionManifest,
    db = getDb()
): Promise<CompleteDocumentRevision | null> {
    const rows = await db.posts.bulkGet(manifest.chunkIds);
    if (rows.some((row, index) => !row || row.deleted || row.postType !== DOCUMENT_REVISION_CHUNK_POST_TYPE
        || row.title !== manifest.revisionId || row.id !== `${manifest.revisionId}:chunk:${index}`)) {
        return null;
    }
    try {
        const snapshot = await decodeRevisionInWorker({
            encoding: manifest.encoding,
            hash: manifest.titleContentHash,
            chunks: rows.map((row) => row?.content ?? ''),
        });
        return { manifest, snapshot };
    } catch {
        return null;
    }
}

export async function listCompleteDocumentRevisions(
    documentId: string,
    db = getDb()
): Promise<CompleteDocumentRevision[]> {
    const manifests = (await manifestRows(documentId, db))
        .map(parseManifest)
        .filter((value): value is DocumentRevisionManifest => Boolean(value))
        .sort((left, right) => right.createdAt - left.createdAt
            || right.revisionId.localeCompare(left.revisionId));
    const complete: CompleteDocumentRevision[] = [];
    for (const manifest of manifests) {
        const revision = await readDocumentRevision(manifest, db);
        if (revision) complete.push(revision);
    }
    return complete;
}

export async function prepareDocumentRevision(input: {
    documentId: string;
    title: string;
    content: TipTapDocument;
    source: DocumentRevisionSource;
}): Promise<{ manifest: DocumentRevisionManifest; rows: Post[] }> {
    const snapshot: DocumentRevisionSnapshot = {
        title: input.title,
        content: input.content,
    };
    const encoded = await encodeRevisionInWorker(snapshot);
    const revisionId = newId();
    const createdAt = nowSec();
    const chunkIds = encoded.chunks.map((_, index) => `${revisionId}:chunk:${index}`);
    const fileHashes = collectDocumentFileHashes(input.content);
    const manifest: DocumentRevisionManifest = {
        version: 1,
        revisionId,
        documentId: input.documentId,
        source: input.source,
        createdAt,
        titleContentHash: encoded.hash,
        encoding: encoded.encoding,
        originalBytes: encoded.originalBytes,
        encodedBytes: encoded.encodedBytes,
        chunkIds,
        fileHashes,
    };
    const rows = [
        ...encoded.chunks.map((content, index) => makePost({
            id: chunkIds[index]!,
            title: revisionId,
            content,
            postType: DOCUMENT_REVISION_CHUNK_POST_TYPE,
            createdAt,
        })),
        makePost({
            id: revisionId,
            title: input.documentId,
            content: JSON.stringify(manifest),
            postType: DOCUMENT_REVISION_POST_TYPE,
            createdAt,
            fileHashes,
        }),
    ];
    rows.forEach(assertRevisionSyncPayloadSize);
    return { manifest, rows };
}

export async function createDocumentRevision(input: {
    documentId: string;
    title: string;
    content: TipTapDocument;
    source: DocumentRevisionSource;
}, db = getDb()): Promise<DocumentRevisionManifest | null> {
    const prepared = await prepareDocumentRevision(input);
    const newest = (await manifestRows(input.documentId, db))
        .map(parseManifest)
        .filter((value): value is DocumentRevisionManifest => Boolean(value))
        .sort((left, right) => right.createdAt - left.createdAt
            || right.revisionId.localeCompare(left.revisionId))[0];
    if (newest?.titleContentHash === prepared.manifest.titleContentHash && await readDocumentRevision(newest, db)) {
        return null;
    }
    await db.transaction('rw', getWriteTxTableNames(db, 'posts'), async () => {
        await db.posts.bulkPut(prepared.rows);
    });
    await pruneDocumentRevisions(input.documentId, db);
    return prepared.manifest;
}

function utcDay(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function selectRevisionIdsForRetention(
    manifests: DocumentRevisionManifest[],
    now = nowSec(),
    budgetBytes = DOCUMENT_REVISION_BUDGET_BYTES
): Set<string> {
    const sorted = [...manifests].sort((left, right) => right.createdAt - left.createdAt
        || right.revisionId.localeCompare(left.revisionId));
    if (!sorted.length) return new Set();

    const preferred = new Set(sorted.slice(0, 20).map((item) => item.revisionId));
    const dayMs = 24 * 60 * 60;
    const daily = new Set<string>();
    for (let dayOffset = 1; dayOffset <= 14; dayOffset += 1) {
        const day = utcDay(now - (dayOffset * dayMs));
        const candidate = sorted.find((item) => utcDay(item.createdAt) === day);
        if (candidate) daily.add(candidate.revisionId);
    }
    for (const id of daily) preferred.add(id);
    preferred.add(sorted[0]!.revisionId);

    let size = sorted
        .filter((item) => preferred.has(item.revisionId))
        .reduce((sum, item) => sum + item.encodedBytes, 0);
    if (size <= budgetBytes) return preferred;

    // The preferences are deliberately soft. Remove the oldest preferred
    // checkpoints until the cap is met, but never remove the newest complete one.
    for (const item of [...sorted].reverse()) {
        if (item.revisionId === sorted[0]!.revisionId) continue;
        if (!preferred.delete(item.revisionId)) continue;
        size -= item.encodedBytes;
        if (size <= budgetBytes) break;
    }
    return preferred;
}

export async function pruneDocumentRevisions(documentId: string, db = getDb()): Promise<{
    removed: number;
    overBudget: boolean;
}> {
    const document = await db.posts.get(documentId);
    const documentRevision = document ? await workspaceRevision(document) : null;
    const rows = await manifestRows(documentId, db);
    const manifests = rows.map(parseManifest)
        .filter((value): value is DocumentRevisionManifest => Boolean(value));
    // Decode outside the write transaction, then fence every assessed row in it.
    // A synced/imported manifest is not evidence that a checkpoint is recoverable.
    const assessed: Array<{ manifest: DocumentRevisionManifest; chunks: Array<Post | undefined>; complete: boolean }> = [];
    for (const manifest of manifests) {
        const chunks = await db.posts.bulkGet(manifest.chunkIds);
        assessed.push({ manifest, chunks, complete: Boolean(await readDocumentRevision(manifest, db)) });
    }
    if (assessed.length && !assessed.some(item => item.complete)) {
        // Worker/storage failure must never turn cleanup into loss of all history.
        return { removed: 0, overBudget: true };
    }
    const retained = selectRevisionIdsForRetention(assessed.filter(item => item.complete).map(item => item.manifest));
    // Allow partial sync/import deliveries to finish before reclaiming their rows.
    const graceStart = nowSec() - 7 * 24 * 60 * 60;
    for (const item of assessed) {
        if (!item.complete && item.manifest.createdAt >= graceStart) retained.add(item.manifest.revisionId);
    }
    const pruned = manifests.filter((item) => !retained.has(item.revisionId));
    let removed = 0;
    if (pruned.length) {
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, ['posts', 'messages'], { includeTombstones: true }),
            async () => {
                const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
                if (!same(document, await db.posts.get(documentId))) return;
                // Read receipts under the same lock as deletion. Only receipts for
                // the current document revision can still Undo; older ones expire.
                await db.messages.where('role').equals('assistant').and(message => !message.deleted).each(message => {
                    if (!message.data || typeof message.data !== 'object' || Array.isArray(message.data)) return;
                    for (const [key, raw] of Object.entries(message.data)) {
                        if (!key.startsWith(WORKSPACE_CHANGE_KEY) || !raw || typeof raw !== 'object') continue;
                        const receipt = raw as Record<string, unknown>;
                        if (receipt.version === 1 && receipt.status === 'applied' && receipt.documentId === documentId
                            && receipt.afterRevision === documentRevision && typeof receipt.beforeRevisionId === 'string') {
                            retained.add(receipt.beforeRevisionId);
                        }
                    }
                });
                for (const item of assessed) {
                    const before = rows.find(row => row.id === item.manifest.revisionId);
                    if (!same(before, await db.posts.get(item.manifest.revisionId))
                        || !same(item.chunks, await db.posts.bulkGet(item.manifest.chunkIds))) return;
                }
                for (const manifest of pruned) {
                    if (retained.has(manifest.revisionId)) continue;
                    // Never let a stored manifest authorize deletion of another post.
                    const chunks = await db.posts.bulkGet(manifest.chunkIds);
                    const owned = chunks.filter((row): row is Post => Boolean(row
                        && row.postType === DOCUMENT_REVISION_CHUNK_POST_TYPE && row.title === manifest.revisionId
                        && manifest.chunkIds.includes(row.id)));
                    await db.posts.bulkDelete([manifest.revisionId, ...owned.map(row => row.id)]);
                    removed += 1;
                }
            }
        );
    }
    const retainedBytes = manifests
        .filter((item) => retained.has(item.revisionId))
        .reduce((sum, item) => sum + item.encodedBytes, 0);
    return {
        removed,
        overBudget: retainedBytes > DOCUMENT_REVISION_BUDGET_BYTES,
    };
}

export async function repairOrphanRevisionChunks(options: {
    bootstrapComplete: boolean;
    now?: number;
}, db = getDb()): Promise<number> {
    if (!options.bootstrapComplete) return 0;
    const threshold = (options.now ?? nowSec()) - (7 * 24 * 60 * 60);
    const chunks = await db.posts.where('postType')
        .equals(DOCUMENT_REVISION_CHUNK_POST_TYPE)
        .and((row) => !row.deleted && row.created_at <= threshold)
        .toArray();
    const manifestIds = [...new Set(chunks.map((row) => row.title))];
    const manifests = await db.posts.bulkGet(manifestIds);
    const validIds = new Set(manifests
        .filter((row): row is Post => Boolean(row && !row.deleted && row.postType === DOCUMENT_REVISION_POST_TYPE))
        .map((row) => row.id));
    const orphanIds = chunks
        .filter((row) => !validIds.has(row.title))
        .map((row) => row.id);
    if (orphanIds.length) {
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'posts', { includeTombstones: true }),
            async () => db.posts.bulkDelete(orphanIds)
        );
    }
    return orphanIds.length;
}
