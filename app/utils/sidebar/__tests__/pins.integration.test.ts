import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb } from '~/db/client';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { pinName, readPinEntries, resolvePinnedItems, setPinned } from '../pins';

let workspace: string;
let clock = 1_000;
beforeEach(async () => {
    workspace = `pins-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine()));
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10));
});
afterEach(async () => {
    vi.restoreAllMocks();
    const db = getDb();
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspace);
    await Dexie.delete(db.name);
    setHookEngine(null);
});

const thread = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Chat ${id}`, status: 'ready', clock: 1,
    created_at: 1, updated_at: 1, deleted: false, pinned: false, forked: false, ...extra });
const doc = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Doc ${id}`, content: '', postType: 'doc', clock: 0,
    created_at: 1, updated_at: 1, deleted: false, meta: '', ...extra });

describe('sidebar pins', () => {
    it('lists the most recently pinned first, moves a re-pinned item to the top and forgets an unpinned one', async () => {
        const db = getDb();
        await setPinned(db, 'thread', 'a', true);
        await setPinned(db, 'document', 'b', true);
        await setPinned(db, 'thread', 'c', true);
        expect((await readPinEntries(db)).map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
        await setPinned(db, 'thread', 'a', true);
        expect((await readPinEntries(db)).map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
        await setPinned(db, 'thread', 'c', false);
        expect((await readPinEntries(db)).map((entry) => `${entry.kind}:${entry.id}`)).toEqual(['thread:a', 'document:b']);
    });
    it('unpinning something that is not pinned, or twice, is harmless', async () => {
        const db = getDb();
        await expect(setPinned(db, 'thread', 'never', false)).resolves.toBeUndefined();
        await setPinned(db, 'thread', 'x', true);
        await setPinned(db, 'thread', 'x', false);
        await expect(setPinned(db, 'thread', 'x', false)).resolves.toBeUndefined();
        expect(await readPinEntries(db)).toEqual([]);
    });
    it.each(['plain', 'with:colon', 'a/b?c=d', 'ünï-çødé 🎉'])('round-trips the id %s', async (id) => {
        const db = getDb();
        await setPinned(db, 'document', id, true);
        expect((await readPinEntries(db)).map((entry) => [entry.kind, entry.id])).toEqual([['document', id]]);
    });
    it('ignores rows that only look like pins', async () => {
        const db = getDb();
        const row = (name: string, value: string | null, deleted = false) => ({ id: `kv:${name}`, name, value, deleted, created_at: 1, updated_at: 1, clock: 1 });
        await db.kv.bulkPut([
            row('sidebar-pin:thread:', '5'), row('sidebar-pin:file:abc', '5'), row('sidebar-pin:thread', '5'),
            row('sidebar-pin:thread:old', 'not a number'), row('sidebar-pin:thread:gone', '9', true), row('other:thread:keep', '5'),
        ]);
        await setPinned(db, 'thread', 'real', true);
        expect((await readPinEntries(db)).map((entry) => entry.id)).toEqual(['real', 'old']);
    });
    it('resolves pins to existing chats and documents in pin order and skips deleted, missing and non-document items', async () => {
        const db = getDb();
        await db.threads.bulkPut([thread('t1'), thread('t2', { deleted: true })] as never);
        await db.posts.bulkPut([doc('d1'), doc('d2', { deleted: true }), doc('d3', { postType: 'markdown' })] as never);
        for (const [kind, id] of [['thread', 't1'], ['thread', 't2'], ['thread', 'missing'], ['document', 'd1'], ['document', 'd2'], ['document', 'd3']] as const) {
            await setPinned(db, kind, id, true);
        }
        const items = await resolvePinnedItems(db, await readPinEntries(db));
        expect(items.map((item) => [item.type, item.id, item.title])).toEqual([['document', 'd1', 'Doc d1'], ['thread', 't1', 'Chat t1']]);
    });
    it('keeps pins per workspace', async () => {
        await setPinned(getDb(), 'thread', 'mine', true);
        const other = `pins-other-${crypto.randomUUID()}`;
        const otherDb = setActiveWorkspaceDb(other);
        await otherDb.open();
        try {
            expect(await readPinEntries(otherDb)).toEqual([]);
        } finally {
            setActiveWorkspaceDb(workspace);
            evictWorkspaceDb(other);
            await Dexie.delete(otherDb.name);
        }
        expect((await readPinEntries(getDb())).map((entry) => entry.id)).toEqual(['mine']);
    });
    it('names a pin from its kind and encoded id', () => {
        expect(pinName('thread', 'a:b/c')).toBe('sidebar-pin:thread:a%3Ab%2Fc');
    });
});
