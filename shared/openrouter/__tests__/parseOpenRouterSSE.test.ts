import { describe, expect, it } from 'vitest';
import { parseOpenRouterSSE } from '../parseOpenRouterSSE';

function streamFromSSE(lines: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(enc.encode(lines));
            controller.close();
        },
    });
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
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"or3_tasks_create_list","arguments":"{\\\"listId\\\":\\\"abc\\\"}"}}]},"finish_reason":"tool_calls"}]}',
            '',
            'data: [DONE]',
            '',
        ].join('\n');

        const events: Array<any> = [];
        for await (const evt of parseOpenRouterSSE(streamFromSSE(sse))) {
            events.push(evt);
        }

        const toolEvent = events.find((evt) => evt.type === 'tool_call');
        expect(toolEvent).toBeTruthy();
        expect(toolEvent.tool_call.id).toBe('call_1');
        expect(toolEvent.tool_call.function.name).toBe('or3_tasks_create_list');
        expect(toolEvent.tool_call.function.arguments).toBe('{"listId":"abc"}');
    });
});
