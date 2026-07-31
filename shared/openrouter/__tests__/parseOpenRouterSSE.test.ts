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

    it('synthesizes tool_call id when provider omits it from streaming deltas', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"or3_web_search"}}]}}]}',
            '',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<any> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse))) {
            events.push(evt);
        }

        const toolEvents = events.filter((evt) => evt.type === 'tool_call');
        expect(toolEvents).toHaveLength(1);
        expect(toolEvents[0].tool_call.function.name).toBe('or3_web_search');
        expect(toolEvents[0].tool_call.function.arguments).toBe('{"query":"x"}');
        expect(typeof toolEvents[0].tool_call.id).toBe('string');
        expect(toolEvents[0].tool_call.id.startsWith('or3_tool_call_')).toBe(true);
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
            'data: {"choices":[{"delta":{"content":"two"}}]}',
        ].join('');
        const events = await collect(streamFromSSE(sse));
        expect(events).toEqual([
            { type: 'text', text: 'one' },
            { type: 'text', text: 'two' },
            { type: 'done' },
        ]);
    });

    it('joins multiline data fields and preserves split UTF-8 code points', async () => {
        const encoded = new TextEncoder().encode(
            'data: {"choices":[{"delta":\ndata: {"content":"café"}}]}\n\n'
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
