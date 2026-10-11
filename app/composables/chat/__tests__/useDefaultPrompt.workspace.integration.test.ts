import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { evictWorkspaceDb, getWorkspaceDb, setActiveWorkspaceDb, type Or3DB } from '~/db/client';
import { getDefaultPromptId, useDefaultPrompt } from '../useDefaultPrompt';

vi.mock('#imports', async original => ({
    ...await original<typeof import('#imports')>(), useHooks: () => useHooks(),
}));

const databases: Array<{ id: string; db: Or3DB }> = [];
afterEach(async () => {
    vi.restoreAllMocks();
    setActiveWorkspaceDb(null);
    for (const { id, db } of databases.splice(0)) {
        evictWorkspaceDb(id); await Dexie.delete(db.name);
    }
    setHookEngine(null);
});

async function fixture(label: string) {
    const id = `default-prompt-${label}-${crypto.randomUUID()}`;
    const db = getWorkspaceDb(id);
    databases.push({ id, db });
    await db.kv.put({ id: 'identical-default-row', name: 'default_system_prompt_id',
        value: `${label}-existing`, clock: 1, created_at: 1, updated_at: 1, deleted: false });
    return { id, db };
}

// Fault inventory: an admitted A action waits for initial KV loading, then the
// mutable active DB becomes B before persistence; B's existing default must not
// be overwritten. Captured A load results must not replace a newer B cache.
// An unchanged action still persists and emits its existing public hook.
describe('default prompt workspace continuation with real KV', () => {
    it.each([
        ['switch', 'A-new'], ['switch', null],
        ['return', 'A-new'], ['return', null],
    ] as const)('keeps a suspended default preference write in its originating workspace (%s, %s)', async (transition, selection) => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A');
        const target = await fixture('B');
        setActiveWorkspaceDb(origin.id);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        const where = origin.db.kv.where.bind(origin.db.kv);
        vi.spyOn(origin.db.kv, 'where').mockImplementation(((index: string) => {
            const query = where(index);
            const equals = query.equals.bind(query);
            query.equals = value => {
                const collection = equals(value);
                const first = collection.first.bind(collection);
                vi.spyOn(collection, 'first').mockImplementation(() => first().then(row => {
                    entered(); return Dexie.Promise.resolve(gate).then(() => row);
                }));
                return collection;
            };
            return query;
        }) as typeof origin.db.kv.where);
        const prompt = useDefaultPrompt();
        const writing = selection === null ? prompt.clearDefaultPrompt() : prompt.setDefaultPrompt(selection);
        await reached;
        setActiveWorkspaceDb(target.id);
        if (transition === 'return') setActiveWorkspaceDb(origin.id);
        try { release(); await writing; }
        finally { release(); }
        expect((await target.db.kv.where('name').equals('default_system_prompt_id').first())?.value).toBe('B-existing');
        expect((await where('name').equals('default_system_prompt_id').first())?.value).toBe(selection);
        await prompt.ensureLoaded();
        expect(prompt.defaultPromptId.value).toBe(transition === 'return' ? selection : 'B-existing');
    });

    it.each(['success', 'failure'] as const)('does not publish a captured origin default after a newer destination load (%s)', async outcome => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A');
        const target = await fixture('B');
        setActiveWorkspaceDb(origin.id);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const prompt = useDefaultPrompt();
        const where = origin.db.kv.where.bind(origin.db.kv);
        vi.spyOn(origin.db.kv, 'where').mockImplementation(((index: string) => {
            const query = where(index);
            const equals = query.equals.bind(query);
            query.equals = value => {
                const collection = equals(value);
                const first = collection.first.bind(collection);
                vi.spyOn(collection, 'first').mockImplementation(() =>
                    first().then(row => Dexie.Promise.resolve(gate).then(() => {
                        if (outcome === 'failure') throw new Error('Synthetic old default read failure');
                        return row;
                    })));
                return collection;
            };
            return query;
        }) as typeof origin.db.kv.where);
        const oldLoad = prompt.ensureLoaded();
        setActiveWorkspaceDb(target.id);
        try {
            await prompt.ensureLoaded();
            expect(prompt.defaultPromptId.value).toBe('B-existing');
            release(); await oldLoad;
            expect(prompt.defaultPromptId.value).toBe('B-existing');
            expect(await getDefaultPromptId()).toBe('B-existing');
        } finally { release(); await oldLoad; }
    });

    it('persists and reports a current-workspace preference normally', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current');
        setActiveWorkspaceDb(current.id);
        const changed = vi.fn();
        useHooks().addAction('chat.systemPrompt.default:action:update', changed);
        const prompt = useDefaultPrompt();
        await prompt.setDefaultPrompt('current-new');
        expect(prompt.defaultPromptId.value).toBe('current-new');
        expect(await getDefaultPromptId()).toBe('current-new');
        expect(changed).toHaveBeenCalledWith('current-new');
    });

    it('does not report an uncommitted preference when the KV write fails, and recovers on retry', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current');
        setActiveWorkspaceDb(current.id);
        const changed = vi.fn();
        useHooks().addAction('chat.systemPrompt.default:action:update', changed);
        const prompt = useDefaultPrompt();
        await prompt.ensureLoaded();
        vi.spyOn(current.db.kv, 'put').mockImplementationOnce(() =>
            Dexie.Promise.reject(new Error('Synthetic default preference write failure')));
        await expect(prompt.setDefaultPrompt('current-new')).rejects.toThrow('Synthetic default preference write failure');
        expect(await getDefaultPromptId()).toBe('Current-existing');
        expect(prompt.defaultPromptId.value).toBe('Current-existing');
        expect(changed).not.toHaveBeenCalled();
        await prompt.setDefaultPrompt('current-new');
        expect(prompt.defaultPromptId.value).toBe('current-new');
        expect(await getDefaultPromptId()).toBe('current-new');
        expect(changed).toHaveBeenCalledOnce();
    });

    it('suppresses old-workspace update hooks when an admitted KV write completes after switching', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const origin = await fixture('A');
        const target = await fixture('B');
        setActiveWorkspaceDb(origin.id);
        const prompt = useDefaultPrompt();
        await prompt.ensureLoaded();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        useHooks().addFilter('db.kv.upsertByName:filter:input', async record => {
            entered(); await gate; return record;
        });
        const changed = vi.fn();
        useHooks().addAction('chat.systemPrompt.default:action:update', changed);
        const writing = prompt.setDefaultPrompt('A-new');
        await reached;
        setActiveWorkspaceDb(target.id);
        try { await prompt.ensureLoaded(); release(); await writing; }
        finally { release(); }
        expect((await origin.db.kv.where('name').equals('default_system_prompt_id').first())?.value).toBe('A-new');
        expect(await getDefaultPromptId()).toBe('B-existing');
        expect(prompt.defaultPromptId.value).toBe('B-existing');
        expect(changed).not.toHaveBeenCalled();
    });

    it('recovers the current default after an initial KV read failure', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current');
        const where = current.db.kv.where.bind(current.db.kv);
        const failedRead = vi.spyOn(current.db.kv, 'where').mockImplementation(((index: string) => {
            const query = where(index);
            const equals = query.equals.bind(query);
            query.equals = value => {
                const collection = equals(value);
                vi.spyOn(collection, 'first').mockImplementation(() =>
                    Dexie.Promise.reject(new Error('Synthetic current default read failure')));
                return collection;
            };
            return query;
        }) as typeof current.db.kv.where);
        setActiveWorkspaceDb(current.id);
        const prompt = useDefaultPrompt();
        await prompt.ensureLoaded();
        expect(prompt.defaultPromptId.value).toBeNull();
        failedRead.mockRestore();
        await prompt.ensureLoaded();
        expect(prompt.defaultPromptId.value).toBe('Current-existing');
        expect(await getDefaultPromptId()).toBe('Current-existing');
    });

    it('reports the committed default when a KV input filter transforms the preference', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current');
        setActiveWorkspaceDb(current.id);
        useHooks().addFilter('db.kv.upsertByName:filter:input', record => ({ ...record, value: 'canonical-default' }));
        const changed = vi.fn();
        useHooks().addAction('chat.systemPrompt.default:action:update', changed);
        const prompt = useDefaultPrompt();
        await prompt.setDefaultPrompt('requested-default');
        expect(await getDefaultPromptId()).toBe('canonical-default');
        expect(prompt.defaultPromptId.value).toBe('canonical-default');
        expect(changed).toHaveBeenCalledWith('canonical-default');
    });

    it('reports overlapping current-workspace writes in actual commit order', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const current = await fixture('Current');
        setActiveWorkspaceDb(current.id);
        const prompt = useDefaultPrompt();
        await prompt.ensureLoaded();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let entered!: () => void;
        const reached = new Promise<void>(resolve => { entered = resolve; });
        useHooks().addFilter('db.kv.upsertByName:filter:input', async record => {
            if (record.value === 'first-admitted') { entered(); await gate; }
            return record;
        });
        const changed = vi.fn();
        useHooks().addAction('chat.systemPrompt.default:action:update', changed);
        const first = prompt.setDefaultPrompt('first-admitted');
        await reached;
        try {
            await prompt.setDefaultPrompt('second-admitted');
            expect(await getDefaultPromptId()).toBe('second-admitted');
            expect(prompt.defaultPromptId.value).toBe('second-admitted');
            release(); await first;
            expect(await getDefaultPromptId()).toBe('first-admitted');
            expect(prompt.defaultPromptId.value).toBe('first-admitted');
            expect(changed.mock.calls).toEqual([['second-admitted'], ['first-admitted']]);
        } finally { release(); await first; }
    });
});
