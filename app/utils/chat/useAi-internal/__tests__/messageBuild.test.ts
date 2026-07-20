import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '~/utils/chat/types';

const getMaxMessageFileHashesSpy = vi.fn();
const hashToContentPartSpy = vi.fn();
const buildOpenRouterMessagesSpy = vi.fn();
vi.mock('~/db/util', () => ({
    newId: () => 'id-1',
}));

vi.mock('~/db/threads', () => ({
    getThreadSystemPrompt: vi.fn(),
}));

vi.mock('~/db/prompts', () => ({
    getPrompt: vi.fn(),
}));

vi.mock('~/db/files-util', () => ({
    getMaxMessageFileHashes: () => getMaxMessageFileHashesSpy(),
}));

vi.mock('~/utils/chat/prompt-utils', () => ({
    promptJsonToString: (value: unknown) =>
        typeof value === 'string' ? value : JSON.stringify(value),
    composeSystemPrompt: (master: string, thread: string | null) =>
        [master, thread || ''].filter(Boolean).join('\n'),
}));

const countTokensApproxSpy = vi.fn();

vi.mock('~/utils/chat/messages', () => ({
    trimOrMessagesByTokenBudget: async (
        messages: unknown[],
        maxTokens: number,
        countTokens: (text: string) => Promise<number>
    ) => {
        for (const m of messages as Array<{ content?: unknown }>) {
            const text =
                typeof m.content === 'string'
                    ? m.content
                    : Array.isArray(m.content)
                    ? m.content
                          .filter(
                              (p: { type?: string; text?: string }) =>
                                  p.type === 'text'
                          )
                          .map((p: { text?: string }) => p.text)
                          .join('\n')
                    : '';
            await countTokens(text);
        }
        return messages.slice(-2);
    },
}));

vi.mock('~/utils/chat/tokens', () => ({
    countTokensApprox: (text: string) => countTokensApproxSpy(text),
    messageToCountableText: (m: { content?: unknown }) =>
        typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
            ? m.content
                  .filter(
                      (p: { type?: string; text?: string }) => p.type === 'text'
                  )
                  .map((p: { text?: string }) => p.text)
                  .join('\n')
            : '',
}));

vi.mock('../files', () => ({
    hashToContentPart: (...args: unknown[]) => hashToContentPartSpy(...args),
}));

vi.mock('~/core/auth/openrouter-build', () => ({
    buildOpenRouterMessages: (...args: unknown[]) =>
        buildOpenRouterMessagesSpy(...args),
}));

import { buildOpenRouterMessagesForSend } from '../messageBuild';

describe('buildOpenRouterMessagesForSend', () => {
    beforeEach(() => {
        getMaxMessageFileHashesSpy.mockReset();
        hashToContentPartSpy.mockReset();
        buildOpenRouterMessagesSpy.mockReset();
        countTokensApproxSpy.mockReset();

        getMaxMessageFileHashesSpy.mockReturnValue(8);
        buildOpenRouterMessagesSpy.mockImplementation(async (messages) =>
            messages as unknown[]
        );
    });

    it('dedupes context hashes and appends resolved parts to the last user message', async () => {
        hashToContentPartSpy.mockImplementation(async (hash: string) => {
            if (hash === 'ctx-1') return { type: 'text', text: 'from-ctx-1' };
            if (hash === 'ctx-3') return { type: 'text', text: 'from-ctx-3' };
            return null;
        });

        const effectiveMessages: ChatMessage[] = [
            { id: 'u-1', role: 'user', content: 'first' },
            { id: 'a-1', role: 'assistant', content: 'middle' },
            { id: 'u-2', role: 'user', content: 'last' },
        ];

        const result = await buildOpenRouterMessagesForSend({
            effectiveMessages,
            assistantHashes: [],
            prevAssistantId: null,
            contextHashes: ['ctx-1', 'ctx-2', 'ctx-1', 'ctx-3'],
            fileHashes: ['ctx-2'],
            maxImageInputs: 16,
            imageInclusionPolicy: 'all',
        });

        expect(hashToContentPartSpy).toHaveBeenCalledTimes(2);
        expect(hashToContentPartSpy).toHaveBeenNthCalledWith(1, 'ctx-1');
        expect(hashToContentPartSpy).toHaveBeenNthCalledWith(2, 'ctx-3');

        expect(buildOpenRouterMessagesSpy).toHaveBeenCalledTimes(1);
        const [passedMessages] = buildOpenRouterMessagesSpy.mock.calls[0] as [
            Array<{ role: string; content: unknown }>,
        ];
        expect(passedMessages).toHaveLength(3);
        expect(passedMessages[2]?.content).toEqual([
            { type: 'text', text: 'last' },
            { type: 'text', text: 'from-ctx-1' },
            { type: 'text', text: 'from-ctx-3' },
        ]);

        expect(result).toEqual(passedMessages);
    });

    it('trims messages to maxInputTokens budget while keeping system and last user', async () => {
        const effectiveMessages: ChatMessage[] = [
            { id: 's-1', role: 'system', content: 'system' },
            { id: 'u-1', role: 'user', content: 'first' },
            { id: 'a-1', role: 'assistant', content: 'middle' },
            { id: 'u-2', role: 'user', content: 'last' },
        ];

        await buildOpenRouterMessagesForSend({
            effectiveMessages,
            assistantHashes: [],
            prevAssistantId: null,
            contextHashes: [],
            fileHashes: [],
            maxInputTokens: 10,
        });

        const [passedMessages] = buildOpenRouterMessagesSpy.mock.calls[0] as [
            Array<{ role: string; content: unknown }>,
        ];
        expect(passedMessages).toHaveLength(4);
        expect(countTokensApproxSpy).toHaveBeenCalled();
    });

    it('skips context hash hydration when there is no user message target', async () => {
        const effectiveMessages: ChatMessage[] = [
            { id: 'a-1', role: 'assistant', content: 'assistant-only' },
            { id: 's-1', role: 'system', content: 'system' },
        ];

        await buildOpenRouterMessagesForSend({
            effectiveMessages,
            assistantHashes: [],
            prevAssistantId: null,
            contextHashes: ['ctx-1', 'ctx-2'],
            fileHashes: [],
        });

        expect(hashToContentPartSpy).not.toHaveBeenCalled();
        expect(buildOpenRouterMessagesSpy).toHaveBeenCalledTimes(1);
        const [passedMessages] = buildOpenRouterMessagesSpy.mock.calls[0] as [
            Array<{ role: string; content: unknown }>,
        ];
        expect(passedMessages).toHaveLength(2);
        expect(passedMessages[0]).toMatchObject({
            role: 'assistant',
            id: 'a-1',
            content: 'assistant-only',
        });
        expect(passedMessages[1]).toMatchObject({
            role: 'system',
            id: 's-1',
            content: 'system',
        });
    });

    it('preserves assistant tool calls and their associated tool result rows', async () => {
        await buildOpenRouterMessagesForSend({
            effectiveMessages: [
                { id: 'u-1', role: 'user', content: 'look it up' },
                {
                    id: 'a-1',
                    role: 'assistant',
                    content: 'calling',
                    data: {
                        tool_calls: [
                            {
                                id: 'call-1',
                                type: 'function',
                                function: { name: 'lookup', arguments: '{}' },
                            },
                        ],
                    },
                },
                {
                    id: 'tool-1',
                    role: 'tool',
                    content: 'result',
                    data: { tool_call_id: 'call-1', tool_name: 'lookup' },
                },
                { id: 'u-2', role: 'user', content: 'continue' },
            ],
            assistantHashes: [],
            contextHashes: [],
            fileHashes: [],
        });

        const [passedMessages] = buildOpenRouterMessagesSpy.mock.calls[0] as [
            Array<Record<string, unknown>>,
        ];
        expect(passedMessages[1]).toMatchObject({
            role: 'assistant',
            tool_calls: [
                expect.objectContaining({ id: 'call-1' }),
            ],
        });
        expect(passedMessages[2]).toMatchObject({
            role: 'tool',
            tool_call_id: 'call-1',
            name: 'lookup',
            content: 'result',
        });
    });
});
