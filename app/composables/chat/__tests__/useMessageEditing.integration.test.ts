import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { evictWorkspaceDb, getWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { useMessageEditing } from '../useMessageEditing';
import type { SessionContext } from '~/core/hooks/hook-types';

const auth = vi.hoisted(() => ({ cloud: false, session: null as SessionContext | null }));
vi.mock('#imports', async original => ({
    ...await original<typeof import('#imports')>(),
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: auth.cloud } }),
}));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => auth.session }));

const databases: Array<{ id: string; db: Or3DB }> = [];
beforeEach(() => {
    auth.cloud = false; auth.session = null;
    setHookEngine(createTypedHookEngine(createHookEngine()));
});
afterEach(async () => {
    vi.restoreAllMocks();
    setActiveWorkspaceDb(null);
    for (const { id, db } of databases.splice(0)) {
        evictWorkspaceDb(id);
        await Dexie.delete(db.name);
    }
    setHookEngine(null);
});

async function fixture(label: string) {
    const id = `message-edit-${label}-${crypto.randomUUID()}`;
    const db = getWorkspaceDb(id);
    databases.push({ id, db });
    await db.threads.put({ id: 'thread', title: label, created_at: 1, updated_at: 1,
        deleted: false, clock: 1, status: 'ready', pinned: false, forked: false });
    await db.messages.put({ id: 'message', thread_id: 'thread', role: 'user',
        data: { content: label, plugin: 'original' }, index: 1, order_key: 'order',
        created_at: 1, updated_at: 1, deleted: false, clock: 1 });
    return { id, db };
}

function edit(content = 'A') {
    const message = ref({ id: 'message', content });
    const editor = useMessageEditing(message);
    editor.beginEdit();
    editor.draft.value = 'edited';
    return { message, editor };
}

function holdPreparation() {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    useHooks().addFilter('db.messages.upsert:filter:input', async row => {
        entered(); await gate; return row;
    });
    return { release, reached };
}

describe('message editor persistence ownership', () => {
    it.each(['account', 'permission', 'revision', 'expired'] as const)('rejects a change in %s while preparation waits', async change => {
        const a = await fixture('A'); setActiveWorkspaceDb(a.id);
        auth.cloud = true;
        auth.session = { authenticated: true, user: { id: 'user-A' }, workspace: { id: a.id, name: 'A' }, role: 'owner', authorizationRevision: 1 };
        const { editor, message } = edit(); const hold = holdPreparation();
        const saving = editor.saveEdit().catch(error => error); await hold.reached;
        if (change === 'account') auth.session.user = { id: 'user-B' };
        if (change === 'permission') auth.session.role = 'viewer';
        if (change === 'revision') auth.session.authorizationRevision = 2;
        if (change === 'expired') auth.session.expiresAt = '2000-01-01T00:00:00Z';
        hold.release(); expect(await saving).toBeInstanceOf(Error);
        expect((await a.db.messages.get('message'))?.data).toMatchObject({ content: 'A' });
        expect(message.value.content).toBe('A');
    });

    it.each(['switch', 'return'] as const)('refuses a save after its workspace changes (%s)', async transition => {
        const a = await fixture('A'); const b = await fixture('B');
        setActiveWorkspaceDb(a.id);
        const { editor, message } = edit();
        const get = a.db.messages.get.bind(a.db.messages);
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const reached = new Promise<void>(resolve => { entered = resolve; });
        vi.spyOn(a.db.messages, 'get').mockImplementationOnce(((key: string) => get(key).then(row => {
            entered(); return Dexie.Promise.resolve(gate).then(() => row);
        })) as typeof a.db.messages.get);
        const saving = editor.saveEdit().catch(error => error);
        await reached;
        setActiveWorkspaceDb(b.id);
        if (transition === 'return') setActiveWorkspaceDb(a.id);
        release(); await saving;
        expect((await b.db.messages.get('message'))?.data).toMatchObject({ content: 'B' });
        expect((await a.db.messages.get('message'))?.data).toMatchObject({ content: 'A' });
        expect(message.value.content).toBe('A');
    });

    it('merges edited content into fresh metadata after asynchronous preparation', async () => {
        const a = await fixture('A'); setActiveWorkspaceDb(a.id);
        const { editor } = edit(); const hold = holdPreparation();
        const saving = editor.saveEdit(); await hold.reached;
        await a.db.messages.update('message', { data: { content: 'A', plugin: 'new metadata' }, clock: 8 });
        hold.release(); expect(await saving).toBe('saved');
        expect((await a.db.messages.get('message'))?.data).toEqual({ content: 'edited', plugin: 'new metadata' });
        expect((await a.db.messages.get('message'))?.clock).toBeGreaterThan(8);
    });

    it.each(['message deleted', 'message missing', 'thread deleted', 'thread missing'] as const)('does not resurrect data when %s during preparation', async failure => {
        const a = await fixture('A'); setActiveWorkspaceDb(a.id);
        const { editor, message } = edit(); const hold = holdPreparation();
        const saving = editor.saveEdit().catch(error => error); await hold.reached;
        if (failure === 'message deleted') await a.db.messages.update('message', { deleted: true });
        if (failure === 'message missing') await a.db.messages.delete('message');
        if (failure === 'thread deleted') await a.db.threads.update('thread', { deleted: true });
        if (failure === 'thread missing') await a.db.threads.delete('thread');
        hold.release(); expect(await saving).toBeInstanceOf(Error);
        const row = await a.db.messages.get('message');
        expect(row?.data).not.toMatchObject({ content: 'edited' });
        if (failure === 'message deleted') expect(row?.deleted).toBe(true);
        if (failure === 'message missing') expect(row).toBeUndefined();
        expect(message.value.content).toBe('A');
    });

    it('does not publish a completed edit into a replacement presentation row', async () => {
        const a = await fixture('A'); setActiveWorkspaceDb(a.id);
        const { editor, message } = edit(); const hold = holdPreparation();
        const old = message.value;
        const saving = editor.saveEdit().catch(error => error); await hold.reached;
        message.value = { id: 'other', content: 'other' };
        hold.release(); await saving;
        expect(message.value.content).toBe('other');
        expect(old.content).toBe('A');
    });
});
