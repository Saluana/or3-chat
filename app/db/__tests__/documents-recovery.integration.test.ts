import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setActiveWorkspaceDb, evictWorkspaceDb, type Or3DB } from '~/db/client';
import { createDocumentInDb, getDocumentInDb, updateDocumentInDb } from '~/db/documents';
import { loadDocument, useDocumentState } from '~/composables/documents/useDocumentsStore';
import { prepareDocumentRevision, pruneDocumentRevisions, listCompleteDocumentRevisions } from '~/db/document-revisions';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';

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

it('never deletes an unrelated post named by a malformed revision', async () => {
    const victim = await createDocumentInDb(db, { title: 'Unrelated document', content: content('Keep me') });
    const seed = await prepareDocumentRevision({ documentId: 'owner', title: 'Owner', content: content('Checkpoint'), source: 'manual' });
    await db.posts.bulkPut(seed.rows);
    const victimRow = (await db.posts.get(victim.id))!;
    await db.posts.delete(victim.id);
    const targetId = 'manifest-20:chunk:0';
    await db.posts.put({ ...victimRow, id: targetId });
    const row = seed.rows.at(-1)!;
    const now = Math.floor(Date.now() / 1000);
    await db.posts.bulkPut(Array.from({ length: 21 }, (_, i) => {
        const id = `manifest-${String(i).padStart(2, '0')}`;
        return { ...row, id, content: JSON.stringify({ ...seed.manifest, revisionId: id, createdAt: i === 20 ? now - 8 * 86400 : now - i, chunkIds: [`${id}:chunk:0`] }) };
    }));
    await pruneDocumentRevisions('owner', db);
    expect(await db.posts.get(targetId)).toMatchObject({ title: 'Unrelated document' });
    expect(await db.posts.get('manifest-20')).toBeUndefined();
});

it('preserves the last complete checkpoint when newer chunks are missing', async () => {
    const seed = await prepareDocumentRevision({ documentId: 'owner', title: 'Recoverable', content: content('Last usable checkpoint'), source: 'manual' });
    const now = Math.floor(Date.now() / 1000);
    seed.manifest.createdAt = now - 30;
    seed.rows.at(-1)!.content = JSON.stringify(seed.manifest);
    await db.posts.bulkPut(seed.rows);
    expect(await listCompleteDocumentRevisions('owner', db)).toHaveLength(1);
    const row = seed.rows.at(-1)!;
    await db.posts.bulkPut(Array.from({ length: 20 }, (_, i) => {
        const id = `incomplete-${i}`;
        return { ...row, id, content: JSON.stringify({ ...seed.manifest, revisionId: id, createdAt: now - i, chunkIds: [`${id}:chunk:0`] }) };
    }));
    await pruneDocumentRevisions('owner', db);
    expect(await listCompleteDocumentRevisions('owner', db)).toHaveLength(1);
    expect(await db.posts.get(seed.manifest.revisionId)).toBeDefined();
});

it.each(['create', 'update'] as const)('derives image ownership after %s content hooks run', async mode => {
    const image = { type: 'doc' as const, content: [{ type: 'or3Image', attrs: { hash: 'sha256:example' } }] };
    if (mode === 'create') hooks.addFilter('db.documents.create:filter:input', entity => ({ ...entity, content: JSON.stringify(image) }));
    else hooks.addFilter('db.documents.update:filter:input', payload => ({ ...payload, updated: { ...payload.updated, content: JSON.stringify(image) } }));
    const created = await createDocumentInDb(db, { title: 'Filtered image', content: content('Input') });
    if (mode === 'update') await updateDocumentInDb(db, created.id, { content: content('Updated input') });
    const row = await db.posts.get(created.id);
    expect(row?.content).toContain('sha256:example');
    expect(JSON.parse(row!.file_hashes!)).toEqual(['sha256:example']);
});

it('exposes a retryable load error when IndexedDB reading fails', async () => {
    vi.spyOn(db.posts, 'get').mockRejectedValueOnce(new Error('Synthetic read failure'));
    await loadDocument('failed-load', db);
    expect(useDocumentState('failed-load', db).status).toBe('error');
    expect(useDocumentState('failed-load', db).lastError).toBeInstanceOf(Error);
});

it('refuses malformed persisted JSON without replacing the raw content', async () => {
    const created = await createDocumentInDb(db, { title: 'Damaged', content: content('Original') });
    await db.posts.update(created.id, { content: '{truncated' });
    await expect(getDocumentInDb(db, created.id)).rejects.toThrow();
    expect((await db.posts.get(created.id))?.content).toBe('{truncated');
});
