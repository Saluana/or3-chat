/**
 * Unified streaming accumulator (Task 1 – Unified Streaming Core)
 * Minimal rAF‑batched token buffer replacing legacy useTailStream + ad hoc refs.
 *
 * Responsibilities:
 *  - Collect incoming text / reasoning deltas via append()
 *  - Batch DOM/reactive writes to ≤1 per animation frame
 *  - Provide finalize() with success / error / abort semantics (idempotent)
 *  - Expose readonly reactive StreamingState for UI consumption
 */
import { reactive, toRefs } from 'vue';

export interface StreamingState {
    text: string;
    reasoningText: string;
    isActive: boolean;
    finalized: boolean;
    error: Error | null;
    version: number; // increments on each flush for lightweight watchers
}

export type AppendKind = 'text' | 'reasoning';

export interface StreamAccumulatorApi {
    state: Readonly<StreamingState>;
    append(delta: string, options: { kind: AppendKind }): void;
    finalize(opts?: { error?: Error; aborted?: boolean }): void; // idempotent
    reset(): void; // prepare for a fresh stream
}

// Fallback rAF for SSR / test environments
const HAS_RAF = typeof requestAnimationFrame !== 'undefined';
const _raf:
    | typeof requestAnimationFrame
    | ((cb: FrameRequestCallback) => number) = HAS_RAF
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) =>
          setTimeout(() => cb(performance.now()), 0) as any;
const _caf: typeof cancelAnimationFrame | ((id: number) => void) = HAS_RAF
    ? cancelAnimationFrame
    : (id: number) => clearTimeout(id);

export function createStreamAccumulator(): StreamAccumulatorApi {
    const state = reactive<StreamingState>({
        text: '',
        reasoningText: '',
        isActive: true,
        finalized: false,
        error: null,
        version: 0,
    });

    let pendingMain: string[] = [];
    let pendingReasoning: string[] = [];
    let frame: number | null = null;
    let _finalized = false;
    let emptyAppendWarnings = 0;

    function flush() {
        frame = null;
        if (pendingMain.length) {
            state.text += pendingMain.join('');
            pendingMain = [];
        }
        if (pendingReasoning.length) {
            state.reasoningText += pendingReasoning.join('');
            pendingReasoning = [];
        }
        state.version++;
    }

    function schedule() {
        if (frame != null || _finalized) return;
        if (!HAS_RAF) {
            // In test / SSR environments without rAF, schedule a microtask-ish flush quickly
            frame = _raf(() => flush());
            return;
        }
        frame = _raf(flush);
    }

    function append(delta: string, { kind }: { kind: AppendKind }) {
        if (_finalized) {
            if (import.meta.dev)
                console.warn('[stream] append after finalize ignored');
            return;
        }
        if (!delta) {
            if (import.meta.dev && ++emptyAppendWarnings <= 3) {
                console.warn('[stream] empty delta append ignored');
            }
            return;
        }
        if (kind === 'reasoning') pendingReasoning.push(delta);
        else pendingMain.push(delta);
        schedule();
    }

    function finalize(opts?: { error?: Error; aborted?: boolean }) {
        if (_finalized) return;
        _finalized = true;
        if (frame != null) {
            _caf(frame); // cancel pending frame then immediate flush
            frame = null;
        }
        if (pendingMain.length || pendingReasoning.length) flush();
        else state.version++;
        if (opts?.error) state.error = opts.error;
        state.isActive = false;
        state.finalized = true;
    }

    function reset() {
        if (frame != null) {
            _caf(frame);
            frame = null;
        }
        pendingMain = [];
        pendingReasoning = [];
        _finalized = false;
        emptyAppendWarnings = 0;
        state.text = '';
        state.reasoningText = '';
        state.error = null;
        state.isActive = true;
        state.finalized = false;
        state.version++;
    }

    return { state, append, finalize, reset };
}

// Convenience factory (future usage) - could be extended to support options
export function useStreamAccumulator() {
    return createStreamAccumulator();
}

export type { StreamingState as UnifiedStreamingState };
