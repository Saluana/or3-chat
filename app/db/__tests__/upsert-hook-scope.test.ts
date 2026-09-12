import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookCalls = vi.hoisted(() => ({
    events: [] as Array<{ hook: string; insideTx: boolean }>,
    insideTx: false,
}));

vi.mock('../../core/hooks/useHooks', () => ({
    useHooks: () => ({
        applyFilters: async (_name: string, value: unknown) => value,
        doAction: async (name: string) => {
            hookCalls.events.push({ hook: name, insideTx: hookCalls.insideTx });
        },
    }),
}));

vi.mock('../dbTry', () => ({
    dbTry: async <T>(fn: () => T | Promise<T>) => fn(),
}));

import { patchMessageInDb, upsertMessageInDb } from '../messages';

function makeDb(existing: any) {
    const calls: string[] = [];
    const db = {
        messages: {
            async get(_id: string) {
                calls.push(`get:${hookCalls.insideTx ? 'tx' : 'out'}`);
                return existing;
            },
            async put(_row: any) {
                calls.push(`put:${hookCalls.insideTx ? 'tx' : 'out'}`);
            },
        },
        tables: [{ name: 'messages' }],
        async transaction(_mode: string, _tables: unknown, fn: () => Promise<any>) {
            calls.push('tx:start');
            hookCalls.insideTx = true;
            try {
                return await fn();
            } finally {
                hookCalls.insideTx = false;
                calls.push('tx:end');
            }
        },
    } as any;
    return { db, calls };
}

const baseMessage = {
    id: 'msg-1',
    data: { content: 'hi' },
    role: 'user',
    created_at: 1,
    updated_at: 1,
    deleted: false,
    thread_id: 'thread-1',
    index: 0,
    clock: 3,
} as any;

describe('upsert hook transaction scope', () => {
    beforeEach(() => {
        hookCalls.events.length = 0;
        hookCalls.insideTx = false;
    });

    it('runs upsert preparation hooks outside the write transaction', async () => {
        const { db, calls } = makeDb(baseMessage);
        await upsertMessageInDb(db, { ...baseMessage });

        const before = hookCalls.events.find(
            (e) => e.hook === 'db.messages.upsert:action:before'
        );
        const after = hookCalls.events.find(
            (e) => e.hook === 'db.messages.upsert:action:after'
        );
        expect(before).toMatchObject({ insideTx: false });
        expect(after).toMatchObject({ insideTx: false });
        expect(calls).toEqual([
            'get:out',
            'tx:start',
            'get:tx',
            'put:tx',
            'tx:end',
        ]);
    });

    it('runs patch preparation hooks outside while merging inside', async () => {
        const { db, calls } = makeDb({
            ...baseMessage,
            data: { content: 'fresh', plugin: 'keep' },
        });
        await patchMessageInDb(db, 'msg-1', {
            data: { reasoning_text: 'new' },
        } as any);

        const before = hookCalls.events.find(
            (e) => e.hook === 'db.messages.upsert:action:before'
        );
        const after = hookCalls.events.find(
            (e) => e.hook === 'db.messages.upsert:action:after'
        );
        expect(before).toMatchObject({ insideTx: false });
        expect(after).toMatchObject({ insideTx: false });
        // Outside preview read, then atomic re-read + put inside.
        expect(calls).toEqual([
            'get:out',
            'tx:start',
            'get:tx',
            'put:tx',
            'tx:end',
        ]);
    });

    it('tolerates an async timer in the before hook', async () => {
        const { db } = makeDb(baseMessage);
        const { useHooks } = await import('../../core/hooks/useHooks');
        const hooks = useHooks();
        const original = hooks.doAction;
        (hooks as any).doAction = async (name: string, ...rest: unknown[]) => {
            if (name === 'db.messages.upsert:action:before') {
                await new Promise((resolve) => setTimeout(resolve, 15));
            }
            return (original as any)(name, ...rest);
        };
        await expect(
            upsertMessageInDb(db, { ...baseMessage })
        ).resolves.toBeUndefined();
    });
});
