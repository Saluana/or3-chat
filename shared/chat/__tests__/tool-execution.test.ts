import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    executeWithAbortTimeout,
    ToolExecutionAbortedError,
    ToolExecutionTimeoutError,
} from '../tool-execution';

afterEach(() => {
    vi.useRealTimers();
});

describe('executeWithAbortTimeout', () => {
    it('clears its timer after fast success', async () => {
        vi.useFakeTimers();
        await expect(executeWithAbortTimeout({
            signal: new AbortController().signal,
            timeoutMs: 100,
            execute: () => 'ok',
        })).resolves.toBe('ok');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('aborts cooperative work with a typed timeout', async () => {
        vi.useFakeTimers();
        let childSignal: AbortSignal | undefined;
        const execution = executeWithAbortTimeout({
            signal: new AbortController().signal,
            timeoutMs: 10,
            execute: (signal) => {
                childSignal = signal;
                return new Promise(() => undefined);
            },
        });
        const rejection = expect(execution).rejects.toBeInstanceOf(ToolExecutionTimeoutError);
        await vi.advanceTimersByTimeAsync(10);
        await rejection;
        expect(childSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates caller cancellation as abort, not timeout', async () => {
        const caller = new AbortController();
        const execution = executeWithAbortTimeout({
            signal: caller.signal,
            timeoutMs: 1_000,
            execute: () => new Promise(() => undefined),
        });
        caller.abort();
        await expect(execution).rejects.toBeInstanceOf(ToolExecutionAbortedError);
    });

    it('does not classify an ordinary error containing timeout as a timeout', async () => {
        await expect(executeWithAbortTimeout({
            signal: new AbortController().signal,
            timeoutMs: 1_000,
            execute: () => { throw new Error('business timeout policy rejected'); },
        })).rejects.toMatchObject({
            name: 'Error',
            message: 'business timeout policy rejected',
        });
    });
});
