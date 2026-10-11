import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb, getDb } from '~/db/client';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import { useToolRegistry } from '../tool-registry';

const names: string[] = [];
let workspace: string;

beforeEach(async () => {
    workspace = `tool-context-${crypto.randomUUID()}`;
    const db = setActiveWorkspaceDb(workspace);
    await db.threads.put({ id: 'thread-1', title: 'Ordinary tool origin', status: 'ready',
        created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false, forked: false });
});

afterEach(async () => {
    const registry = useToolRegistry();
    names.splice(0).forEach((name) => registry.unregisterTool(name));
    const db = getDb();
    setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name);
});

describe('client tool execution context', () => {
    // Bridge validation can wait for the network after approval. It must run
    // outside write transactions and must not replace local mutation fencing.
    it('validates a bridge admission outside the handler transaction only once', async () => {
        const registry = useToolRegistry();
        const definition: ToolDefinition = {
            type: 'function', runtime: 'client',
            function: { name: 'bridge_transaction', description: 'Bridge transaction', parameters: { type: 'object', properties: {} } },
        };
        names.push(definition.function.name);
        const beforeExecute = vi.fn(async () => {
            expect(Dexie.currentTransaction).toBeFalsy();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        registry.registerTool(definition, async (_args, context) => {
            const db = getDb();
            await db.transaction('rw', db.threads, db.projects, db.posts, db.file_meta, async () => {
                expect(Dexie.currentTransaction).toBeTruthy();
                await context.assertToolAuthorized?.();
                await db.threads.update('thread-1', { title: 'Authorized mutation' });
            });
            return 'saved';
        }, { override: true });
        const context: ToolExecutionContext = {
            subject: 'user-1', workspaceId: workspace, threadId: 'thread-1',
            messageId: 'message-1', callId: 'call-1', requestId: 'job-1',
            abortSignal: new AbortController().signal,
        };
        await expect(registry.executeTool(definition.function.name, '{}', context, { definition, beforeExecute }))
            .resolves.toMatchObject({ result: 'saved' });
        expect(beforeExecute).toHaveBeenCalledTimes(1);
        expect((await getDb().threads.get('thread-1'))?.title).toBe('Authorized mutation');
    });

    it.each(['refused', 'disabled', 'aborted'] as const)('does not execute after bridge validation is %s', async (outcome) => {
        const registry = useToolRegistry();
        const definition: ToolDefinition = {
            type: 'function', runtime: 'client',
            function: { name: `bridge_${outcome}`, description: 'Bridge guard', parameters: { type: 'object', properties: {} } },
        };
        names.push(definition.function.name);
        const handler = vi.fn(() => 'must-not-run');
        registry.registerTool(definition, handler, { override: true });
        const abortController = new AbortController();
        const beforeExecute = vi.fn(async () => {
            await Promise.resolve();
            if (outcome === 'refused') throw new Error('Tool claim expired or was replaced');
            if (outcome === 'disabled') registry.setEnabled(definition.function.name, false);
            if (outcome === 'aborted') abortController.abort();
        });
        const context: ToolExecutionContext = {
            subject: 'user-1', workspaceId: workspace, threadId: 'thread-1',
            messageId: 'message-1', callId: 'call-1', requestId: 'job-1', abortSignal: abortController.signal,
        };
        await expect(registry.executeTool(definition.function.name, '{}', context, { definition, beforeExecute }))
            .resolves.toMatchObject({ result: null, error: expect.any(String) });
        expect(beforeExecute).toHaveBeenCalledTimes(1);
        expect(handler).not.toHaveBeenCalled();
    });

    it('supports contextual and legacy handler signatures', async () => {
        const registry = useToolRegistry();
        const contextual: ToolDefinition = {
            type: 'function',
            function: {
                name: 'client_contextual',
                description: 'Contextual',
                parameters: { type: 'object', properties: {} },
            },
        };
        const legacy: ToolDefinition = {
            ...contextual,
            function: { ...contextual.function, name: 'client_legacy' },
        };
        names.push(contextual.function.name, legacy.function.name);
        let received: ToolExecutionContext | undefined;
        registry.registerTool(contextual, (_args, context) => {
            received = context;
            return context.requestId;
        }, { override: true });
        registry.registerTool(legacy, () => 'legacy-ok', { override: true });
        const context: ToolExecutionContext = {
            subject: 'user-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            callId: 'call-1',
            requestId: 'request-1',
            abortSignal: new AbortController().signal,
        };

        await expect(registry.executeTool('client_contextual', '{}', context))
            .resolves.toMatchObject({ result: 'request-1' });
        await expect(registry.executeTool('client_legacy', '{}', context))
            .resolves.toMatchObject({ result: 'legacy-ok' });
        expect(received).toMatchObject({ ...context, abortSignal: expect.any(AbortSignal) });
        expect(received?.abortSignal).not.toBe(context.abortSignal);
    });

    it('rejects disabled, server-only, and definition-changed admitted tools', async () => {
        const registry = useToolRegistry();
        const definition: ToolDefinition = {
            type: 'function',
            function: {
                name: 'admission_test',
                description: 'original',
                parameters: { type: 'object', properties: {} },
            },
            runtime: 'hybrid',
        };
        const handler = vi.fn(() => 'should-not-run');
        registry.registerTool(definition, handler, { override: true });
        names.push(definition.function.name);

        registry.setEnabled(definition.function.name, false);
        await expect(registry.executeTool(definition.function.name, '{}', undefined, { definition }))
            .resolves.toMatchObject({ error: expect.stringContaining('disabled') });

        registry.registerTool({ ...definition, runtime: 'server' }, handler, { override: true });
        await expect(registry.executeTool(definition.function.name, '{}', undefined, { definition: { ...definition, runtime: 'server' } }))
            .resolves.toMatchObject({ error: expect.stringContaining('server-only') });

        registry.registerTool({ ...definition, function: { ...definition.function, description: 'changed' } }, handler, { override: true });
        await expect(registry.executeTool(definition.function.name, '{}', undefined, { definition }))
            .resolves.toMatchObject({ error: expect.stringContaining('no longer matches') });
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns an ownership-bound disposer that cannot remove a replacement', () => {
        const registry = useToolRegistry();
        const definition: ToolDefinition = {
            type: 'function',
            function: { name: 'owned_tool', description: 'owned', parameters: { type: 'object', properties: {} } },
        };
        names.push(definition.function.name);
        const first = registry.registerTool(definition, () => 'first', { override: true });
        const second = registry.registerTool(definition, () => 'second', { override: true });

        expect(first.dispose()).toBe(false);
        expect(registry.getTool(definition.function.name)).toBe(second);
        expect(second.dispose()).toBe(true);
        expect(second.dispose()).toBe(false);
        expect(registry.getTool(definition.function.name)).toBeUndefined();
    });
});
