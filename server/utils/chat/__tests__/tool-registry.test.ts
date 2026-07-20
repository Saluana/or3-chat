import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    registerServerTool,
    unregisterServerTool,
    executeServerTool,
    getServerTool,
} from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';

describe('server tool registry', () => {
    afterEach(() => vi.useRealTimers());
    it('executes a hybrid tool', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'server_echo',
                description: 'Echo input',
                parameters: {
                    type: 'object',
                    properties: {
                        value: { type: 'string' },
                    },
                    required: ['value'],
                },
            },
            runtime: 'hybrid',
        };

        registerServerTool(def, ({ value }: { value: string }) => value, {
            override: true,
        });

        const result = await executeServerTool(
            'server_echo',
            JSON.stringify({ value: 'ok' })
        );

        expect(result.error).toBeUndefined();
        expect(result.result).toBe('ok');

        unregisterServerTool('server_echo');
    });

    it('rejects client-only tools', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'client_only',
                description: 'Client only',
                parameters: {
                    type: 'object',
                    properties: {},
                },
            },
            runtime: 'client',
        };

        registerServerTool(def, () => 'nope', { override: true });

        const result = await executeServerTool('client_only', '{}');

        expect(result.error).toContain('client-only');

        unregisterServerTool('client_only');
    });

    it('passes exact request-scoped execution context while legacy handlers remain valid', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'context_tool',
                description: 'Context test',
                parameters: { type: 'object', properties: {} },
            },
            runtime: 'server',
        };
        let received: ToolExecutionContext | undefined;
        registerServerTool(def, (_args, context) => {
            received = context;
            return context.callId;
        }, { override: true });
        const controller = new AbortController();
        const context: ToolExecutionContext = {
            subject: 'user-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            callId: 'call-1',
            requestId: 'request-1',
            abortSignal: controller.signal,
        };

        await expect(executeServerTool('context_tool', '{}', context)).resolves.toMatchObject({
            result: 'call-1',
        });
        expect(received).toMatchObject({ ...context, abortSignal: expect.any(AbortSignal) });
        expect(received?.abortSignal).not.toBe(context.abortSignal);
        unregisterServerTool('context_tool');
    });

    it('rejects a request definition that differs from the registered server tool', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'definition_bound',
                description: 'registered',
                parameters: { type: 'object', properties: {} },
            },
            runtime: 'server',
        };
        let calls = 0;
        registerServerTool(def, () => { calls += 1; return 'nope'; }, { override: true });
        const mismatched = structuredClone(def);
        mismatched.function.description = 'client supplied';

        const result = await executeServerTool('definition_bound', '{}', undefined, {
            definition: mismatched,
        });
        expect(result.error).toContain('does not match');
        expect(calls).toBe(0);
        unregisterServerTool('definition_bound');
    });

    it('aborts timed-out handlers and does not misclassify ordinary timeout text', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: { name: 'timeout_typed', description: 'timeout', parameters: { type: 'object', properties: {} } },
            runtime: 'server',
        };
        let signal: AbortSignal | undefined;
        registerServerTool(def, (_args, context) => {
            signal = context.abortSignal;
            return new Promise(() => undefined);
        }, { override: true, timeoutMs: 5 });
        vi.useFakeTimers();
        const timed = executeServerTool(def.function.name, '{}');
        await vi.advanceTimersByTimeAsync(5);
        await expect(timed).resolves.toMatchObject({ timedOut: true });
        expect(signal?.aborted).toBe(true);
        unregisterServerTool(def.function.name);

        registerServerTool(def, () => { throw new Error('domain timeout rule'); }, { override: true });
        await expect(executeServerTool(def.function.name, '{}')).resolves.toMatchObject({
            timedOut: false,
            error: 'domain timeout rule',
        });
        unregisterServerTool(def.function.name);
    });

    it('returns a disposer scoped to the exact server registration', () => {
        const def: ToolDefinition = {
            type: 'function',
            function: { name: 'owned_server', description: 'owned', parameters: { type: 'object', properties: {} } },
            runtime: 'server',
        };
        const disposeFirst = registerServerTool(def, () => 'first', { override: true });
        const disposeSecond = registerServerTool(def, () => 'second', { override: true });
        expect(disposeFirst()).toBe(false);
        expect(getServerTool(def.function.name)).toBeDefined();
        expect(disposeSecond()).toBe(true);
        expect(disposeSecond()).toBe(false);
        expect(getServerTool(def.function.name)).toBeUndefined();
    });

    it('rejects oversized UTF-8 arguments and results', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: { name: 'bounded_server', description: 'bounded', parameters: { type: 'object', properties: {} } },
            runtime: 'server',
        };
        const handler = vi.fn(() => 'x'.repeat(1024 * 1024));
        registerServerTool(def, handler, { override: true });
        const oversizedArgs = JSON.stringify({ value: 'é'.repeat(40_000) });
        await expect(executeServerTool(def.function.name, oversizedArgs)).resolves.toMatchObject({
            error: expect.stringContaining('Tool arguments exceeds'),
        });
        expect(handler).not.toHaveBeenCalled();
        await expect(executeServerTool(def.function.name, '{}')).resolves.toMatchObject({
            error: expect.stringContaining('Tool result exceeds'),
        });
        unregisterServerTool(def.function.name);
    });
});
