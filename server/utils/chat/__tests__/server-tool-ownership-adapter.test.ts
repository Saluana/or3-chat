import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    executeServerTool,
    getServerTool,
    listServerTools,
    registerServerTool,
    unregisterServerTool,
    validateServerToolRequest,
} from '../tool-registry';
import { inspectServerToolOwnership } from '../tool-ownership';
import { createServerContributionSurfaceSelection } from '../../plugins/contribution-surface-selection';
import {
    requireCompatibilityProfile,
    type CompatibilityProfileDocument,
} from '../../../../tests/plugin-runtime/differential-surface-harness';
import type { ToolDefinition } from '~/utils/chat/types';

const profiles = JSON.parse(
    readFileSync(
        resolve(
            process.cwd(),
            'planning/plugin-runtime-v2/compatibility-profiles.json'
        ),
        'utf8'
    )
) as CompatibilityProfileDocument;

function select(enabled: boolean) {
    (
        globalThis as {
            __or3ServerContributionSurfaceSelection?: unknown;
        }
    ).__or3ServerContributionSurfaceSelection =
        createServerContributionSurfaceSelection(
            enabled ? ['server-tools'] : []
        );
}

function definition(name: string): ToolDefinition {
    return {
        type: 'function',
        function: {
            name,
            description: `${name} description`,
            parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
            },
        },
        runtime: 'server',
    };
}

async function capture(enabled: boolean) {
    select(enabled);
    for (const tool of listServerTools()) {
        unregisterServerTool(tool.definition.function.name);
    }
    const def = definition('adapter_server_tool');
    const stale = registerServerTool(def, ({ value }) => `old:${value}`);
    let duplicateMessage = '';
    try {
        registerServerTool(def, () => 'duplicate');
    } catch (error) {
        duplicateMessage = (error as Error).message;
    }
    const current = registerServerTool(
        def,
        ({ value }, context) => `${context.requestId}:${value}`,
        { override: true, runtime: 'hybrid', timeoutMs: 1234 }
    );
    const registered = getServerTool(def.function.name)!;
    if (enabled) {
        const ownership = inspectServerToolOwnership().filter(
            (record) => record.id === def.function.name
        );
        expect(ownership).toHaveLength(1);
        expect(ownership[0]?.owner).toBe(registered.owner);
        expect(ownership[0]?.value).toBe(registered);
    }
    const staleDispose = stale();
    const validation = validateServerToolRequest(
        [registered.definition],
        {},
        true
    );
    const clientHint = validateServerToolRequest(
        [definition('client-hinted-missing')],
        { 'client-hinted-missing': 'client' },
        true
    );
    const execution = await executeServerTool(
        def.function.name,
        JSON.stringify({ value: 'ok' }),
        {
            subject: 'user-1',
            workspaceId: 'workspace-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            callId: 'call-1',
            requestId: 'request-1',
            abortSignal: new AbortController().signal,
        }
    );
    const observation = {
        duplicateMessage,
        storedIdentity: listServerTools()[0] === registered,
        definitionCopied: registered.definition !== def,
        runtime: registered.runtime,
        definitionRuntime: registered.definition.runtime,
        timeoutMs: registered.timeoutMs,
        staleDispose,
        validation,
        clientHint,
        execution,
        currentDispose: current(),
        repeatedDispose: current(),
    };
    if (enabled) {
        expect(
            inspectServerToolOwnership().filter(
                (record) => record.id === def.function.name
            )
        ).toEqual([]);
    }
    return observation;
}

describe('server tool ownership adapter', () => {
    it('keeps owners internal without changing registration, validation, or execution', async () => {
        requireCompatibilityProfile(profiles, 'registry.server-tools');

        const expected = await capture(false);
        const actual = await capture(true);

        expect(actual).toEqual(expected);
        expect(actual).toEqual({
            duplicateMessage:
                'Tool "adapter_server_tool" is already registered.',
            storedIdentity: true,
            definitionCopied: true,
            runtime: 'hybrid',
            definitionRuntime: 'hybrid',
            timeoutMs: 1234,
            staleDispose: false,
            validation: { valid: true },
            clientHint: { valid: true },
            execution: {
                result: 'request-1:ok',
                toolName: 'adapter_server_tool',
                timedOut: false,
                runtime: 'hybrid',
            },
            currentDispose: true,
            repeatedDispose: false,
        });
        select(false);
    });
});
