import { describe, expect, it } from 'vitest';
import {
    beginNormalizedIteration,
    createNormalizedStreamState,
    failNormalizedStream,
    finishNormalizedIteration,
    reduceNormalizedStreamEvent,
    settleNormalizedTool,
} from '../normalized-stream-reducer';
import { OutputLimitExceededError } from '../tool-limits';

const toolEvent = {
    type: 'tool_call' as const,
    tool_call: {
        id: 'call-1',
        type: 'function' as const,
        function: { name: 'echo', arguments: '{"value":"ok"}' },
    },
};

describe('normalized stream reducer', () => {
    it('keeps the last measured request across tool iterations without summing prompt counts or changing text/tools', () => {
        let state = beginNormalizedIteration(createNormalizedStreamState());
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: 'before' });
        state = reduceNormalizedStreamEvent(state, toolEvent);
        state = settleNormalizedTool(state, 'call-1', { status: 'complete', result: 'ok' });
        state = reduceNormalizedStreamEvent(state, { type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20, model: 'model', response_id: 'first' } });
        expect(state.usage).toEqual({ prompt_tokens: 100, completion_tokens: 20, model: 'model', response_id: 'first', iteration: 1 });
        const before = state;
        state = beginNormalizedIteration(state);
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: ' after' });
        state = reduceNormalizedStreamEvent(state, { type: 'usage', usage: { prompt_tokens: 150, completion_tokens: 30, model: 'model', response_id: 'second' } });
        expect(state.usage).toEqual({ prompt_tokens: 150, completion_tokens: 30, model: 'model', response_id: 'second', iteration: 2 });
        expect(state).toMatchObject({ cumulativeText: 'before after', chunks: 2, tools: before.tools });
        expect(state.outputBytes).toBe(before.outputBytes + new TextEncoder().encode(' after').length);
    });
    it('treats duplicate measurements idempotently and malformed/missing usage as absence', () => {
        let state = beginNormalizedIteration(createNormalizedStreamState());
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: 'Text' });
        expect(state.usage).toBeUndefined();
        const invalid = reduceNormalizedStreamEvent(state, { type: 'usage', usage: { prompt_tokens: -1, completion_tokens: 1 } });
        expect(invalid).toBe(state);
        const event = { type: 'usage' as const, usage: { prompt_tokens: 20, completion_tokens: 2 } };
        state = reduceNormalizedStreamEvent(state, event);
        expect(reduceNormalizedStreamEvent(state, event)).toBe(state);
        expect(reduceNormalizedStreamEvent(state, { type: 'done' }).usage).toEqual({ prompt_tokens: 20, completion_tokens: 2, iteration: 1 });
    });
    it('produces one canonical state across a multi-iteration tool loop', () => {
        let state = beginNormalizedIteration(createNormalizedStreamState());
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: 'before' });
        state = reduceNormalizedStreamEvent(state, { type: 'reasoning', text: 'think' });
        state = reduceNormalizedStreamEvent(state, toolEvent);
        state = settleNormalizedTool(state, 'call-1', {
            status: 'complete',
            result: 'ok',
        });

        const first = finishNormalizedIteration(state, 10);
        expect(first.requiresFollowup).toBe(true);
        expect(first.state).toMatchObject({
            iteration: 1,
            cumulativeText: 'before',
            iterationText: 'before',
            reasoningText: 'think',
            chunks: 1,
            terminal: 'active',
            tools: { 'call-1': { status: 'complete', result: 'ok' } },
        });

        state = beginNormalizedIteration(first.state);
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: ' after' });
        const second = finishNormalizedIteration(state, 10);
        expect(second.requiresFollowup).toBe(false);
        expect(second.state).toMatchObject({
            iteration: 2,
            cumulativeText: 'before after',
            iterationText: ' after',
            chunks: 2,
            terminal: 'complete',
        });
    });

    it('owns the shared iteration cap', () => {
        let state = beginNormalizedIteration(createNormalizedStreamState());
        state = reduceNormalizedStreamEvent(state, toolEvent);
        expect(() => finishNormalizedIteration(state, 1)).toThrow(
            'max iterations'
        );
    });

    it('keeps duplicate text deltas but deduplicates repeated tool and image events', () => {
        let state = beginNormalizedIteration(createNormalizedStreamState());
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: 'same' });
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: 'same' });
        state = reduceNormalizedStreamEvent(state, toolEvent);
        state = reduceNormalizedStreamEvent(state, toolEvent);
        state = reduceNormalizedStreamEvent(state, {
            type: 'image',
            url: 'https://example.test/image.png',
        });
        state = reduceNormalizedStreamEvent(state, {
            type: 'image',
            url: 'https://example.test/image.png',
        });

        expect(state.cumulativeText).toBe('samesame');
        expect(state.chunks).toBe(2);
        expect(state.iterationToolCallIds).toEqual(['call-1']);
        expect(Object.keys(state.tools)).toEqual(['call-1']);
        expect(state.images).toEqual(['https://example.test/image.png']);
    });

    it('preserves every chunk in a long normalized stream', () => {
        let state = beginNormalizedIteration(createNormalizedStreamState());
        for (let index = 0; index < 5_000; index += 1) {
            state = reduceNormalizedStreamEvent(state, {
                type: 'text',
                text: String(index % 10),
            });
        }

        expect(state.cumulativeText).toHaveLength(5_000);
        expect(state.chunks).toBe(5_000);
        expect(state.outputBytes).toBe(5_000);
    });

    it('normalizes abort and failure terminal states', () => {
        const active = beginNormalizedIteration(createNormalizedStreamState());
        const aborted = new Error('cancelled');
        aborted.name = 'AbortError';
        expect(failNormalizedStream(active, aborted)).toMatchObject({
            terminal: 'aborted',
            error: 'cancelled',
        });
        expect(failNormalizedStream(active, new Error('boom'))).toMatchObject({
            terminal: 'failed',
            error: 'boom',
        });
    });

    it('rejects output that would exceed the canonical message budget', () => {
        let state = createNormalizedStreamState({
            outputLimitBytes: 8 * 1024,
        });
        state = reduceNormalizedStreamEvent(state, { type: 'text', text: 'ok' });
        expect(state.cumulativeText).toBe('ok');

        expect(() =>
            reduceNormalizedStreamEvent(state, {
                type: 'text',
                text: 'x'.repeat(3_000),
            })
        ).toThrow(OutputLimitExceededError);

        // The accepted prefix is preserved; the offending event is not applied.
        expect(state.cumulativeText).toBe('ok');
        expect(state.outputBytes).toBe(2);
    });

    it('counts tool metadata against the canonical message budget', () => {
        const state = createNormalizedStreamState({
            outputLimitBytes: 8 * 1024,
        });
        expect(() =>
            reduceNormalizedStreamEvent(state, {
                type: 'tool_call',
                tool_call: {
                    id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'echo',
                        arguments: JSON.stringify({
                            value: 'x'.repeat(5_000),
                        }),
                    },
                },
            })
        ).toThrow(OutputLimitExceededError);
    });
});
