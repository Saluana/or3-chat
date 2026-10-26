import { describe, expect, it } from 'vitest';
import { parseOpenRouterSSE } from '../parseOpenRouterSSE';
import { MAX_TOOL_ARGUMENT_BYTES, utf8Bytes } from '../../chat/tool-limits';
import {
    OpenRouterProtocolError,
    OpenRouterProviderError,
} from '../errors';

function streamFromSSE(lines: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(enc.encode(lines));
            controller.close();
        },
    });
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    });
}

async function collect(
    stream: ReadableStream<Uint8Array>,
    options?: Parameters<typeof parseOpenRouterSSE>[1]
) {
    const events: Array<any> = [];
    for await (const event of parseOpenRouterSSE(stream, options)) {
        events.push(event);
    }
    return events;
}

describe('parseOpenRouterSSE', () => {
    it.each([false, true])('preserves every final multipart text without replaying prior deltas (streamed=%s)', async streamed => {
        const content = [{ type: 'text', text: 'First ' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } }, { type: 'text', text: 'second' }];
        const final = `data: ${JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })}\n\n`;
        const deltas = streamed ? `data: ${JSON.stringify({ choices: [{ delta: { content: 'Already streamed' } }] })}\n\n` : '';
        const events = await collect(streamFromSSE(deltas + final + 'data: [DONE]\n\n'));
        expect(events.filter(event => event.type === 'text').map(event => event.text).join(''))
            .toBe(streamed ? 'Already streamed' : 'First second');
        expect(events.filter(event => event.type === 'image')).toHaveLength(1);
    });

    it('retains explicit provider refusal for auxiliary consumers without converting it into text', async () => {
        const frame = { choices: [{ delta: { refusal: 'Unable to summarize' }, finish_reason: 'stop' }] };
        expect(await collect(streamFromSSE(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`))).toEqual([{ type: 'done', refused: true }]);
    });
    it('marks explicit length termination for auxiliary validation while preserving ordinary streamed text', async () => {
        const frame = { choices: [{ delta: { content: 'Partial answer' }, finish_reason: 'length' }] };
        expect(await collect(streamFromSSE(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`)))
            .toEqual([{ type: 'text', text: 'Partial answer' }, { type: 'done', truncated: true }]);
    });
    it('preserves valid final usage after a finish reason, empty choices and fragmented transport without duplicate accounting', async () => {
        const frames = [
            { id: 'provider-request', model: 'large-model', choices: [{ delta: { content: 'Settled answer' }, finish_reason: 'stop' }] },
            { choices: [], usage: { prompt_tokens: 180000, completion_tokens: 42 } },
            { choices: [], usage: { prompt_tokens: 180000, completion_tokens: 42 } },
        ];
        const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
        const bytes = new TextEncoder().encode(body);
        const chunks = Array.from({ length: Math.ceil(bytes.length / 13) }, (_, index) => bytes.slice(index * 13, (index + 1) * 13));
        const events = await collect(streamFromChunks(chunks));
        expect(events.filter((event) => event.type === 'usage')).toEqual([{ type: 'usage', usage: {
            prompt_tokens: 180000, completion_tokens: 42, model: 'large-model', response_id: 'provider-request',
        } }]);
        expect(events.filter((event) => event.type !== 'usage')).toEqual([{ type: 'text', text: 'Settled answer' }, { type: 'done' }]);
    });
    it.each([
        undefined, {}, { prompt_tokens: 12 }, { prompt_tokens: -1, completion_tokens: 2 },
        { prompt_tokens: 2.5, completion_tokens: 1 }, { prompt_tokens: '20', completion_tokens: 1 },
        { prompt_tokens: null, completion_tokens: 2 }, { prompt_tokens: 20, completion_tokens: Number.MAX_SAFE_INTEGER + 1 },
    ])('ignores missing/malformed usage without failing valid text %#', async (usage) => {
        const frame = { choices: [{ delta: { content: 'Valid text' }, finish_reason: 'stop' }], usage };
        const events = await collect(streamFromSSE(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`));
        expect(events).toEqual([{ type: 'text', text: 'Valid text' }, { type: 'done' }]);
    });
    it('retains explicit zero usage and the final measurement rather than summing updates', async () => {
        const body = [{ prompt_tokens: 0, completion_tokens: 0 }, { prompt_tokens: 55, completion_tokens: 3 }]
            .map((usage) => `data: ${JSON.stringify({ choices: [], usage })}\n\n`).join('') + 'data: [DONE]\n\n';
        expect((await collect(streamFromSSE(body))).filter((event) => event.type === 'usage')).toEqual([
            { type: 'usage', usage: { prompt_tokens: 0, completion_tokens: 0 } },
            { type: 'usage', usage: { prompt_tokens: 55, completion_tokens: 3 } },
        ]);
    });
    it('captures OpenRouter cost and detail counters alongside the token counts', async () => {
        const usage = { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042,
            prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 12 } };
        const body = `data: ${JSON.stringify({ id: 'gen-1', model: 'm', choices: [], usage })}\n\ndata: [DONE]\n\n`;
        expect((await collect(streamFromSSE(body))).filter((event) => event.type === 'usage')).toEqual([{ type: 'usage', usage: {
            prompt_tokens: 120, completion_tokens: 30, model: 'm', response_id: 'gen-1', cost: 0.00042, cached_tokens: 80, reasoning_tokens: 12 } }]);
    });
    it.each([
        { cost: -0.1 }, { cost: '0.5' }, { cost: null }, { cost: { value: 1 } },
        { prompt_tokens_details: { cached_tokens: -1 } }, { completion_tokens_details: { reasoning_tokens: 1.5 } },
        { prompt_tokens_details: 'many' },
    ])('drops a malformed cost or detail counter but keeps the measured tokens %#', async (extra) => {
        const body = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 2, ...extra } })}\n\ndata: [DONE]\n\n`;
        expect((await collect(streamFromSSE(body))).filter((event) => event.type === 'usage')).toEqual([
            { type: 'usage', usage: { prompt_tokens: 20, completion_tokens: 2 } }]);
    });
    it('retains an explicit zero cost for a free request', async () => {
        const body = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 2, cost: 0 } })}\n\ndata: [DONE]\n\n`;
        expect((await collect(streamFromSSE(body))).filter((event) => event.type === 'usage')).toEqual([
            { type: 'usage', usage: { prompt_tokens: 20, completion_tokens: 2, cost: 0 } }]);
    });
    it('emits all reasoning_details entries in order', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"plan"},{"type":"reasoning.summary","summary":"summary"}]}}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<{ type: string; text?: string }> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse))) {
            events.push(evt as any);
        }

        const reasoningTexts = events
            .filter((evt) => evt.type === 'reasoning')
            .map((evt) => evt.text);

        expect(reasoningTexts).toEqual(['plan', 'summary']);
    });

    it('handles cumulative tool_call name/arguments chunks without duplication', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"or3_","arguments":"{"}}]}}]}',
            '',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"or3_tasks_create_list","arguments":"{\\"listId\\":\\"abc\\"}"}}]},"finish_reason":"tool_calls"}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<any> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse), {
            streamedFieldMode: 'cumulative-snapshot',
        })) {
            events.push(evt);
        }

        const toolEvent = events.find((evt) => evt.type === 'tool_call');
        expect(toolEvent).toBeTruthy();
        expect(toolEvent.tool_call.id).toBe('call_1');
        expect(toolEvent.tool_call.function.name).toBe('or3_tasks_create_list');
        expect(toolEvent.tool_call.function.arguments).toBe('{"listId":"abc"}');
    });

    it('does not re-emit final message.content text after streaming deltas', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"Hello "}}]}',
            '',
            'data: {"choices":[{"delta":{"content":"world"}}]}',
            '',
            'data: {"choices":[{"message":{"content":"Hello world"},"finish_reason":"stop"}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<any> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse))) {
            events.push(evt);
        }

        const texts = events
            .filter((evt) => evt.type === 'text')
            .map((evt) => evt.text);
        expect(texts).toEqual(['Hello ', 'world']);
    });

    it('emits final message.content text only when no deltas were streamed', async () => {
        const sse = [
            'data: {"choices":[{"message":{"content":"Reasoning-only answer"},"finish_reason":"stop"}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<any> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse))) {
            events.push(evt);
        }

        const texts = events
            .filter((evt) => evt.type === 'text')
            .map((evt) => evt.text);
        expect(texts).toEqual(['Reasoning-only answer']);
    });

    it('does not triple-emit text when delta.content array and delta.text are both present', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":[{"type":"text","text":"array "}],"text":"fallback "}}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<any> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse))) {
            events.push(evt);
        }

        const texts = events
            .filter((evt) => evt.type === 'text')
            .map((evt) => evt.text);
        expect(texts).toEqual(['array ']);
    });

    it('rejects a tool call when the provider omits its identity', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"or3_web_search"}}]}}]}',
            '',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        await expect(collect(streamFromSSE(sse))).rejects.toBeInstanceOf(OpenRouterProtocolError);
    });

    it('assembles interleaved names and arguments exactly across byte fragments', async () => {
        const frame = (tool_calls: unknown[], finish_reason: string | null = null) =>
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls }, finish_reason }] })}\n\n`;
        const body = frame([
            { index: 0, id: 'echo', function: { name: 'test_', arguments: '{"value":' } },
            { index: 1, id: 'write', function: { arguments: '{"value":"' } },
        ]) + frame([
            { index: 1, function: { name: 'test_write_once', arguments: 'café"}' } },
            { index: 0, function: { name: 'echo', arguments: '"first"}' } },
        ], 'tool_calls') + 'data: [DONE]\n\n';
        const bytes = new TextEncoder().encode(body);
        const events = await collect(streamFromChunks(Array.from(bytes, byte => new Uint8Array([byte]))));
        expect(events).toEqual([
            { type: 'tool_call', tool_call: { id: 'echo', type: 'function', function: { name: 'test_echo', arguments: '{"value":"first"}' } } },
            { type: 'tool_call', tool_call: { id: 'write', type: 'function', function: { name: 'test_write_once', arguments: '{"value":"café"}' } } },
            { type: 'done' },
        ]);
    });

    it.each(['', 'data: [DONE]\n\n', 'data: {broken}\n\n',
        'data: {"error":{"message":"provider failed","status":503}}\n\n'])
    ('never emits an executable partial call after interruption %j', async suffix => {
        const stream = streamFromSSE('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"partial","function":{"name":"test_echo","arguments":"{\\"value\\":"}}]}}]}\n\n' + suffix);
        const emitted: string[] = [];
        await expect((async () => {
            for await (const event of parseOpenRouterSSE(stream)) emitted.push(event.type);
        })()).rejects.toBeInstanceOf(suffix.includes('provider failed') ? OpenRouterProviderError : OpenRouterProtocolError);
        expect(emitted).not.toContain('tool_call');
        expect(emitted).not.toContain('done');
    });

    it('rejects an identity change within the same streamed call index', async () => {
        const body = ['first', 'second'].map(id => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: id === 'first' ? 'test_echo' : undefined, arguments: id === 'first' ? '{' : '}' } }] }, finish_reason: id === 'second' ? 'tool_calls' : null }] })}\n\n`).join('');
        await expect(collect(streamFromSSE(body))).rejects.toBeInstanceOf(OpenRouterProtocolError);
    });

    it.each(['', 'data: [DONE]\n\n'].flatMap(suffix => [false, true].map(reverse => ({ suffix, reverse }))))
    ('rejects an unfinished choice independently of choice order: %j', async ({ suffix, reverse }) => {
        const choices = [
            { index: 0, delta: { content: 'First choice finished.' }, finish_reason: 'stop' },
            { index: 1, delta: { tool_calls: [{ index: 0, id: 'unfinished', function: { name: 'test_echo', arguments: '{' } }] }, finish_reason: null },
        ];
        const body = `data: ${JSON.stringify({ choices: reverse ? choices.reverse() : choices })}\n\n` + suffix;
        const emitted: string[] = [];
        await expect((async () => {
            for await (const event of parseOpenRouterSSE(streamFromSSE(body))) emitted.push(event.type);
        })()).rejects.toBeInstanceOf(OpenRouterProtocolError);
        expect(emitted).toEqual(['text']);
    });

    it('retains repeated argument deltas rather than guessing they are transport replays', async () => {
        const fragments = ['{"value":"', 'ha', 'ha', '"}'];
        const body = fragments.map((arguments_, index) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...(index === 0 ? { id: 'repeat', function: { name: 'test_echo', arguments: arguments_ } } : { function: { arguments: arguments_ } }) }] }, finish_reason: index === 3 ? 'tool_calls' : null }] })}\n\n`).join('');
        expect((await collect(streamFromSSE(body)))[0]).toMatchObject({ tool_call: { id: 'repeat', function: { arguments: '{"value":"haha"}' } } });
    });

    it('bounds accumulated streamed tool arguments before emitting them', async () => {
        const oversized = 'é'.repeat(MAX_TOOL_ARGUMENT_BYTES);
        const payload = JSON.stringify({ choices: [{
            delta: { tool_calls: [{ index: 0, id: 'large', function: { name: 'bounded', arguments: oversized } }] },
            finish_reason: 'tool_calls',
        }] });
        const events: any[] = [];
        for await (const event of parseOpenRouterSSE(streamFromSSE(`data: ${payload}\n\n`))) {
            events.push(event);
        }
        const args = events.find((event) => event.type === 'tool_call').tool_call.function.arguments;
        expect(args).toContain('_or3_error');
        expect(utf8Bytes(args)).toBeLessThan(MAX_TOOL_ARGUMENT_BYTES);
        expect(args).not.toContain(oversized.slice(0, 100));
    });

    it('supports optional data whitespace, comments, CRLF, and final unterminated events', async () => {
        const sse = [
            ': keepalive\r\n',
            'data:{"choices":[{"delta":{"content":"one"}}]}\r\n\r\n',
            'data: {"choices":[{"delta":{"content":"two"},"finish_reason":"stop"}]}',
        ].join('');
        const events = await collect(streamFromSSE(sse));
        expect(events).toEqual([
            { type: 'text', text: 'one' },
            { type: 'text', text: 'two' },
            { type: 'done' },
        ]);
    });

    it('rejects an EOF that arrives before any verified terminal signal', async () => {
        const sse = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
        await expect(
            collect(streamFromSSE(sse))
        ).rejects.toBeInstanceOf(OpenRouterProtocolError);
    });

    it('joins multiline data fields and preserves split UTF-8 code points', async () => {
        const encoded = new TextEncoder().encode(
            'data: {"choices":[{"delta":\ndata: {"content":"café"},"finish_reason":"stop"}]}\n\n'
        );
        const splitAt = encoded.indexOf(0xc3) + 1;
        const events = await collect(
            streamFromChunks([
                encoded.slice(0, splitAt),
                encoded.slice(splitAt),
            ])
        );
        expect(events).toEqual([
            { type: 'text', text: 'café' },
            { type: 'done' },
        ]);
    });

    it('throws a typed protocol failure for malformed JSON instead of completing', async () => {
        await expect(
            collect(streamFromSSE('data: {not-json}\n\n'))
        ).rejects.toBeInstanceOf(OpenRouterProtocolError);
    });

    it('distinguishes body transport failure from protocol and provider failure', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new TypeError('socket closed'));
            },
        });
        await expect(collect(stream)).rejects.toMatchObject({
            name: 'OpenRouterStreamError',
            kind: 'transport',
            retryable: true,
        });
    });

    it('throws a typed provider failure for a top-level error envelope', async () => {
        const promise = collect(
            streamFromSSE(
                'data: {"error":{"message":"provider unavailable","code":529,"status":529}}\n\n'
            )
        );
        await expect(promise).rejects.toMatchObject({
            name: 'OpenRouterProviderError',
            kind: 'provider',
            status: 529,
            providerCode: 529,
            retryable: true,
        });
    });

    it('does not convert partial text followed by an error finish reason into completion', async () => {
        const seen: Array<any> = [];
        const run = async () => {
            for await (const event of parseOpenRouterSSE(streamFromSSE([
                'data: {"choices":[{"delta":{"content":"partial"}}]}',
                '',
                'data: {"choices":[{"finish_reason":"error"}]}',
                '',
            ].join('\n')))) {
                seen.push(event);
            }
        };
        await expect(run()).rejects.toBeInstanceOf(OpenRouterProviderError);
        expect(seen).toEqual([{ type: 'text', text: 'partial' }]);
    });

    it('emits one terminal event and cancels an upstream stream left open after DONE', async () => {
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            },
            cancel() {
                cancelled = true;
            },
        });
        const events = await collect(stream);
        expect(events).toEqual([{ type: 'done' }]);
        expect(cancelled).toBe(true);
    });

    it('concatenates identical deltas in standard mode', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"1"}}]}}]}',
            '',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1"}}]},"finish_reason":"tool_calls"}]}',
            '',
        ].join('\n');
        const events = await collect(streamFromSSE(sse));
        expect(events.find((event) => event.type === 'tool_call').tool_call.function.arguments).toBe('11');
    });

    it('replaces cumulative snapshots only when the provider explicitly opts in', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"ec","arguments":"1"}}]}}]}',
            '',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"echo","arguments":"11"}}]},"finish_reason":"tool_calls"}]}',
            '',
        ].join('\n');
        const events = await collect(streamFromSSE(sse), {
            streamedFieldMode: 'cumulative-snapshot',
        });
        const tool = events.find((event) => event.type === 'tool_call').tool_call;
        expect(tool.function).toEqual({ name: 'echo', arguments: '11' });
    });
});
