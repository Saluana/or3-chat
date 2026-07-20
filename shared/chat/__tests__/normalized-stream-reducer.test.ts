import { describe, expect, it } from 'vitest';
import {
    beginNormalizedIteration,
    createNormalizedStreamState,
    failNormalizedStream,
    finishNormalizedIteration,
    reduceNormalizedStreamEvent,
    settleNormalizedTool,
} from '../normalized-stream-reducer';

const toolEvent = {
    type: 'tool_call' as const,
    tool_call: {
        id: 'call-1',
        type: 'function' as const,
        function: { name: 'echo', arguments: '{"value":"ok"}' },
    },
};

describe('normalized stream reducer', () => {
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
});
