import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '~/utils/chat/types';
import { reactive } from 'vue';
import { admitChatContext, DEFAULT_REPLY_ALLOWANCE_TOKENS, estimateChatRequest, type CountableChatMessage } from '~~/shared/chat/context-budget';

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

vi.mock('~/utils/chat/messages', async (importOriginal) => ({
    ...await importOriginal<typeof import('~/utils/chat/messages')>(),
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
import { shouldKeepAssistantMessage } from '~/utils/chat/messages';

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

    // Preparation risks: caller-owned arrays mutated by context injection;
    // edits crossing hydration awaits; shared tool-call records; binary views
    // losing offsets; and full histories being shortened to guessed budgets.
    describe('production payload ownership and capacity controls', () => {
        let countText: typeof import('~/utils/chat/tokens').countTokensApprox;
        beforeEach(async () => {
            const production = await vi.importActual<typeof import('~/core/auth/openrouter-build')>('~/core/auth/openrouter-build');
            countText = (await vi.importActual<typeof import('~/utils/chat/tokens')>('~/utils/chat/tokens')).countTokensApprox;
            buildOpenRouterMessagesSpy.mockImplementation(production.buildOpenRouterMessages);
        });

        it('does not append hydrated context into caller-owned content parts', async () => {
            const effectiveMessages = reactive<ChatMessage[]>([
                { role: 'user', content: [{ type: 'text', text: 'original' }] },
            ]);
            const original = JSON.parse(JSON.stringify(effectiveMessages));
            hashToContentPartSpy.mockResolvedValue({ type: 'text', text: 'hydrated context' });
            const result = await buildOpenRouterMessagesForSend({
                effectiveMessages, assistantHashes: [], contextHashes: ['context'],
            });
            expect(result[0]?.content).toEqual([
                { type: 'text', text: 'original' },
                { type: 'text', text: 'hydrated context' },
            ]);
            expect(effectiveMessages).toEqual(original);
        });

        it('captures nested content and canonical tool calls before awaiting hydration', async () => {
            let resolveContext!: (part: { type: 'text'; text: string }) => void;
            hashToContentPartSpy.mockImplementation(() => new Promise((resolve) => { resolveContext = resolve; }));
            const effectiveMessages = reactive<ChatMessage[]>([
                { role: 'assistant', content: 'calling', data: { tool_calls: [
                    { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{"q":"captured"}' } },
                ] } },
                { role: 'tool', name: 'lookup', tool_call_id: 'call', content: 'retained result' },
                { role: 'user', content: [{ type: 'text', text: 'captured user' }] },
            ]);
            const running = buildOpenRouterMessagesForSend({ effectiveMessages, assistantHashes: [], contextHashes: ['context'] });
            expect(hashToContentPartSpy).toHaveBeenCalledOnce();
            const user = effectiveMessages[2]!;
            if (!Array.isArray(user.content) || user.content[0]?.type !== 'text') throw new Error('Invalid fixture');
            user.content[0].text = 'later user';
            const calls = effectiveMessages[0]!.data!.tool_calls as ChatMessage['tool_calls'];
            calls![0]!.function.arguments = '{"q":"later"}';
            calls!.push({ id: 'later-call', type: 'function', function: { name: 'lookup', arguments: '{}' } });
            resolveContext({ type: 'text', text: 'resolved' });
            const result = await running;
            expect(result[0]?.tool_calls).toEqual([
                { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{"q":"captured"}' } },
            ]);
            expect(result[1]).toMatchObject({ role: 'tool', tool_call_id: 'call', content: [{ type: 'text', text: 'retained result' }] });
            expect(result[2]?.content).toEqual([{ type: 'text', text: 'captured user' }, { type: 'text', text: 'resolved' }]);
            expect(user.content).toEqual([{ type: 'text', text: 'later user' }]);
            const returnedCalls = result[0]!.tool_calls as NonNullable<ChatMessage['tool_calls']>;
            returnedCalls[0]!.function.arguments = 'changed returned payload';
            expect(calls![0]!.function.arguments).toBe('{"q":"later"}');
        });

        it('captures the selected binary view bytes before delayed hydration', async () => {
            let resolveContext!: (part: { type: 'text'; text: string }) => void;
            hashToContentPartSpy.mockImplementation(() => new Promise((resolve) => { resolveContext = resolve; }));
            const bytes = new Uint8Array([99, 7, 8, 88]);
            const effectiveMessages: ChatMessage[] = [{ role: 'user', content: [
                { type: 'file', data: bytes.subarray(1, 3), mediaType: 'application/octet-stream', name: 'view.bin' },
            ] }];
            const running = buildOpenRouterMessagesForSend({ effectiveMessages, assistantHashes: [], contextHashes: ['context'] });
            bytes[1] = 77;
            resolveContext({ type: 'text', text: 'context' });
            const result = await running;
            expect(result[0]?.content).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'file', file: expect.objectContaining({ file_data: 'data:application/octet-stream;base64,Bwg=' }) }),
            ]));
            expect(effectiveMessages[0]!.content).toHaveLength(1);
        });

        it('captures media policy before the context await', async () => {
            let resolveContext!: (part: { type: 'text'; text: string }) => void;
            hashToContentPartSpy.mockImplementation(() => new Promise((resolve) => { resolveContext = resolve; }));
            const image = 'data:image/png;base64,iVBORw0KGgo=';
            const params = {
                effectiveMessages: [{ role: 'user', content: [{ type: 'image', image }] }] as ChatMessage[],
                assistantHashes: [], contextHashes: ['context'], maxImageInputs: 1,
            };
            const running = buildOpenRouterMessagesForSend(params);
            params.maxImageInputs = 0;
            resolveContext({ type: 'text', text: 'context' });
            const result = await running;
            expect(result[0]?.content).toEqual(expect.arrayContaining([
                { type: 'image_url', image_url: { url: image } },
            ]));
        });

        // Positive controls, not a claim that the already-removed 128k clamp
        // currently fails. No mocked trimming/counter participates in them.
        it.each([225_000, 999_800, 1_000_010])('retains the full %s-token text candidate for production policy admission', async (textTokens) => {
            const toolCalls = [{ id: 'call', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } }];
            const effectiveMessages: ChatMessage[] = [
                { role: 'system', content: 'system sentinel' },
                { role: 'assistant', content: 'calling sentinel', tool_calls: toolCalls },
                { role: 'tool', tool_call_id: 'call', name: 'lookup', content: 'result sentinel' },
                { role: 'user', content: `start sentinel ${'x'.repeat(textTokens * 4)} end sentinel` },
            ];
            const result = await buildOpenRouterMessagesForSend({ effectiveMessages, assistantHashes: [] });
            expect(result).toHaveLength(4);
            expect(result[0]?.content).toEqual([{ type: 'text', text: 'system sentinel' }]);
            expect(result[2]).toMatchObject({ tool_call_id: 'call', content: [{ type: 'text', text: 'result sentinel' }] });
            expect(result[3]?.content).toEqual([{ type: 'text', text: effectiveMessages[3]!.content }]);
            const tools = [{ type: 'function', function: { name: 'lookup', description: 'Look up data', parameters: { type: 'object' } } }];
            // Count the serialized provider candidate, as the real transport
            // does; the builder's public tool-row union is intentionally wider.
            const candidate = JSON.parse(JSON.stringify(result)) as CountableChatMessage[];
            const estimate = await estimateChatRequest({ messages: candidate, tools, countText });
            const admission = admitChatContext({ model: { context_length: 1_000_000 }, inputTokens: estimate.input_tokens, estimate });
            if (textTokens < 1_000_000) {
                expect(admission.ok).toBe(true);
                if (!admission.ok) throw new Error('Unexpected rejection');
                expect(admission.budget.effective_context_tokens).toBe(1_000_000);
                expect(admission.budget.available_completion_tokens).toBe(Math.min(1_000_000 - estimate.input_tokens, DEFAULT_REPLY_ALLOWANCE_TOKENS));
                expect(admission.budget.available_completion_tokens).toBeGreaterThan(0);
                const explicit = admitChatContext({ model: { context_length: 1_000_000 }, inputTokens: estimate.input_tokens, requestedCompletionTokens: 1, estimate });
                expect(explicit).toMatchObject({ ok: true, budget: { requested_completion_tokens: 1 } });
            } else expect(admission).toMatchObject({ ok: false, code: 'context_full' });
            expect(effectiveMessages[3]!.content).toBe(`start sentinel ${'x'.repeat(textTokens * 4)} end sentinel`);
        });
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

    it('does not carry forward an image already attached by the user, but keeps PDFs and assistant images', async () => {
        const pdf = { type: 'file', data: 'data:application/pdf;base64,cGRm', mediaType: 'application/pdf', name: 'a.pdf' };
        const generated = { type: 'image', image: 'data:image/png;base64,BBBB', mediaType: 'image/png' };
        hashToContentPartSpy.mockImplementation(async (hash: string) => hash === 'img-1'
            ? { type: 'image', image: 'data:image/png;base64,AAAA', mediaType: 'image/png' } : hash === 'pdf-1' ? pdf : hash === 'img-2' ? generated : null);
        await buildOpenRouterMessagesForSend({
            effectiveMessages: [
                { id: 'u-1', role: 'user', content: 'first', file_hashes: JSON.stringify(['img-1', 'pdf-1']) },
                { id: 'a-1', role: 'assistant', content: 'middle', file_hashes: JSON.stringify(['img-2']) },
                { id: 'u-2', role: 'user', content: 'last' },
            ],
            assistantHashes: [], contextHashes: ['img-1', 'pdf-1', 'img-2'],
        });
        const [passedMessages] = buildOpenRouterMessagesSpy.mock.calls[0] as [Array<{ content: unknown }>];
        expect(passedMessages[2]?.content).toEqual([{ type: 'text', text: 'last' }, pdf, generated]);
    });

    it('carries no images and tells the builder when the model has no image input', async () => {
        hashToContentPartSpy.mockResolvedValue({ type: 'image', image: 'data:image/png;base64,AAAA', mediaType: 'image/png' });
        await buildOpenRouterMessagesForSend({
            effectiveMessages: [{ id: 'u-1', role: 'user', content: 'last' }],
            assistantHashes: [], contextHashes: ['img-9'], acceptsImageInput: false,
        });
        const [passedMessages, options] = buildOpenRouterMessagesSpy.mock.calls[0] as [Array<{ content: unknown }>, Record<string, unknown>];
        expect(passedMessages[0]?.content).toBe('last');
        expect(options).toMatchObject({ acceptsImageInput: false });
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

    // A tool-calling row stores all of its text, including the answer written
    // after the results. Replaying it as one message put that answer before
    // the evidence it was based on.
    describe('replayed tool turns', () => {
        const call = (id: string) => ({ id, type: 'function' as const, function: { name: 'lookup', arguments: '{}' } });
        const stored = (id: string, text_offset?: number) => ({ id, name: 'lookup', args: '{}', status: 'complete',
            ...(text_offset === undefined ? {} : { text_offset }) });
        const result = (id: string) => ({ id: `r-${id}`, role: 'tool' as const, content: `result ${id}`, tool_call_id: id, name: 'lookup' });
        const sent = async (effectiveMessages: ChatMessage[]) => {
            await buildOpenRouterMessagesForSend({ effectiveMessages, assistantHashes: [], contextHashes: [], fileHashes: [] });
            return (buildOpenRouterMessagesSpy.mock.calls[0] as [Array<Record<string, unknown>>])[0]
                .map(({ role, content, tool_calls, tool_call_id }) => ({ role, content,
                    calls: (tool_calls as Array<{ id: string }> | undefined)?.map((entry) => entry.id), tool_call_id }));
        };

        it('sends text written after the results after them, iteration by iteration', async () => {
            expect(await sent([
                { id: 'u', role: 'user', content: 'Find both' },
                { id: 'a', role: 'assistant', content: 'Searching.Found one, checking more.Both found.', tool_calls: [call('c1'), call('c2')],
                    file_hashes: '["gen-image"]', data: { tool_calls: [stored('c1', 10), stored('c2', 35)] } },
                result('c1'), result('c2'),
                { id: 'u2', role: 'user', content: 'Thanks' },
            ])).toEqual([
                { role: 'user', content: 'Find both' },
                { role: 'assistant', content: 'Searching.', calls: ['c1'] },
                { role: 'tool', content: 'result c1', tool_call_id: 'c1' },
                { role: 'assistant', content: 'Found one, checking more.', calls: ['c2'] },
                { role: 'tool', content: 'result c2', tool_call_id: 'c2' },
                { role: 'assistant', content: 'Both found.' },
                { role: 'user', content: 'Thanks' },
            ]);
            const passed = (buildOpenRouterMessagesSpy.mock.calls[0] as [Array<Record<string, unknown>>])[0];
            expect(passed.filter((message) => message.file_hashes).map((message) => message.content)).toEqual(['Both found.']);
        });

        it('keeps a row without saved offsets, or with an offset its edited text no longer has, as one message', async () => {
            for (const offsets of [[undefined], [999]]) {
                buildOpenRouterMessagesSpy.mockClear();
                expect(await sent([
                    { id: 'a', role: 'assistant', content: 'Answer', tool_calls: [call('c1')], data: { tool_calls: [stored('c1', offsets[0])] } },
                    result('c1'),
                ])).toEqual([
                    { role: 'assistant', content: 'Answer', calls: ['c1'] },
                    { role: 'tool', content: 'result c1', tool_call_id: 'c1' },
                ]);
            }
        });
    });

    // Card-only replies must retain the calling assistant during input cleanup;
    // otherwise the next request contains an orphan result and providers reject it.
    it.each(['calling', '', []])('preserves paired tool turns through input cleanup with content %j', async (content) => {
        await buildOpenRouterMessagesForSend({
            effectiveMessages: ([
                { id: 'u-1', role: 'user', content: 'look it up' },
                {
                    id: 'a-1',
                    role: 'assistant',
                    content,
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
                { id: 'empty-placeholder', role: 'assistant', content: '' },
                { id: 'u-2', role: 'user', content: 'continue' },
            ] satisfies ChatMessage[]).filter(shouldKeepAssistantMessage),
            assistantHashes: [],
            contextHashes: [],
            fileHashes: [],
        });

        const [passedMessages] = buildOpenRouterMessagesSpy.mock.calls[0] as [
            Array<Record<string, unknown>>,
        ];
        expect(passedMessages).toHaveLength(4);
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
