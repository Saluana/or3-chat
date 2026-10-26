// Audit reproductions: PASS means the named defect was observed in production code.
// Only disposable fake-indexeddb databases are used; no user storage is accessed.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setActiveWorkspaceDb, evictWorkspaceDb, type Or3DB } from '~/db/client';
import { createDocumentInDb, getDocumentInDb } from '~/db/documents';
import { loadDocument, flush, refreshDocument, setDocumentContent, useDocumentState } from '~/composables/documents/useDocumentsStore';
import { prepareDocumentRevision, pruneDocumentRevisions, listCompleteDocumentRevisions } from '~/db/document-revisions';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { MAX_SYNC_PAYLOAD_BYTES, sanitizePayloadForSync } from '~~/shared/sync/sanitize';

let db: Or3DB;
let workspace: string;
let hooks: ReturnType<typeof createTypedHookEngine>;
const content = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

beforeEach(async () => {
    vi.stubGlobal('Blob', NodeBlob);
    workspace = `editor-audit-${crypto.randomUUID()}`;
    db = setActiveWorkspaceDb(workspace);
    await db.open();
    hooks = createTypedHookEngine(createHookEngine());
    setHookEngine(hooks);
});
afterEach(async () => {
    hooks.removeAllCallbacks();
    setHookEngine(null);
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspace);
    await Dexie.delete(db.name);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('reproduces pruning an unrelated document named in a revision chunkIds array', async () => {
    const victim = await createDocumentInDb(db, { title: 'Unrelated document', content: content('Keep me') });
    const seed = await prepareDocumentRevision({ documentId: 'owner', title: 'Owner', content: content('Checkpoint'), source: 'manual' });
    const row = seed.rows.at(-1)!;
    const now = Math.floor(Date.now() / 1000);
    await db.posts.bulkPut(Array.from({ length: 21 }, (_, i) => {
        const id = `manifest-${String(i).padStart(2, '0')}`;
        return { ...row, id, content: JSON.stringify({ ...seed.manifest, revisionId: id, createdAt: now - i, chunkIds: i === 20 ? [victim.id] : [`missing-${i}`] }) };
    }));
    await pruneDocumentRevisions('owner', db);
    expect(await db.posts.get(victim.id)).toBeUndefined();
});

it('reproduces deleting the only complete checkpoint in favor of incomplete newer manifests', async () => {
    const seed = await prepareDocumentRevision({ documentId: 'owner', title: 'Recoverable', content: content('Last usable checkpoint'), source: 'manual' });
    const now = Math.floor(Date.now() / 1000);
    seed.manifest.createdAt = now - 30;
    seed.rows.at(-1)!.content = JSON.stringify(seed.manifest);
    await db.posts.bulkPut(seed.rows);
    expect(await listCompleteDocumentRevisions('owner', db)).toHaveLength(1);
    const row = seed.rows.at(-1)!;
    await db.posts.bulkPut(Array.from({ length: 20 }, (_, i) => {
        const id = `incomplete-${i}`;
        return { ...row, id, content: JSON.stringify({ ...seed.manifest, revisionId: id, createdAt: now - i, chunkIds: [`missing-${i}`] }) };
    }));
    await pruneDocumentRevisions('owner', db);
    expect(await listCompleteDocumentRevisions('owner', db)).toHaveLength(0);
    expect(await db.posts.get(seed.manifest.revisionId)).toBeUndefined();
});

it('reproduces image references missing after a documented content filter adds an image', async () => {
    const image = { type: 'doc' as const, content: [{ type: 'or3Image', attrs: { hash: 'sha256:example' } }] };
    hooks.addFilter('db.documents.create:filter:input', entity => ({ ...entity, content: JSON.stringify(image) }));
    const created = await createDocumentInDb(db, { title: 'Filtered image', content: content('Input') });
    const row = await db.posts.get(created.id);
    expect(row?.content).toContain('sha256:example');
    expect(row?.file_hashes).toBeNull();
});

it('reproduces a database read failure being classified as unavailable rather than retryable error', async () => {
    vi.spyOn(db.posts, 'get').mockRejectedValueOnce(new Error('Synthetic read failure'));
    await loadDocument('failed-load', db);
    expect(useDocumentState('failed-load', db).status).toBe('unavailable');
    expect(useDocumentState('failed-load', db).lastError).toBeUndefined();
});

it('reproduces malformed persisted JSON being presented as an ordinary empty document', async () => {
    const created = await createDocumentInDb(db, { title: 'Damaged', content: content('Original') });
    await db.posts.update(created.id, { content: '{truncated' });
    expect((await getDocumentInDb(db, created.id))?.content).toEqual({ type: 'doc', content: [] });
});

it('reproduces a cross-tab conflict that retry and refresh cannot reconcile even with remote content', async () => {
    const created = await createDocumentInDb(db, { title: 'Concurrent', content: content('Base') });
    await loadDocument(created.id, db);
    setDocumentContent(created.id, content('Local edit'), db);
    await db.posts.update(created.id, { content: JSON.stringify(content('Remote edit')), clock: 10 });
    await flush(created.id, db);
    expect(useDocumentState(created.id, db).status).toBe('error');
    setDocumentContent(created.id, content('Remote edit'), db);
    await refreshDocument(created.id, db);
    await flush(created.id, db);
    expect(useDocumentState(created.id, db).status).toBe('error');
    expect(useDocumentState(created.id, db).pendingContent).toEqual(content('Remote edit'));
    expect(useDocumentState(created.id, db).record?.content).toEqual(content('Base'));
});

it('reproduces a locally saved document whose intact sync payload exceeds the provider ceiling', async () => {
    const created = await createDocumentInDb(db, { title: 'Large document', content: content('x'.repeat(300 * 1024)) });
    const row = (await db.posts.get(created.id))!;
    const wire = sanitizePayloadForSync('posts', row, 'put');
    expect(new TextEncoder().encode(JSON.stringify(wire)).byteLength).toBeGreaterThan(MAX_SYNC_PAYLOAD_BYTES);
    expect((await getDocumentInDb(db, created.id))?.content.content[0]?.content?.[0]?.text).toHaveLength(300 * 1024);
});
