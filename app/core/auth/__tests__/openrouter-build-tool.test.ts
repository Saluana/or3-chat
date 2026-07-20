import { describe, expect, it } from 'vitest';
import { buildOpenRouterMessages } from '../openrouter-build';

describe('buildOpenRouterMessages tool history', () => {
    it('preserves assistant calls and matching tool result metadata', async () => {
        const result = await buildOpenRouterMessages([
            {
                role: 'assistant',
                content: 'calling',
                tool_calls: [
                    {
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{}' },
                    },
                ],
            },
            {
                role: 'tool',
                content: 'result',
                tool_call_id: 'call-1',
                name: 'lookup',
            },
        ]);

        expect(result[0]).toMatchObject({
            role: 'assistant',
            tool_calls: [expect.objectContaining({ id: 'call-1' })],
        });
        expect(result[1]).toMatchObject({
            role: 'tool',
            tool_call_id: 'call-1',
            name: 'lookup',
            content: [{ type: 'text', text: 'result' }],
        });
    });
});
