import { HookBridge } from '~/core/sync/hook-bridge';
import { buildOpenRouterMessages } from '~/core/auth/openrouter-build';
import { sanitizePayloadForSync } from '~~/shared/sync/sanitize';
import { readToolResultStorage } from '~~/shared/chat/tool-result-artifact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { setHookEngine } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createThreadInDb, hardDeleteThread } from '~/db/threads';
import { appendMessageToDb, copyMessage, moveMessage, patchMessageInDb } from '~/db/messages';
import { appendForegroundToolResult } from '../transcript-repository';
import type { ToolCall } from '../types';

let workspace: string; let bridge: HookBridge | undefined;
beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspace = `tool-transcript-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
});
afterEach(async () => {
    bridge?.stop(); bridge = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    it.each(['copy', 'move'] as const)('rejects a transfer when tool output appears after preparation (%s)', async operation => {
        const db = getDb();
        bridge = new HookBridge(db); bridge.start();
        const source = await createThreadInDb(db, { title: 'Source' });
        const destination = await createThreadInDb(db, { title: 'Destination' });
        const parent = await appendMessageToDb(db, { thread_id: source.id, role: 'assistant' });
        let entered!: () => void;
        let release!: () => void;
        const arrived = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const transaction = db.transaction.bind(db);
        const paused = vi.spyOn(db, 'transaction').mockImplementationOnce((...args: Parameters<typeof db.transaction>) => {
            entered();
            return Dexie.Promise.resolve(gate).then(() => transaction(...args));
        });
        const transfer = (operation === 'copy' ? copyMessage : moveMessage)(parent.id, destination.id);
        const outcome = transfer.then(() => null, (error: unknown) => error);
        try {
            await arrived;
            paused.mockRestore();
            const tool = await appendForegroundToolResult({ db, threadId: source.id, turnId: parent.id,
                parentAssistantId: parent.id, call, status: 'complete', durableResult: 'Concurrent full result. '.repeat(1400) });
            const reference = (tool.data as Record<string, string>).content!;
            await patchMessageInDb(db, parent.id, { data: { tool_calls: [
                { id: call.id, name: call.function.name, status: 'complete', result: reference },
            ] } });
            release();
            expect(await outcome).toEqual(expect.objectContaining({ message: expect.stringMatching(/changed.*retry/i) }));
            expect((await db.messages.get(parent.id))?.thread_id).toBe(source.id);
            expect(await db.messages.where('thread_id').equals(destination.id).count()).toBe(0);
        } finally {
            paused.mockRestore();
            release();
            await outcome;
        }
    });

    it.each(['copy', 'move'] as const)('retains transferred tool output after deleting its original thread (%s)', async operation => {
        const db = getDb(); bridge = new HookBridge(db); bridge.start();
        const source = await createThreadInDb(db, { title: 'Source' });
        const destination = await createThreadInDb(db, { title: 'Destination' });
        const parent = await appendMessageToDb(db, { thread_id: source.id, role: 'assistant' });
        const output = 'Complete transferred output. '.repeat(1400);
        const tool = await appendForegroundToolResult({ db, threadId: source.id, turnId: parent.id,
            parentAssistantId: parent.id, call, status: 'complete', durableResult: output });
        const reference = (tool.data as Record<string, string>).content!;
        await patchMessageInDb(db, parent.id, { data: { content: '', tool_calls: [{ id: call.id, name: call.function.name,
            status: 'complete', result: reference, transcript: { result: reference } }] } });
        const transfer = operation === 'copy' ? copyMessage : moveMessage;
        await transfer(parent.id, destination.id); await transfer(tool.id, destination.id);
        await hardDeleteThread(source.id);
        const transferred = await db.messages.where('thread_id').equals(destination.id).toArray();
        const toolRow = transferred.find(row => row.role === 'tool')!;
        const assistant = transferred.find(row => row.role === 'assistant')!;
        const result = (toolRow.data as Record<string, string>).content!;
        const calls = (assistant.data as { tool_calls: Array<{ result: string; transcript: { result: string } }> }).tool_calls;
        for (const retained of [result, calls[0]!.result, calls[0]!.transcript.result])
            expect(await readToolResultStorage(retained, id => db.kv.get(id))).toBe(output);
        expect(await buildOpenRouterMessages([{ role: 'tool', content: result }])).toMatchObject([
            { content: [{ type: 'text', text: output }] },
        ]);
        await hardDeleteThread(destination.id);
        expect(await db.kv.count()).toBe(0);
    });

    it.each(['x'.repeat(256 * 1024), '"'.repeat(140_000), 'useful content '.repeat(1400)])('retains every byte of an accepted overflow tool result (%#)', async (output) => {
        // Text chat also runs in HTTP development contexts without SubtleCrypto.
        if (output.startsWith('useful')) vi.stubGlobal('crypto', {
            randomUUID: crypto.randomUUID.bind(crypto), getRandomValues: crypto.getRandomValues.bind(crypto),
        });
        const db = getDb(); bridge = new HookBridge(db); bridge.start();
        const thread = await createThreadInDb(db, { title: 'Tool overflow' });
        const parent = await appendMessageToDb(db, { thread_id: thread.id, role: 'assistant', data: { generation_id: 'stream' } });
        const saved = await appendForegroundToolResult({ db, threadId: thread.id, turnId: parent.id, parentAssistantId: parent.id,
            generationId: 'stream', call, status: 'complete', durableResult: output });
        expect(() => sanitizePayloadForSync('messages', saved, 'put')).not.toThrow();
        const reference = (saved.data as Record<string, unknown>).content as string;
        expect(await readToolResultStorage(reference, id => db.kv.get(id))).toBe(output);
        const wire = await buildOpenRouterMessages([{ role: 'tool', content: reference }]);
        const hydrated = wire[0]?.content;
        expect(JSON.stringify(hydrated)).not.toContain('or3-tool-result:v1/');
        if (output.startsWith('useful')) expect(hydrated).toEqual([{ type: 'text', text: output }]);
        const chunks = await db.kv.toArray();
        expect((await db.pending_ops.toArray()).filter(op => op.tableName === 'kv')).toHaveLength(chunks.length);
        for (const row of chunks) expect(new TextEncoder().encode(JSON.stringify(row)).length).toBeLessThan(256 * 1024);
        await hardDeleteThread(thread.id);
        expect(await db.kv.toArray()).toEqual([]);
        bridge.stop();
    });
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
