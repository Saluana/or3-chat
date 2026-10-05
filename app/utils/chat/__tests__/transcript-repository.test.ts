import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createThreadInDb, hardDeleteThread } from '~/db/threads';
import { appendMessageToDb } from '~/db/messages';
import { appendForegroundToolResult } from '../transcript-repository';
import type { ToolCall } from '../types';

let workspace: string;
beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspace = `tool-transcript-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
});
afterEach(async () => {
    vi.restoreAllMocks();
    setHookEngine(null);
    const db = getDb();
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspace);
    await Dexie.delete(db.name);
});
const call: ToolCall = {
    id: 'call',
    type: 'function',
    function: { name: 'echo', arguments: '{}' },
};

describe('foreground tool-result ownership', () => {
    it.each(['append-first', 'delete-first'] as const)(
        'leaves no orphan when hard deletion orders %s',
        async (order) => {
            const db = getDb();
            const thread = await createThreadInDb(db, {
                title: 'Synthetic tool',
            });
            const parent = await appendMessageToDb(db, {
                thread_id: thread.id,
                role: 'assistant',
                data: { generation_id: 'stream' },
            });
            const append = () =>
                appendForegroundToolResult({
                    db,
                    threadId: thread.id,
                    turnId: 'turn',
                    parentAssistantId: parent.id,
                    generationId: 'stream',
                    call,
                    status: 'complete',
                    durableResult: 'synthetic-result',
                });
            if (order === 'append-first') {
                await append();
                expect(
                    await db.messages.where('role').equals('tool').count()
                ).toBe(1);
                await hardDeleteThread(thread.id);
            } else {
                let entered!: () => void;
                let release!: () => void;
                const arrived = new Promise<void>((resolve) => {
                    entered = resolve;
                });
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                const transaction = db.transaction.bind(db);
                const paused = vi
                    .spyOn(db, 'transaction')
                    .mockImplementationOnce(
                        (...args: Parameters<typeof db.transaction>) => {
                            entered();
                            return Dexie.Promise.resolve(gate).then(() =>
                                transaction(...args)
                            );
                        }
                    );
                const pending = append();
                const rejection = expect(pending).rejects.toThrow(/not found/);
                await arrived;
                paused.mockRestore();
                // No insertion transaction has opened yet. Hard delete commits first.
                await hardDeleteThread(thread.id);
                expect(await db.messages.get(parent.id)).toBeUndefined();
                release();
                await rejection;
            }
            expect(await db.threads.get(thread.id)).toBeUndefined();
            expect(
                await db.messages.where('thread_id').equals(thread.id).count()
            ).toBe(0);
        }
    );
    it('retains the request database after a workspace switch and fences superseded generations', async () => {
        const db = getDb();
        const thread = await createThreadInDb(db, {
            title: 'Captured request',
        });
        const parent = await appendMessageToDb(db, {
            thread_id: thread.id,
            role: 'assistant',
            data: { generation_id: 'current-generation' },
        });
        const otherWorkspace = `tool-other-${crypto.randomUUID()}`;
        const otherDb = setActiveWorkspaceDb(otherWorkspace);
        await otherDb.open();
        const append = (generationId: string) =>
            appendForegroundToolResult({
                db,
                threadId: thread.id,
                turnId: 'turn',
                parentAssistantId: parent.id,
                generationId,
                call,
                status: 'complete',
                durableResult: 'captured-result',
            });
        try {
            await expect(append('old-generation')).rejects.toThrow(
                /superseded/
            );
            expect(await db.messages.where('role').equals('tool').count()).toBe(
                0
            );
            const saved = await append('current-generation');
            expect(await db.messages.get(saved.id)).toMatchObject({
                role: 'tool',
                thread_id: thread.id,
            });
            expect(await otherDb.messages.count()).toBe(0);
        } finally {
            setActiveWorkspaceDb(workspace);
            evictWorkspaceDb(otherWorkspace);
            await Dexie.delete(otherDb.name);
        }
    });
    it('rejects a parent from another thread without writing', async () => {
        const db = getDb();
        const thread = await createThreadInDb(db, { title: 'Target' });
        const other = await createThreadInDb(db, { title: 'Other' });
        const parent = await appendMessageToDb(db, {
            thread_id: other.id,
            role: 'assistant',
            data: {},
        });
        await expect(
            appendForegroundToolResult({
                db,
                threadId: thread.id,
                turnId: 'turn',
                parentAssistantId: parent.id,
                call,
                status: 'error',
                durableResult: 'synthetic-error',
            })
        ).rejects.toThrow(/does not belong/);
        expect(
            await db.messages.where('thread_id').equals(thread.id).count()
        ).toBe(0);
    });
});
