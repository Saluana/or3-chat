/**
 * @module composables/chat/useStreamAccumulator
 *
 * **Purpose**
 * Provides a minimal, RAF-batched streaming text accumulator for chat message generation.
 * Replaces legacy `useTailStream` and ad-hoc reactive refs with a unified, performant solution.
 * Accumulates text and reasoning deltas from LLM streams and batches reactive updates to
 * minimize DOM thrashing and Vue reactivity overhead.
 *
 * **Responsibilities**
 * - Accumulate text and reasoning deltas via `append(delta, { kind })`
 * - Batch DOM/reactive writes to ≤1 per animation frame using RAF
 * - Provide `finalize()` with success/error/abort semantics (idempotent)
 * - Expose readonly reactive `StreamingState` for UI consumption
 * - Track version counter for lightweight change detection
 * - Warn on excessive memory accumulation (>100KB) in dev mode
 *
 * **Non-responsibilities**
 * - Does NOT handle network streaming or fetch (see openRouterStream, useAi)
 * - Does NOT persist messages to DB (see useAi message persistence)
 * - Does NOT manage UI rendering (see ChatMessage.vue, StreamingMessage.vue)
 * - Does NOT handle abort signals (caller manages AbortController)
 *
 * **State Lifecycle**
 * - Create: `createStreamAccumulator()` returns fresh accumulator with `isActive: true`
 * - Append: `append(delta, { kind })` buffers deltas and schedules RAF flush
 * - Finalize: `finalize({ error?, aborted? })` commits pending, sets `isActive: false`, `finalized: true`
 * - Reset: `reset()` clears state and prepares for new stream (reusable accumulator)
 *
 * **Performance**
 * - RAF batching reduces reactive updates from ~100/sec to ~60/sec (one per frame)
 * - Expected token rate: 10-100 tokens/sec from LLM (depends on model speed)
 * - Memory: typical message accumulates 1-10KB, warns at 100KB
 * - Version counter: increments on every flush (used by watchers)
 *
 * **Error Handling**
 * - `finalize({ error })` sets `state.error` and `finalized: true`
 * - Append/finalize after finalize are ignored with dev-mode warnings
 * - RAF cancellation is idempotent (safe to call multiple times)
 *
 * **Testing Strategy**
 * - Unit tests: verify RAF batching reduces mutation count
 * - Unit tests: verify finalize is idempotent
 * - Unit tests: verify reset clears state
 * - Integration tests: verify correct text accumulation from event sequences
 * - Performance tests: measure update latency under high token throughput
 *
 * **Migration Notes**
 * - Replaces `useTailStream` (deprecated)
 * - `UnifiedStreamingState` type alias is deprecated; use `StreamingState` instead
 */

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
function nowTs(): number {
    try {
        return globalThis.performance.now();
    } catch {
        return Date.now();
    }
}
type GlobalWithRAF = typeof globalThis & {
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (id: number) => void;
};

function getRAF(): (cb: FrameRequestCallback) => number {
    const g = globalThis as GlobalWithRAF;
    if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame;
    return (cb: FrameRequestCallback) =>
        setTimeout(() => cb(nowTs()), 0) as unknown as number;
}
function getCAF(): (id: number) => void {
    const g = globalThis as GlobalWithRAF;
    const caf = g.cancelAnimationFrame;
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
        if (typeof (globalThis as GlobalWithRAF).requestAnimationFrame === 'function') {
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

/**
 * @deprecated Use `StreamingState` instead. This alias exists for backward compatibility
 * with code that was written during the migration from legacy streaming infrastructure.
 * It will be removed in a future release.
 *
 * **Migration Guide**
 * Replace:
 * ```ts
 * import type { UnifiedStreamingState } from '~/composables/chat/useStreamAccumulator';
 * ```
 * With:
 * ```ts
 * import type { StreamingState } from '~/composables/chat/useStreamAccumulator';
 * ```
 */
export type { StreamingState as UnifiedStreamingState };
