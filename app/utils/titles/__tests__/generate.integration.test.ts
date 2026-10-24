import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createThreadInDb, upsertThread } from '~/db/threads';
import { createDocumentInDb, updateDocumentInDb } from '~/db/documents';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { generateAutomaticTitle } from '../generate';
import { createMessageDocument } from '../message-document';
import { setDocumentTitle, loadDocument, releaseDocument, flush } from '~/composables/documents/useDocumentsStore';

vi.mock('#imports', async load => ({ ...await load<Record<string, unknown>>(),
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: false, limits: { enabled: false } } }) }));
vi.mock('~/core/auth/useUserApiKey', () => ({ useUserApiKey: () => ({ apiKey: { value: 'local-key' } }), getUserApiKeyGeneration: () => 1 }));
vi.mock('~/core/hooks/useHooks', () => ({ useHooks: () => ({ applyFilters: async (_: string, value: unknown) => value, doAction: async () => {} }) }));

let workspace: string;
let resolve: (response: Response) => void;
let fetched: ReturnType<typeof vi.fn>;
const topic = 'Explain OR3 plugin architecture';
const generated = () => new Response(JSON.stringify({ title: 'Understanding OR3 Plugin Architecture' }));
async function pending(type: 'chat' | 'document' = 'chat') {
    const db = getDb();
    const row = type === 'chat' ? await createThreadInDb(db, { title: 'Explain OR3 plugin…', title_source: 'temporary' })
        : await createDocumentInDb(db, { title: 'Temporary document', title_source: 'temporary', content: { type: 'doc', content: [] } });
    const operation = generateAutomaticTitle(db, { type, id: row.id, content: topic });
    await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    return { db, row, operation };
}
beforeEach(async () => {
    workspace = `title-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
    fetched = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetched);
});
afterEach(async () => {
    vi.unstubAllGlobals();
    const name = getDb().name;
    setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(name);
});

describe('automatic title lifecycle', () => {
    it('claims once across concurrent callers, persists through reopen, and never regenerates on a later turn', async () => {
        const { db, row, operation } = await pending();
        await generateAutomaticTitle(db, { type: 'chat', id: row.id, content: topic });
        expect(fetched).toHaveBeenCalledTimes(1);
        db.close(); await db.open();
        await generateAutomaticTitle(db, { type: 'chat', id: row.id, content: topic });
        expect(fetched).toHaveBeenCalledTimes(1);
        resolve(generated()); await operation;
        db.close(); await db.open();
        expect(await db.threads.get(row.id)).toMatchObject({ title: 'Understanding OR3 Plugin Architecture', title_source: 'generated' });
        await generateAutomaticTitle(db, { type: 'chat', id: row.id, content: 'A completely different later subject' });
        expect(fetched).toHaveBeenCalledTimes(1);
    });
    it.each(['chat', 'document'] as const)('protects manual %s renames while inference is pending', async type => {
        const { db, row, operation } = await pending(type);
        if (type === 'chat') await upsertThread({ ...(await db.threads.get(row.id))!, title: 'My chosen name' });
        else await updateDocumentInDb(db, row.id, { title: 'My chosen name' });
        resolve(generated()); await operation;
        expect(await (type === 'chat' ? db.threads : db.posts).get(row.id)).toMatchObject({ title: 'My chosen name', title_source: 'manual' });
    });
    it('updates only the title of a heading-free document, preserving its exact saved content', async () => {
        const { db, row, operation } = await pending('document');
        const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep all original content.' }] }] });
        await db.posts.update(row.id, { content });
        resolve(generated()); await operation;
        expect(await db.posts.get(row.id)).toMatchObject({ title: 'Understanding OR3 Plugin Architecture', title_source: 'generated', content });
    });

    it('does not overwrite an unflushed document rename', async () => {
        const { db, row, operation } = await pending('document');
        await loadDocument(row.id);
        setDocumentTitle(row.id, 'Typing my own title');
        resolve(generated()); await operation;
        await flush(row.id);
        expect(await db.posts.get(row.id)).toMatchObject({ title: 'Typing my own title', title_source: 'manual' });
        await releaseDocument(row.id);
    });
    it.each(['chat', 'document'] as const)('keeps a usable %s fallback after provider failure without another call', async type => {
        const { db, row, operation } = await pending(type);
        resolve(new Response('', { status: 502 })); await operation;
        await generateAutomaticTitle(db, { type, id: row.id, content: topic });
        expect(fetched).toHaveBeenCalledTimes(1);
        expect(await (type === 'chat' ? db.threads : db.posts).get(row.id)).toMatchObject({ title: row.title, title_source: 'failed' });
    });
    it('waits through greetings, then names the first descriptive turn without depending on the assistant', async () => {
        const db = getDb();
        const row = await createThreadInDb(db, { title: 'Hi', title_source: 'temporary' });
        await generateAutomaticTitle(db, { type: 'chat', id: row.id, content: 'Hi' });
        expect(fetched).not.toHaveBeenCalled();
        const operation = generateAutomaticTitle(db, { type: 'chat', id: row.id, content: topic });
        await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
        resolve(generated()); await operation;
        expect((await db.threads.get(row.id))?.title_source).toBe('generated');
    });
    it.each(['chat', 'document'] as const)('does not resurrect a deleted %s', async type => {
        const { db, row, operation } = await pending(type);
        await (type === 'chat' ? db.threads : db.posts).delete(row.id);
        resolve(generated()); await operation;
        expect(await (type === 'chat' ? db.threads : db.posts).get(row.id)).toBeUndefined();
    });
    it('captures the model preference once and applies changed settings only to future jobs', async () => {
        await useAiSettings().set({ titleGenerationModel: 'deepseek/deepseek-v4.1-flash:nitro' });
        const first = await pending();
        expect(JSON.parse(fetched.mock.calls[0]![1].body).model).toBe('deepseek/deepseek-v4.1-flash:nitro');
        await useAiSettings().set({ titleGenerationModel: 'other/model:floor' });
        resolve(generated()); await first.operation;
        fetched.mockClear();
        const second = await pending();
        expect(JSON.parse(fetched.mock.calls[0]![1].body).model).toBe('other/model:floor');
        resolve(generated()); await second.operation;
        expect((await first.db.threads.get(first.row.id))?.title).toBe('Understanding OR3 Plugin Architecture');
    });
    it('leaves branches and legacy manually named conversations alone', async () => {
        const db = getDb();
        for (const input of [{ title: 'Legacy title' }, { title: 'Fork title', parent_thread_id: 'parent', title_source: 'temporary' as const }]) {
            const row = await createThreadInDb(db, input);
            await generateAutomaticTitle(db, { type: 'chat', id: row.id, content: topic });
        }
        expect(fetched).not.toHaveBeenCalled();
    });
    it('adds exactly two thread reads, one source-message read and two writes to a successful chat title', async () => {
        const db = getDb();
        const row = await createThreadInDb(db, { title: 'Temporary title', title_source: 'temporary' });
        await db.messages.add({ id: 'measured-user', thread_id: row.id, role: 'user', index: 0, data: { content: topic },
            created_at: 1, updated_at: 1, clock: 1, deleted: false });
        const sourceRead = vi.spyOn(db.messages, 'get');
        let writes = 0;
        const countWrite = () => { writes++; };
        db.threads.hook('updating', countWrite);
        const get = vi.spyOn(db.threads, 'get');
        try {
            const operation = generateAutomaticTitle(db, { type: 'chat', id: row.id, content: topic, sourceMessage: { id: 'measured-user', clock: 1 } });
            await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
            resolve(generated()); await operation;
            expect(get).toHaveBeenCalledTimes(2);
            expect(writes).toBe(2);
            expect(sourceRead).toHaveBeenCalledTimes(1);
            expect(fetched).toHaveBeenCalledTimes(1);
        } finally { get.mockRestore(); sourceRead.mockRestore(); db.threads.hook('updating').unsubscribe(countWrite); }
    });

    it.each(['edit', 'delete'] as const)('refuses a stale chat title after a first-message %s', async change => {
        const db = getDb();
        const row = await createThreadInDb(db, { title: 'Temporary title', title_source: 'temporary' });
        await db.messages.add({ id: 'first-user', thread_id: row.id, role: 'user', data: { content: topic },
            index: 0, created_at: 1, updated_at: 1, clock: 1, deleted: false });
        const operation = generateAutomaticTitle(db, { type: 'chat', id: row.id, content: topic, sourceMessage: { id: 'first-user', clock: 1 } });
        await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
        if (change === 'edit') await db.messages.update('first-user', { data: { content: 'An entirely different task' }, clock: 2 });
        else await db.messages.delete('first-user');
        resolve(generated()); await operation;
        expect(await db.threads.get(row.id)).toMatchObject({ title: 'Temporary title', title_source: 'failed' });
    });

    it('does not commit after changing workspaces during inference', async () => {
        const { db, row, operation } = await pending();
        setActiveWorkspaceDb(null);
        resolve(generated()); await operation;
        expect((await db.threads.get(row.id))?.title).toBe(row.title);
        setActiveWorkspaceDb(workspace);
    });

    it('coalesces message document creation across callers and preserves content and manual names on repeated actions', async () => {
        const db = getDb();
        const content = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: topic }] }] };
        const input = { title: 'Temporary', content, title_source: 'temporary' as const };
        const [a, b] = await Promise.all([createMessageDocument(db, input, 'message-1', topic, () => {}), createMessageDocument(db, input, 'message-1', topic, () => {})]);
        expect(a.id).toBe(b.id);
        expect(await db.posts.count()).toBe(1);
        expect(a.content).toEqual(content);
        await updateDocumentInDb(db, a.id, { title: 'My document' });
        expect(await createMessageDocument(db, input, 'message-1', topic, () => {})).toMatchObject({ id: a.id, title: 'My document', content });
    });
});
