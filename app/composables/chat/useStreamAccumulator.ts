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
import { reactive } from 'vue';

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

// Resolve rAF/CAF dynamically to honor test-time stubs and late availability
function nowTs() {
    try {
        return (globalThis.performance?.now?.() as number) ?? Date.now();
    } catch {
        return Date.now();
    }
}
function getRAF(): (cb: FrameRequestCallback) => number {
    const raf = (globalThis as any).requestAnimationFrame as
        | undefined
        | ((cb: FrameRequestCallback) => number);
    if (typeof raf === 'function') return raf;
    return (cb: FrameRequestCallback) =>
        setTimeout(() => cb(nowTs()), 0) as any;
}
function getCAF(): (id: number) => void {
    const caf = (globalThis as any).cancelAnimationFrame as
        | undefined
        | ((id: number) => void);
    if (typeof caf === 'function') return caf;
    return (id: number) => clearTimeout(id);
}

export function createStreamAccumulator(): StreamAccumulatorApi {
    const state = reactive<StreamingState>({
        text: '',
        reasoningText: '',
        isActive: true,
        finalized: false,
        error: null,
        version: 0,
    });
    // TODO(normalization): Future message normalization pass will consolidate assistant
    // message text assembly so accumulator text piping can directly hydrate persisted
    // message content without duplicate string concatenation in useChat.

    let pendingMain: string[] = [];
    let pendingReasoning: string[] = [];
    let frame: number | null = null;
    let microtaskToken: object | null = null;
    let _finalized = false;
    let emptyAppendWarnings = 0;
    
    // Track accumulated lengths to warn on excessive memory use
    const MAX_REASONABLE_LENGTH = 100_000; // 100KB of text
    let warnedAboutSize = false;

    function flush() {
        frame = null;
        microtaskToken = null;
        if (pendingMain.length) {
            state.text += pendingMain.join('');
            pendingMain = [];
        }
        if (pendingReasoning.length) {
            state.reasoningText += pendingReasoning.join('');
            pendingReasoning = [];
        }
        
        // Warn if accumulator grows too large (potential memory issue)
        if (!warnedAboutSize && import.meta.dev) {
            const totalLen = state.text.length + state.reasoningText.length;
            if (totalLen > MAX_REASONABLE_LENGTH) {
                console.warn('[stream] Accumulator exceeds 100KB', {
                    textLen: state.text.length,
                    reasoningLen: state.reasoningText.length,
                });
                warnedAboutSize = true;
            }
        }
        
        state.version++;
    }

    function schedule() {
        if (frame != null || microtaskToken != null || _finalized) return;
        // Prefer real rAF if available; otherwise, queue a microtask (cancelable via token)
        if (typeof (globalThis as any).requestAnimationFrame === 'function') {
            const raf = getRAF();
            frame = raf(flush);
            return;
        }
        const token = {};
        microtaskToken = token;
        queueMicrotask(() => {
            if (microtaskToken !== token) return; // canceled
            microtaskToken = null;
            flush();
        });
    }

    /** Ensure stream not already finalized. Returns false if already finalized. */
    function ensureNotFinalized(op: string): boolean {
        if (_finalized) {
            if (import.meta.dev) {
                console.warn(`[stream] ${op} after finalize ignored`);
            }
            return false;
        }
        return true;
    }

    function append(delta: string, { kind }: { kind: AppendKind }) {
        if (!ensureNotFinalized('append')) return;
        if (!delta) {
            if (import.meta.dev && ++emptyAppendWarnings <= 3) {
                console.warn(
                    '[stream] empty delta append ignored (possible upstream tokenization issue)'
                );
            }
            return;
        }
        if (kind === 'reasoning') pendingReasoning.push(delta);
        else pendingMain.push(delta);
        schedule();
    }

    function finalize(opts?: { error?: Error; aborted?: boolean }) {
        if (!ensureNotFinalized('finalize')) return;
        _finalized = true;
        if (frame != null) {
            const caf = getCAF();
            caf(frame); // cancel pending frame then immediate flush
            frame = null;
        }
        if (microtaskToken) {
            // Cancel pending microtask flush
            microtaskToken = null;
        }
        if (pendingMain.length || pendingReasoning.length) flush();
        else state.version++;
        if (opts?.error) state.error = opts.error;
        state.isActive = false;
        state.finalized = true;
    }

    function reset() {
        if (frame != null) {
            const caf = getCAF();
            caf(frame);
            frame = null;
        }
        if (microtaskToken) microtaskToken = null;
        pendingMain = [];
        pendingReasoning = [];
        _finalized = false;
        emptyAppendWarnings = 0;
        warnedAboutSize = false; // Reset warning flag
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
