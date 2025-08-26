import { describe, it, expect } from 'vitest';
import { useTailStream } from '../useTailStream';
import { nextTick } from 'vue';

// NOTE: Timer-based behavior; flushIntervalMs shortened for faster test.

describe('useTailStream', () => {
    it('accumulates and flushes chunks', async () => {
        const tail = useTailStream({ flushIntervalMs: 5 });
        tail.push('Hel');
        tail.push('lo');
        expect(tail.displayText.value).toBe(''); // not flushed yet
        await new Promise((r) => setTimeout(r, 12));
        expect(tail.displayText.value).toBe('Hello');
        tail.complete();
        expect(tail.done.value).toBe(true);
    });

    it('immediate flushes first chunk when immediate true', () => {
        const tail = useTailStream({ immediate: true });
        tail.push('A');
        expect(tail.displayText.value).toBe('A');
    });

    it('handles fail()', async () => {
        const tail = useTailStream({ flushIntervalMs: 5 });
        tail.push('x');
        tail.fail(new Error('boom'));
        expect(tail.error.value?.message).toBe('boom');
        expect(tail.done.value).toBe(false);
    });
});
