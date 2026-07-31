import { getDb } from './client';
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
            || !value.chunkIds.every((id) => typeof id === 'string')
            || typeof value.titleContentHash !== 'string'
            || (value.encoding !== 'gzip-base64url' && value.encoding !== 'identity-base64url')
            || !Number.isSafeInteger(value.createdAt)
            || !Number.isSafeInteger(value.originalBytes)
            || !Number.isSafeInteger(value.encodedBytes)
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

async function manifestRows(documentId: string): Promise<Post[]> {
    return getDb().posts
        .where('[postType+title]')
        .equals([DOCUMENT_REVISION_POST_TYPE, documentId])
        .and((row) => !row.deleted)
        .toArray();
}

export async function readDocumentRevision(
    manifest: DocumentRevisionManifest
): Promise<CompleteDocumentRevision | null> {
    const rows = await getDb().posts.bulkGet(manifest.chunkIds);
    if (rows.some((row) => !row || row.deleted || row.postType !== DOCUMENT_REVISION_CHUNK_POST_TYPE)) {
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
    documentId: string
): Promise<CompleteDocumentRevision[]> {
    const manifests = (await manifestRows(documentId))
        .map(parseManifest)
        .filter((value): value is DocumentRevisionManifest => Boolean(value))
        .sort((left, right) => right.createdAt - left.createdAt
            || right.revisionId.localeCompare(left.revisionId));
    const complete = await Promise.all(manifests.map(readDocumentRevision));
    return complete.filter((value): value is CompleteDocumentRevision => Boolean(value));
}

export async function createDocumentRevision(input: {
    documentId: string;
    title: string;
    content: TipTapDocument;
    source: DocumentRevisionSource;
}): Promise<DocumentRevisionManifest | null> {
    const snapshot: DocumentRevisionSnapshot = {
        title: input.title,
        content: input.content,
    };
    const encoded = await encodeRevisionInWorker(snapshot);
    const newest = (await manifestRows(input.documentId))
        .map(parseManifest)
        .filter((value): value is DocumentRevisionManifest => Boolean(value))
        .sort((left, right) => right.createdAt - left.createdAt
            || right.revisionId.localeCompare(left.revisionId))[0];
    if (newest?.titleContentHash === encoded.hash && await readDocumentRevision(newest)) {
        return null;
    }

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

    const db = getDb();
    await db.transaction('rw', getWriteTxTableNames(db, 'posts'), async () => {
        await db.posts.bulkPut(rows);
    });
    await pruneDocumentRevisions(input.documentId);
    return manifest;
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

export async function pruneDocumentRevisions(documentId: string): Promise<{
    removed: number;
    overBudget: boolean;
}> {
    const rows = await manifestRows(documentId);
    const manifests = rows.map(parseManifest)
        .filter((value): value is DocumentRevisionManifest => Boolean(value));
    const retained = selectRevisionIdsForRetention(manifests);
    const pruned = manifests.filter((item) => !retained.has(item.revisionId));
    if (pruned.length) {
        const ids = pruned.flatMap((item) => [item.revisionId, ...item.chunkIds]);
        const db = getDb();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'posts', { includeTombstones: true }),
            async () => db.posts.bulkDelete(ids)
        );
    }
    const retainedBytes = manifests
        .filter((item) => retained.has(item.revisionId))
        .reduce((sum, item) => sum + item.encodedBytes, 0);
    return {
        removed: pruned.length,
        overBudget: retainedBytes > DOCUMENT_REVISION_BUDGET_BYTES,
    };
}

export async function repairOrphanRevisionChunks(options: {
    bootstrapComplete: boolean;
    now?: number;
}): Promise<number> {
    if (!options.bootstrapComplete) return 0;
    const threshold = (options.now ?? nowSec()) - (7 * 24 * 60 * 60);
    const chunks = await getDb().posts.where('postType')
        .equals(DOCUMENT_REVISION_CHUNK_POST_TYPE)
        .and((row) => !row.deleted && row.created_at <= threshold)
        .toArray();
    const manifestIds = [...new Set(chunks.map((row) => row.title))];
    const manifests = await getDb().posts.bulkGet(manifestIds);
    const validIds = new Set(manifests
        .filter((row): row is Post => Boolean(row && !row.deleted && row.postType === DOCUMENT_REVISION_POST_TYPE))
        .map((row) => row.id));
    const orphanIds = chunks
        .filter((row) => !validIds.has(row.title))
        .map((row) => row.id);
    if (orphanIds.length) {
        const db = getDb();
        await db.transaction(
            'rw',
            getWriteTxTableNames(db, 'posts', { includeTombstones: true }),
            async () => db.posts.bulkDelete(orphanIds)
        );
    }
    return orphanIds.length;
}
