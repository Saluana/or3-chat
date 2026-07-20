import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import { useToolRegistry } from '../tool-registry';

const names: string[] = [];

afterEach(() => {
    const registry = useToolRegistry();
    names.splice(0).forEach((name) => registry.unregisterTool(name));
});

describe('client tool execution context', () => {
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
