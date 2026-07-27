import { describe, expect, it } from 'vitest';
import {
    resolveChatInputTokenBudget,
    trimOrMessagesByTokenBudget,
} from '../messages';

type Message = {
    id: string;
    role: string;
    content: string;
    tool_calls?: Array<{ id: string }>;
    tool_call_id?: string;
};

const countCharacters = async (text: string) => text.length;

describe('trimOrMessagesByTokenBudget', () => {
    it('removes complete old turns and never separates tool calls from results', async () => {
        const messages: Message[] = [
            { id: 'system', role: 'system', content: 'sys' },
            { id: 'old-user', role: 'user', content: 'old question' },
            { id: 'old-assistant', role: 'assistant', content: 'calling', tool_calls: [{ id: 'call-1' }] },
            { id: 'old-tool', role: 'tool', content: 'large result', tool_call_id: 'call-1' },
            { id: 'old-final', role: 'assistant', content: 'old answer' },
            { id: 'last-user', role: 'user', content: 'new question' },
        ];

        const trimmed = await trimOrMessagesByTokenBudget(
            messages,
            20,
            countCharacters
        );

        expect(trimmed.map((message) => message.id)).toEqual([
            'system',
            'last-user',
        ]);
        expect(
            trimmed.some((message) => message.id === 'old-assistant')
        ).toBe(
            trimmed.some((message) => message.id === 'old-tool')
        );
    });

    it('allows only protected system and final-user input to exceed the budget', async () => {
        const trimmed = await trimOrMessagesByTokenBudget(
            [
                { id: 'system', role: 'system', content: '123456' },
                { id: 'old', role: 'assistant', content: 'remove me' },
                { id: 'last-user', role: 'user', content: 'abcdef' },
            ],
            2,
            countCharacters
        );

        expect(trimmed.map((message) => message.id)).toEqual([
            'system',
            'last-user',
        ]);
    });

    it('counts tool-call arguments when deciding which old turn to remove', async () => {
        const trimmed = await trimOrMessagesByTokenBudget(
            [
                { id: 'system', role: 'system', content: 's' },
                { id: 'old-user', role: 'user', content: 'old' },
                {
                    id: 'old-assistant',
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                        {
                            id: 'call-1',
                            function: {
                                name: 'lookup',
                                arguments: 'x'.repeat(50),
                            },
                        },
                    ],
                },
                {
                    id: 'old-tool',
                    role: 'tool',
                    content: 'result',
                    tool_call_id: 'call-1',
                },
                { id: 'last-user', role: 'user', content: 'new' },
            ],
            20,
            countCharacters
        );

        expect(trimmed.map((message) => message.id)).toEqual([
            'system',
            'last-user',
        ]);
    });
});

describe('resolveChatInputTokenBudget', () => {
    it('uses a conservative fallback when model metadata is unavailable', () => {
        expect(resolveChatInputTokenBudget(undefined)).toBe(8000);
    });

    it('reserves output space and prefers top-provider context metadata', () => {
        expect(
            resolveChatInputTokenBudget({
                context_length: 16_000,
                top_provider: {
                    context_length: 32_000,
                    max_completion_tokens: 4_000,
                },
            })
        ).toBe(28_000);
    });

    it('caps very large model windows to a browser-safe input budget', () => {
        expect(
            resolveChatInputTokenBudget({ context_length: 1_000_000 })
        ).toBe(128_000);
    });

    it('never returns a budget larger than a tiny advertised context', () => {
        expect(
            resolveChatInputTokenBudget({ context_length: 512 })
        ).toBe(511);
    });
});
