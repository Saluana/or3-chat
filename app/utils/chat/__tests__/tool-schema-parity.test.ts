import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToolRegistry } from '../tool-registry';
import type { ToolDefinition } from '../types';
import {
    executeServerTool,
    registerServerTool,
    unregisterServerTool,
} from '../../../../server/utils/chat/tool-registry';

const names = new Set<string>();

function definition(name: string): ToolDefinition {
    return {
        type: 'function',
        function: {
            name,
            description: 'Validate structured input',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    mode: { type: 'string', enum: ['fast', 'safe'] },
                    count: { type: 'integer', minimum: 1, maximum: 3 },
                    nested: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { label: { type: 'string', minLength: 2 } },
                        required: ['label'],
                    },
                },
                required: ['mode', 'count', 'nested'],
            },
        },
        runtime: 'hybrid',
    };
}

afterEach(() => {
    const client = useToolRegistry();
    for (const name of names) {
        client.unregisterTool(name);
        unregisterServerTool(name);
    }
    names.clear();
});

describe('shared tool JSON Schema validation', () => {
    it.each([
        ['wrong type', { mode: 'fast', count: '2', nested: { label: 'ok' } }],
        ['enum', { mode: 'turbo', count: 2, nested: { label: 'ok' } }],
        ['lower bound', { mode: 'fast', count: 0, nested: { label: 'ok' } }],
        ['upper bound', { mode: 'fast', count: 4, nested: { label: 'ok' } }],
        ['nested required', { mode: 'fast', count: 2, nested: {} }],
        ['additional property', { mode: 'fast', count: 2, nested: { label: 'ok' }, extra: true }],
    ])('identically rejects %s on client and server', async (_case, args) => {
        const name = `schema_parity_${names.size}`;
        names.add(name);
        const def = definition(name);
        const clientHandler = vi.fn(() => 'client');
        const serverHandler = vi.fn(() => 'server');
        useToolRegistry().registerTool(def, clientHandler, { override: true });
        registerServerTool(def, serverHandler, { override: true });

        const serialized = JSON.stringify(args);
        const [client, server] = await Promise.all([
            useToolRegistry().executeTool(name, serialized),
            executeServerTool(name, serialized),
        ]);

        expect(client.error).toBe(server.error);
        expect(client.error).toContain('Invalid tool arguments');
        expect(clientHandler).not.toHaveBeenCalled();
        expect(serverHandler).not.toHaveBeenCalled();
    });

    it('accepts the same nested value on client and server', async () => {
        const name = 'schema_parity_valid';
        names.add(name);
        const def = definition(name);
        useToolRegistry().registerTool(def, () => 'client', { override: true });
        registerServerTool(def, () => 'server', { override: true });
        const args = JSON.stringify({ mode: 'safe', count: 2, nested: { label: 'ok' } });

        await expect(useToolRegistry().executeTool(name, args)).resolves.toMatchObject({ result: 'client' });
        await expect(executeServerTool(name, args)).resolves.toMatchObject({ result: 'server' });
    });

    it.each([
        { value: { type: 'definitely-not-a-json-schema-type' } },
        { value: { type: 'string', minLength: -1 } },
        { value: { type: 'string', pattern: '[' } },
        { value: { type: 'string', misspelledKeyword: true } },
        { value: { $ref: '#/definitions/missing' } },
    ])('rejects malformed parameter schemas in both registries: %j', (properties) => {
        const clientDef = definition('malformed_client');
        clientDef.function.parameters.properties = properties;
        const serverDef = structuredClone(clientDef);
        serverDef.function.name = 'malformed_server';

        expect(() => useToolRegistry().registerTool(clientDef, () => 'nope'))
            .toThrow(/Invalid JSON Schema/);
        expect(() => registerServerTool(serverDef, () => 'nope'))
            .toThrow(/Invalid JSON Schema/);
    });

    it('preserves references, alternatives, arrays and format annotations in both runtimes', async () => {
        const name = 'schema_parity_draft7';
        names.add(name);
        const def = definition(name);
        def.function.parameters = {
            type: 'object', additionalProperties: false, required: ['values', 'literal'],
            definitions: { value: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'string', pattern: '^ok$' }] } },
            properties: {
                values: { type: 'array', minItems: 1, uniqueItems: true, items: { $ref: '#/definitions/value' } },
                literal: { enum: [{ format: 'literal', type: 'literal' }] },
                note: { type: 'string', format: 'email' },
            },
        };
        useToolRegistry().registerTool(def, () => 'client', { override: true });
        registerServerTool(def, () => 'server', { override: true });
        const args = JSON.stringify({ values: [1, 'ok'], literal: { format: 'literal', type: 'literal' }, note: 'annotation only' });
        await expect(useToolRegistry().executeTool(name, args)).resolves.toMatchObject({ result: 'client' });
        await expect(executeServerTool(name, args)).resolves.toMatchObject({ result: 'server' });
        for (const values of [[], [1, 1], [0], ['bad']]) {
            const json = JSON.stringify({ values, literal: { format: 'literal', type: 'literal' } });
            const client = await useToolRegistry().executeTool(name, json);
            const server = await executeServerTool(name, json);
            expect(client.error).toContain('Invalid tool arguments');
            expect(client.error).toBe(server.error);
        }
    });
});
