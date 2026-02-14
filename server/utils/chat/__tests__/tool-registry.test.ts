import { describe, it, expect } from 'vitest';
import {
    registerServerTool,
    unregisterServerTool,
    executeServerTool,
} from '../tool-registry';
import type { ToolDefinition } from '~/utils/chat/types';

describe('server tool registry', () => {
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
});
