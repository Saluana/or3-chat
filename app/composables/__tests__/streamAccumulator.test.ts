import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStreamAccumulator } from '../useStreamAccumulator';

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
        expect(acc.state.finalized).toBe(true);
    });

    it('append after finalize ignored (R4)', async () => {
        const acc = createStreamAccumulator();
        acc.append('A', { kind: 'text' });
        acc.finalize();
        acc.append('B', { kind: 'text' });
        await nextFrame();
        expect(acc.state.text).toBe('A');
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

    it('fallback no-raf path flushes via timeout (simulated)', async () => {
        const realRaf = (global as any).requestAnimationFrame;
        const realCaf = (global as any).cancelAnimationFrame;
        (global as any).requestAnimationFrame = undefined;
        (global as any).cancelAnimationFrame = undefined;
        // Re-import module so HAS_RAF snapshot is false
        vi.resetModules();
        const mod = await import('../useStreamAccumulator');
        const acc = mod.createStreamAccumulator();
        acc.append('Z', { kind: 'text' });
        await new Promise((r) => setTimeout(r, 2));
        expect(acc.state.text).toBe('Z');
        (global as any).requestAnimationFrame = realRaf;
        (global as any).cancelAnimationFrame = realCaf;
    });
});
