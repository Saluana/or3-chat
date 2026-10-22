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
import { attachRequestUsage, captureUsagePrefix } from '../request-usage';

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
    describe('reply usage totals', () => {
        const measure = async (state: ReturnType<typeof createNormalizedStreamState>, usage: { prompt_tokens: number; completion_tokens: number; cost?: number }) => {
            const prefix = await captureUsagePrefix({ model: 'model', messages: [{ role: 'user', content: 'hi' }], countText: async (text) => text.length });
            return reduceNormalizedStreamEvent(state, { type: 'usage', usage,
                requestUsage: attachRequestUsage(prefix, usage, { requestId: 'host', iteration: state.iteration, measuredAt: 1 }) });
        };
        it('sums every measured request of a tool loop while usage stays the latest request', async () => {
            let state = beginNormalizedIteration(createNormalizedStreamState());
            state = await measure(state, { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 });
            expect(state.requestUsage?.totals).toEqual({ requests: 1, prompt_tokens: 100, completion_tokens: 20, cost: 0.001 });
            state = beginNormalizedIteration(state);
            state = await measure(state, { prompt_tokens: 150, completion_tokens: 30, cost: 0.002 });
            expect(state.requestUsage).toMatchObject({ prompt_tokens: 150, iteration: 2,
                totals: { requests: 2, prompt_tokens: 250, completion_tokens: 50, cost: 0.003 } });
            expect(state.usage).toMatchObject({ prompt_tokens: 150, iteration: 2 });
        });
        it('replaces rather than adds when one request reports twice, and counts a repeat once', async () => {
            let state = beginNormalizedIteration(createNormalizedStreamState());
            state = await measure(state, { prompt_tokens: 10, completion_tokens: 1, cost: 0.1 });
            state = await measure(state, { prompt_tokens: 10, completion_tokens: 1, cost: 0.1 });
            state = await measure(state, { prompt_tokens: 12, completion_tokens: 3, cost: 0.2 });
            expect(state.requestUsage?.totals).toEqual({ requests: 1, prompt_tokens: 12, completion_tokens: 3, cost: 0.2 });
            state = beginNormalizedIteration(state);
            state = await measure(state, { prompt_tokens: 5, completion_tokens: 5 });
            expect(state.requestUsage?.totals).toEqual({ requests: 2, prompt_tokens: 17, completion_tokens: 8, cost: 0.2 });
        });
        it('skips an iteration that reported nothing and never folds an old measurement twice', async () => {
            let state = beginNormalizedIteration(createNormalizedStreamState());
            state = await measure(state, { prompt_tokens: 100, completion_tokens: 10 });
            state = beginNormalizedIteration(state);
            state = beginNormalizedIteration(state);
            state = await measure(state, { prompt_tokens: 7, completion_tokens: 3 });
            expect(state.requestUsage?.totals).toEqual({ requests: 2, prompt_tokens: 107, completion_tokens: 13 });
        });
        it('keeps totals when a paused loop resumes from the persisted state', async () => {
            let state = beginNormalizedIteration(createNormalizedStreamState());
            state = await measure(state, { prompt_tokens: 100, completion_tokens: 10, cost: 0.01 });
            const resumed = beginNormalizedIteration(JSON.parse(JSON.stringify(state)));
            expect((await measure(resumed, { prompt_tokens: 50, completion_tokens: 5, cost: 0.02 })).requestUsage?.totals)
                .toEqual({ requests: 2, prompt_tokens: 150, completion_tokens: 15, cost: 0.03 });
        });
        it('leaves a reply without a measurement prefix without totals', () => {
            let state = beginNormalizedIteration(createNormalizedStreamState());
            state = reduceNormalizedStreamEvent(state, { type: 'usage', usage: { prompt_tokens: 5, completion_tokens: 1, cost: 1 } });
            expect(state.requestUsage).toBeUndefined();
        });
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
