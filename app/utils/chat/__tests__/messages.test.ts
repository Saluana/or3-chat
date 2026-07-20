import { describe, expect, it } from 'vitest';
import { trimOrMessagesByTokenBudget } from '../messages';

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
});
