import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createStreamAccumulator,
    useStreamAccumulator,
} from '../chat/useStreamAccumulator';

// Helper to flush queued microtasks / rAF fallback
async function nextFrame() {
    if (typeof requestAnimationFrame === 'function') {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
    } else {
        await new Promise<void>((r) => setTimeout(r, 0));
        await new Promise<void>((r) => setTimeout(r, 0));
    }
    // allow Vue reactivity to flush
    await Promise.resolve();
}

describe('createStreamAccumulator', () => {
    beforeEach(() => {
        // no shared state
    });

    it('batches multiple appends in a single frame (R3)', async () => {
        const acc = createStreamAccumulator();
        acc.append('A', { kind: 'text' });
        acc.append('B', { kind: 'text' });
        acc.append('C', { kind: 'text' });
        expect(acc.state.text).toBe(''); // not flushed yet
        await nextFrame();
        expect(acc.state.text).toBe('ABC');
        expect(acc.state.version).toBe(1);
    });

    it('separates reasoning vs main channel (R6)', async () => {
        const acc = createStreamAccumulator();
        acc.append('main1', { kind: 'text' });
        acc.append('r1', { kind: 'reasoning' });
        acc.append('main2', { kind: 'text' });
        await nextFrame();
        expect(acc.state.text).toBe('main1main2');
        expect(acc.state.reasoningText).toBe('r1');
    });

    it('flushes a reasoning-only frame', async () => {
        const acc = createStreamAccumulator();
        acc.append('thought', { kind: 'reasoning' });
        await nextFrame();

        expect(acc.state.text).toBe('');
        expect(acc.state.reasoningText).toBe('thought');
    });

    it('finalize flushes pending tokens (R4)', async () => {
        const acc = createStreamAccumulator();
        acc.append('X', { kind: 'text' });
        acc.finalize();
        expect(acc.state.text).toBe('X');
        expect(acc.state.finalized).toBe(true);
        expect(acc.state.isActive).toBe(false);
    });

    it('finalize is idempotent (R4)', async () => {
        const acc = createStreamAccumulator();
        acc.append('A', { kind: 'text' });
        acc.finalize();
        const v1 = acc.state.version;
        acc.finalize();
        expect(acc.state.text).toBe('A');
        expect(acc.state.version).toBe(v1); // no extra flush
    });

    it('error finalize sets error (R5)', async () => {
        const acc = createStreamAccumulator();
        acc.append('hi', { kind: 'text' });
        const err = new Error('boom');
        acc.finalize({ error: err });
        expect(acc.state.error).toBe(err);
        expect(acc.state.finalized).toBe(true);
    });

    it('abort finalize does not set error (R5)', async () => {
        const acc = createStreamAccumulator();
        acc.append('hi', { kind: 'text' });
        acc.finalize({ aborted: true });
        expect(acc.state.error).toBeNull();
        expect(acc.state.aborted).toBe(true);
        expect(acc.state.finalized).toBe(true);
    });

    it('reset reactivates state (R11)', async () => {
        const acc = createStreamAccumulator();
        acc.append('A', { kind: 'text' });
        acc.finalize();
        const vBefore = acc.state.version;
        acc.reset();
        expect(acc.state.text).toBe('');
        expect(acc.state.reasoningText).toBe('');
        expect(acc.state.isActive).toBe(true);
        expect(acc.state.finalized).toBe(false);
        expect(acc.state.aborted).toBe(false);
        expect(acc.state.version).toBeGreaterThan(vBefore);
    });

    it('empty delta append ignored (dev warnings capped) (R5 ancillary)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const acc = createStreamAccumulator();
        acc.append('', { kind: 'text' });
        acc.append('', { kind: 'text' });
        acc.append('', { kind: 'text' });
        acc.append('', { kind: 'text' }); // fourth still ignored but warning capped
        await nextFrame();
        expect(acc.state.text).toBe('');
        warnSpy.mockRestore();
    });

    it('finalize without any pending tokens still increments version (branch)', () => {
        const acc = createStreamAccumulator();
        const v0 = acc.state.version;
        acc.finalize();
        expect(acc.state.finalized).toBe(true);
        expect(acc.state.version).toBeGreaterThan(v0);
    });

    it('reset mid-stream cancels scheduled frame and clears buffers', async () => {
        const acc = createStreamAccumulator();
        acc.append('hello', { kind: 'text' }); // queued but not yet flushed
        acc.reset(); // should cancel pending flush and wipe text
        await nextFrame();
        expect(acc.state.text).toBe('');
        expect(acc.state.isActive).toBe(true);
        // New append works after reset
        acc.append('X', { kind: 'text' });
        await nextFrame();
        expect(acc.state.text).toBe('X');
    });

    it('hydrates persisted state without replaying a queued delta', async () => {
        const acc = createStreamAccumulator();
        acc.append('stale', { kind: 'text' });
        acc.hydrate({ text: 'persisted', reasoningText: 'saved thought' });
        await nextFrame();

        expect(acc.state.text).toBe('persisted');
        expect(acc.state.reasoningText).toBe('saved thought');
    });

    it('resumes an aborted stream from its persisted snapshot without duplication', () => {
        const first = createStreamAccumulator();
        first.hydrate({ text: 'partial', reasoningText: 'thinking' });
        first.append(' response', { kind: 'text' });
        first.finalize({ aborted: true });
        expect(first.state.text).toBe('partial response');

        const resumed = createStreamAccumulator();
        resumed.hydrate({
            text: first.state.text,
            reasoningText: first.state.reasoningText,
        });
        resumed.append(' completed', { kind: 'text' });
        resumed.finalize();

        expect(resumed.state.text).toBe('partial response completed');
        expect(resumed.state.reasoningText).toBe('thinking');
    });

    it('preserves a long stream exactly while batching its reactive write', () => {
        const acc = createStreamAccumulator();
        const chunks = Array.from({ length: 20_000 }, (_, index) =>
            String(index % 10)
        );
        for (const chunk of chunks) acc.append(chunk, { kind: 'text' });
        acc.finalize();

        expect(acc.state.text).toBe(chunks.join(''));
        expect(acc.state.text).toHaveLength(20_000);
        expect(acc.state.version).toBe(1);
    });

    it('append ignores after finalize and does not schedule new frame', async () => {
        const acc = createStreamAccumulator();
        acc.append('A', { kind: 'text' });
        await nextFrame();
        const v1 = acc.state.version;
        acc.finalize();
        acc.append('B', { kind: 'text' });
        await nextFrame();
        expect(acc.state.text).toBe('A');
        expect(acc.state.version).toBe(v1 + 1); // only finalize bump
    });

    it('fallback no-raf path flushes via a microtask', async () => {
        const realRaf = (global as any).requestAnimationFrame;
        const realCaf = (global as any).cancelAnimationFrame;
        (global as any).requestAnimationFrame = undefined;
        (global as any).cancelAnimationFrame = undefined;
        const acc = createStreamAccumulator();
        acc.append('Z', { kind: 'text' });
        await Promise.resolve();
        expect(acc.state.text).toBe('Z');
        (global as any).requestAnimationFrame = realRaf;
        (global as any).cancelAnimationFrame = realCaf;
    });

    it('finalize cancels a queued fallback microtask before flushing', async () => {
        const realRaf = (global as any).requestAnimationFrame;
        const realCaf = (global as any).cancelAnimationFrame;
        (global as any).requestAnimationFrame = undefined;
        (global as any).cancelAnimationFrame = undefined;

        const acc = createStreamAccumulator();
        acc.append('queued', { kind: 'text' });
        acc.finalize();
        const finalizedVersion = acc.state.version;
        await Promise.resolve();

        expect(acc.state.text).toBe('queued');
        expect(acc.state.version).toBe(finalizedVersion);
        (global as any).requestAnimationFrame = realRaf;
        (global as any).cancelAnimationFrame = realCaf;
    });

    it('uses the timeout cancellation fallback when cancelAnimationFrame is missing', () => {
        const realRaf = (global as any).requestAnimationFrame;
        const realCaf = (global as any).cancelAnimationFrame;
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        (global as any).requestAnimationFrame = vi.fn(() => 42);
        (global as any).cancelAnimationFrame = undefined;

        const acc = createStreamAccumulator();
        acc.append('queued', { kind: 'text' });
        acc.finalize();

        expect(clearTimeoutSpy).toHaveBeenCalledWith(42);
        expect(acc.state.text).toBe('queued');
        (global as any).requestAnimationFrame = realRaf;
        (global as any).cancelAnimationFrame = realCaf;
        clearTimeoutSpy.mockRestore();
    });

    it('provides the convenience accumulator factory', () => {
        const acc = useStreamAccumulator();

        expect(acc.state.isActive).toBe(true);
        expect(acc.state.text).toBe('');
    });
});

describe('long stream scheduling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
            setTimeout(() => cb(performance.now()), 16));
        vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('flushes every frame below the threshold', () => {
        const acc = createStreamAccumulator();
        for (let i = 0; i < 10; i++) {
            acc.append('x', { kind: 'text' });
            vi.advanceTimersByTime(16);
        }
        expect(acc.state.text).toBe('x'.repeat(10));
        expect(acc.state.version).toBe(10);
    });

    it.each([
        [20_000, 80, 'text'],
        [60_000, 125, 'text'],
        [20_000, 80, 'reasoning'],
        [60_000, 125, 'reasoning'],
    ] as const)('throttles %i characters at %i ms for %s', (size, gap, kind) => {
        const acc = createStreamAccumulator();
        acc.append('a'.repeat(size), { kind });
        vi.advanceTimersByTime(16);
        acc.append('b', { kind });
        acc.append('c', { kind });
        vi.advanceTimersByTime(gap - 1);
        expect(acc.state.version).toBe(1);
        vi.advanceTimersByTime(17);
        expect(acc.state.version).toBe(2);
        expect(kind === 'text' ? acc.state.text : acc.state.reasoningText).toBe('a'.repeat(size) + 'bc');
    });

    it.each(['finalize', 'reset', 'hydrate'] as const)('%s cancels delayed work', (operation) => {
        const acc = createStreamAccumulator();
        acc.append('a'.repeat(20_000), { kind: 'text' });
        vi.advanceTimersByTime(16);
        acc.append('stale', { kind: 'text' });
        if (operation === 'hydrate') acc.hydrate({ text: 'saved' });
        else acc[operation]();
        const expected = operation === 'finalize' ? 'a'.repeat(20_000) + 'stale' : operation === 'hydrate' ? 'saved' : '';
        const version = acc.state.version;
        vi.advanceTimersByTime(300);
        expect(acc.state.text).toBe(expected);
        expect(acc.state.version).toBe(version);
    });

    it('combines committed and pending channels when choosing a threshold', () => {
        const acc = createStreamAccumulator();
        acc.append('a'.repeat(19_000), { kind: 'text' });
        vi.advanceTimersByTime(16);
        acc.append('b'.repeat(1_000), { kind: 'reasoning' });
        vi.advanceTimersByTime(79);
        expect(acc.state.reasoningText).toBe('');
        vi.advanceTimersByTime(17);
        expect(acc.state.reasoningText).toBe('b'.repeat(1_000));
    });

    it.each([[11_000, 16], [35_000, 96]])('counts a %i-character reasoning replacement once', (size, delay) => {
        const acc = createStreamAccumulator();
        const reasoning = 'r'.repeat(size);
        acc.append(reasoning, { kind: 'reasoning' });
        vi.advanceTimersByTime(16);
        acc.replaceReasoning(reasoning + '!');
        vi.advanceTimersByTime(delay);
        expect(acc.state.reasoningText.length).toBe(size + 1);
        expect(acc.state.reasoningText.endsWith('!')).toBe(true);
    });

    it('does not publish before a fractional deadline even if a frame arrives early', () => {
        let now = 0.2;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        let callback: FrameRequestCallback | undefined;
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { callback = cb; return 1; });
        const acc = createStreamAccumulator();
        acc.append('a'.repeat(20_000), { kind: 'text' });
        callback!(now);
        now = 1.5;
        acc.append('b', { kind: 'text' });
        vi.advanceTimersByTime(79);
        now = 80.1;
        callback?.(now);
        expect(acc.state.text).toBe('a'.repeat(20_000));
        now = 81;
        vi.advanceTimersByTime(20);
        callback?.(now);
        expect(acc.state.text).toBe('a'.repeat(20_000) + 'b');
        vi.restoreAllMocks();
    });

    it('counts flushes for sustained long input', () => {
        const acc = createStreamAccumulator();
        acc.hydrate({ text: 'a'.repeat(60_000) });
        const start = acc.state.version;
        for (let i = 0; i < 100; i++) {
            acc.append('x', { kind: 'text' });
            vi.advanceTimersByTime(16);
        }
        acc.finalize();
        console.log('sustained flush count:', acc.state.version - start - 1);
        expect(acc.state.text).toBe('a'.repeat(60_000) + 'x'.repeat(100));
        expect(acc.state.version - start).toBeLessThan(30);
    });
});
