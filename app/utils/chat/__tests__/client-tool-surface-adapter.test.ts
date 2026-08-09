import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isRef, nextTick } from 'vue';
import { createContributionSurfaceSelection } from '../../../composables/plugins/contribution-surface-selection';
import { getContributionSurfaceKernel } from '../../../composables/plugins/contribution-surface-kernel';
import {
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
} from '../../../../tests/plugin-runtime/differential-surface-harness';
import {
    useToolRegistry,
    type RegisteredTool,
} from '../tool-registry';
import type { ToolDefinition } from '../types';

const profiles = JSON.parse(
    readFileSync(
        resolve(
            process.cwd(),
            'planning/complete/plugin-runtime-v2/compatibility-profiles.json'
        ),
        'utf8'
    )
) as CompatibilityProfileDocument;

function select(enabled: boolean) {
    (
        globalThis as { __or3ContributionSurfaceSelection?: unknown }
    ).__or3ContributionSurfaceSelection = createContributionSurfaceSelection(
        enabled ? ['client-tools'] : []
    );
}

function definition(name: string): ToolDefinition {
    return {
        type: 'function',
        function: {
            name,
            description: `${name} description`,
            parameters: { type: 'object', properties: {} },
        },
        runtime: 'client',
    };
}

async function capture(enabled: boolean) {
    select(enabled);
    const registry = useToolRegistry();
    for (const tool of registry.listTools.value) {
        registry.unregisterTool(tool.definition.function.name);
    }
    localStorage.clear();
    const name = 'adapter_client_tool';
    localStorage.setItem('or3.tools.enabled', JSON.stringify({ [name]: false }));
    const def = definition(name);
    const first = registry.registerTool(def, () => 'first');
    const stopFirstWatcher = vi.fn(first._stopWatcher);
    first._stopWatcher = stopFirstWatcher;

    let duplicateMessage = '';
    try {
        registry.registerTool(def, () => 'duplicate');
    } catch (error) {
        duplicateMessage = (error as Error).message;
    }
    const second = registry.registerTool(def, () => 'second', {
        override: true,
        runtime: 'server',
    });
    const staleDispose = first.dispose();
    registry.setEnabled(name, true);
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    const execution = await registry.executeTool(name, '{}');
    const kernel = getContributionSurfaceKernel<RegisteredTool>(
        'client-tools',
        { getId: (tool) => tool.definition.function.name }
    );
    const ownerRecord = enabled
        ? kernel.registry.inspect().find((record) => record.id === name)
        : undefined;
    if (enabled) {
        expect(ownerRecord?.owner).toBe(second._owner);
        expect(ownerRecord?.value).toBe(second);
    }

    const observation = {
        firstIdentity: registry.getTool(name) !== first,
        secondGetIdentity: registry.getTool(name) === second,
        secondListIdentity: registry.listTools.value[0] === second,
        enabledRef: isRef(second.enabled),
        lastErrorRef: isRef(second.lastError),
        definitionCopied: second.definition !== def,
        runtime: second.runtime,
        definitionRuntime: second.definition.runtime,
        initialEnabled: first.enabled.value,
        persistedEnabled: JSON.parse(
            localStorage.getItem('or3.tools.enabled') ?? '{}'
        )[name],
        duplicateMessage,
        stoppedOldWatcher: stopFirstWatcher.mock.calls.length,
        staleDispose,
        execution,
        currentDispose: second.dispose(),
        repeatedDispose: second.dispose(),
    };
    if (enabled) {
        expect(
            kernel.registry.inspect().filter((record) => record.id === name)
        ).toEqual([]);
    }
    vi.clearAllTimers();
    return observation;
}

describe('client tool contribution adapter', () => {
    it('preserves tool identity, watchers, persistence, execution, and exact disposal', async () => {
        requireCompatibilityProfile(profiles, 'registry.client-tools');
        vi.useFakeTimers();

        const expected = await capture(false);
        const actual = await capture(true);

        expect(actual).toEqual(expected);
        expect(actual).toMatchObject({
            firstIdentity: true,
            secondGetIdentity: true,
            secondListIdentity: true,
            enabledRef: true,
            lastErrorRef: true,
            definitionCopied: true,
            runtime: 'server',
            definitionRuntime: 'server',
            initialEnabled: false,
            persistedEnabled: true,
            duplicateMessage:
                'Tool "adapter_client_tool" is already registered. Use override: true to replace it.',
            stoppedOldWatcher: 1,
            staleDispose: false,
            execution: {
                result: 'second',
                toolName: 'adapter_client_tool',
                timedOut: false,
            },
            currentDispose: true,
            repeatedDispose: false,
        });

        select(false);
        vi.useRealTimers();
    });

    it('leaves zero tool records and enabled-state watchers after 1,000 cycles', () => {
        select(true);
        vi.useFakeTimers();
        const registry = useToolRegistry();
        for (const tool of registry.listTools.value) {
            registry.unregisterTool(tool.definition.function.name);
        }
        const kernel = getContributionSurfaceKernel<RegisteredTool>(
            'client-tools',
            { getId: (tool) => tool.definition.function.name }
        );
        let stoppedWatchers = 0;

        for (let index = 0; index < 1_000; index++) {
            const name = `adapter_leak_${index}`;
            const tool = registry.registerTool(
                definition(name),
                () => 'ok'
            );
            const stop = tool._stopWatcher;
            tool._stopWatcher = () => {
                stoppedWatchers += 1;
                stop();
            };
            expect(tool.dispose()).toBe(true);
        }

        expect(stoppedWatchers).toBe(1_000);
        expect(registry.listTools.value).toEqual([]);
        expect(kernel.registry.inspect()).toEqual([]);
        vi.clearAllTimers();
        vi.useRealTimers();
        select(false);
    });
});
