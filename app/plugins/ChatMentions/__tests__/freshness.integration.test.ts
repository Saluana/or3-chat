import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import type { Message } from '~/db/schema';
import { resetIndex, resolveMention } from '../useChatMentions';

vi.mock('#imports', async () => ({
    useAppConfig: () => ({}), useRuntimeConfig: () => ({ public: { ssrAuthEnabled: false } }),
    useHooks: (await import('~/core/hooks/useHooks')).useHooks,
}));
vi.mock('~/composables/useOr3Config', () => ({ useOr3Config: () => ({ features: { mentions: { enabled: true } } }), isMentionSourceEnabled: () => true }));
vi.mock('~/utils/errors', () => ({ reportError: vi.fn() }));

let workspaces: Array<{ id: string; name: string }> = [];
let dispose: (() => void) | undefined;
async function workspace() {
    const id = `mention-freshness-${crypto.randomUUID()}`;
    const db = setActiveWorkspaceDb(id); workspaces.push({ id, name: db.name });
    return db;
}
const mention = { id: 'doc', source: 'document' as const, label: 'Original title' };
const editorContent = { type: 'doc', content: [{ type: 'mention', attrs: mention }] };
beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    resetIndex();
    const db = await workspace();
    await db.posts.put({ id: 'doc', postType: 'doc', title: 'Fresh title', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fresh body' }] }] }),
        clock: 1, created_at: 1, updated_at: 1, deleted: false });
    await db.threads.put({ id: 'chat', title: 'Fresh chat', clock: 1, created_at: 1, updated_at: 1,
        deleted: false, status: 'ready', pinned: false, forked: false });
});
afterEach(async () => {
    dispose?.(); dispose = undefined; resetIndex(); setHookEngine(null); setActiveWorkspaceDb(null);
    for (const { id, name } of workspaces) { evictWorkspaceDb(id); await Dexie.delete(name); }
    workspaces = []; vi.restoreAllMocks();
});
async function installPlugin() {
    const plugin = (await import('../../mentions.client')).default;
    await (plugin as unknown as (app: unknown) => Promise<void>)({ vueApp: { onUnmount: (fn: () => void) => { dispose = fn; } } });
}

// Real database and AI filter boundary. Failure modes: stale labels or
// tombstones enter the prompt, late reads cross workspaces, a no-context send
// leaks editor state into the next send.
describe('mention freshness', () => {
    it('uses the editor snapshot belonging to this request instead of another pending composer', async () => {
        await installPlugin();
        await getDb().posts.put({ id: 'other', postType: 'doc', title: 'Other composer secret', content: 'Unrelated evidence',
            clock: 1, created_at: 1, updated_at: 1, deleted: false });
        await useHooks().doAction('ui.chat.editor:action:before_send', { type: 'doc', content: [{ type: 'mention',
            attrs: { id: 'other', source: 'document', label: 'Other composer secret' } }] } as never);
        const result = await useHooks().applyFilters('ai.chat.messages:filter:before_send', {
            messages: [{ role: 'user', content: 'Read my reference' }], editorDoc: editorContent,
        } as never);
        expect(JSON.stringify(result)).toContain('Fresh title');
        expect(JSON.stringify(result)).not.toContain('Other composer secret');
    });

    it('resolves the current document title and text through the send filter', async () => {
        await installPlugin();
        const result = await useHooks().applyFilters('ai.chat.messages:filter:before_send', {
            messages: [{ role: 'user', content: 'Read this', editorContent }],
        } as never);
        expect(JSON.stringify(result)).toContain('Referenced Document: Fresh title');
        expect(JSON.stringify(result)).toContain('Fresh body');
        const context = (result as { messages: unknown[] }).messages[0];
        expect(JSON.stringify(context)).not.toContain('Original title');
    });

    it('excludes deleted messages and resolves the current chat label', async () => {
        const db = getDb();
        for (const [index, deleted, text] of [[0, false, 'Visible text'], [1, true, 'Deleted secret']] as const) {
            await db.messages.put({ id: `m${index}`, thread_id: 'chat', index, role: 'user', deleted,
                data: { content: text }, clock: 1, created_at: 1, updated_at: 1 } as Message);
        }
        const context = await resolveMention({ id: 'chat', source: 'chat', label: 'Old chat' });
        expect(context).toContain('Visible text');
        expect(context).toContain('Fresh chat');
        expect(context).not.toContain('Deleted secret');
    });

    it('discards a reference when the workspace switches away and back during its read', async () => {
        const db = getDb(); const originalId = workspaces[0]!.id;
        const get = db.posts.get.bind(db.posts);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const spy = vi.spyOn(db.posts, 'get').mockImplementationOnce(((...args: Parameters<typeof get>) =>
            Dexie.Promise.resolve(get(...args)).then(async row => { await gate; return row; })
        ) as typeof db.posts.get);
        const pending = resolveMention(mention);
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        await workspace(); setActiveWorkspaceDb(originalId); release();
        expect(await pending).toBeNull();
    });

    it('does not reuse an editor action snapshot on a later unrelated send', async () => {
        await installPlugin();
        await getDb().posts.update('doc', { deleted: true });
        await useHooks().doAction('ui.chat.editor:action:before_send', editorContent as never);
        await useHooks().applyFilters('ai.chat.messages:filter:before_send', { messages: [{ role: 'user', content: 'First' }] } as never);
        await getDb().posts.update('doc', { deleted: false, content: JSON.stringify({ type: 'doc', content: [{ type: 'text', text: 'Fresh body' }] }) });
        const payload = { messages: [{ role: 'user', content: 'Unrelated next turn' }] };
        const result = await useHooks().applyFilters('ai.chat.messages:filter:before_send', payload as never);
        expect(result).toEqual(payload);
    });
});
