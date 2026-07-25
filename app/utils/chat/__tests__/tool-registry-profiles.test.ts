import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRef, nextTick } from 'vue';
import {
    getServerTool,
    listServerTools,
    registerServerTool,
    unregisterServerTool,
    validateServerToolRequest,
} from '../../../../server/utils/chat/tool-registry';
import type { ToolDefinition } from '../types';
import { useToolRegistry } from '../tool-registry';

function definition(name: string, runtime?: ToolDefinition['runtime']): ToolDefinition {
    return {
        type: 'function',
        function: {
            name,
            description: `${name} description`,
            parameters: { type: 'object', properties: {} },
        },
        ...(runtime ? { runtime } : {}),
    };
}

describe('V1 client tool registry profile', () => {
    const registry = useToolRegistry();

    beforeEach(() => {
        for (const tool of registry.listTools.value) registry.unregisterTool(tool.definition.function.name);
        localStorage.clear();
    });

    afterEach(() => {
        for (const tool of registry.listTools.value) registry.unregisterTool(tool.definition.function.name);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('rejects duplicates, overrides by identity, exposes refs, and normalizes runtime hints', () => {
        const def = definition('profile_client_tool', 'client');
        const first = registry.registerTool(def, () => 'first', {
            workflowPolicy: {
                sideEffect: 'reversible',
                approval: 'always',
                parallelSafe: false,
                permissions: ['workspace.write'],
            },
        });
        expect(registry.getTool(def.function.name)).toBe(first);
        expect(registry.listTools.value[0]).toBe(first);
        expect(isRef(first.enabled)).toBe(true);
        expect(isRef(first.lastError)).toBe(true);
        expect(first.runtime).toBe('client');
        expect(first.definition).not.toBe(def);
        expect(first.definition.runtime).toBe('client');
        expect(first.workflowPolicy).toEqual({
            sideEffect: 'reversible',
            approval: 'always',
            parallelSafe: false,
            permissions: ['workspace.write'],
        });
        expect(() => registry.registerTool(def, () => 'duplicate')).toThrow(
            'Tool "profile_client_tool" is already registered. Use override: true to replace it.'
        );

        const second = registry.registerTool(def, () => 'second', { override: true, runtime: 'server' });
        expect(second).not.toBe(first);
        expect(second.runtime).toBe('server');
        expect(second.definition.runtime).toBe('server');
        expect(first.dispose()).toBe(false);
        expect(second.dispose()).toBe(true);
    });

    it('stops the replaced registration watcher before publishing its replacement', () => {
        const def = definition('profile_watcher_tool');
        const first = registry.registerTool(def, () => 'first');
        const stop = vi.fn(first._stopWatcher);
        first._stopWatcher = stop;
        const second = registry.registerTool(def, () => 'second', { override: true });
        expect(stop).toHaveBeenCalledTimes(1);
        expect(registry.getTool(def.function.name)).toBe(second);
        second.dispose();
    });

    it('round-trips enabled preference through or3.tools.enabled with frozen precedence', async () => {
        vi.useFakeTimers();
        const name = 'profile_preference_tool';
        localStorage.setItem('or3.tools.enabled', JSON.stringify({ [name]: false }));
        const registered = registry.registerTool(
            { ...definition(name), defaultEnabled: true },
            () => 'ok'
        );
        expect(registered.enabled.value).toBe(false);

        registry.setEnabled(name, true);
        await nextTick();
        await vi.advanceTimersByTimeAsync(300);
        expect(JSON.parse(localStorage.getItem('or3.tools.enabled') ?? '{}')).toMatchObject({ [name]: true });
        registered.dispose();
    });

    it('lets explicit enabled state override storage and definition defaults', () => {
        const name = 'profile_enabled_precedence';
        localStorage.setItem('or3.tools.enabled', JSON.stringify({ [name]: false }));
        const registered = registry.registerTool(
            { ...definition(name), defaultEnabled: false },
            () => 'ok',
            { enabled: true }
        );
        expect(registered.enabled.value).toBe(true);
    });
});

describe('V1 server tool registry profile', () => {
    beforeEach(() => {
        for (const tool of listServerTools()) unregisterServerTool(tool.definition.function.name);
    });

    afterEach(() => {
        for (const tool of listServerTools()) unregisterServerTool(tool.definition.function.name);
    });

    it('rejects duplicates, applies runtime precedence, and returns an exact-owner disposer', () => {
        const def = definition('profile_server_tool', 'server');
        const stale = registerServerTool(def, () => 'first');
        expect(() => registerServerTool(def, () => 'duplicate')).toThrow(
            'Tool "profile_server_tool" is already registered.'
        );
        const current = registerServerTool(def, () => 'second', {
            override: true,
            runtime: 'hybrid',
            timeoutMs: 1234,
            workflowPolicy: {
                sideEffect: 'destructive',
                approval: 'always',
                parallelSafe: false,
            },
        });
        expect(getServerTool(def.function.name)).toMatchObject({
            runtime: 'hybrid',
            timeoutMs: 1234,
            workflowPolicy: {
                sideEffect: 'destructive',
                approval: 'always',
                parallelSafe: false,
            },
        });
        expect(stale()).toBe(false);
        expect(current()).toBe(true);
        expect(current()).toBe(false);
    });

    it('uses client runtime hints to skip server binding but otherwise requires definition parity', () => {
        const def = definition('profile_runtime_hint', 'hybrid');
        expect(validateServerToolRequest([def], { [def.function.name]: 'client' }, true)).toEqual({ valid: true });
        expect(validateServerToolRequest([def], {}, true)).toMatchObject({
            valid: false,
            error: 'Server tool "profile_runtime_hint" is not registered.',
        });
        registerServerTool(def, () => 'ok');
        expect(validateServerToolRequest([def], {}, true)).toEqual({ valid: true });
        const changed = structuredClone(def);
        changed.function.description = 'changed';
        expect(validateServerToolRequest([changed], {}, true)).toMatchObject({
            valid: false,
            error: expect.stringContaining('does not match'),
        });
    });
});
