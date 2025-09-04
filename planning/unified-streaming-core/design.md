# Unified Streaming Core Refactor - Design

Artifact ID: 9c7d3919-8203-49aa-98a6-57dd221ce0f5

## 1. Overview

This design consolidates fragmented streaming logic (legacy `useTailStream`, ad-hoc fields in `useAi.ts`, tail/handoff watchers in `ChatContainer.vue`) into a single minimalist accumulator: `createStreamAccumulator()`. The accumulator batches inbound token deltas (answer + optional reasoning) using `requestAnimationFrame` (rAF) to coalesce high-frequency events into ≤1 reactive write per frame. It exposes an immutable-ish reactive state consumed by UI. Legacy duplication (interval timers, `push/flush` semantics, tail overlay watchers) is removed.

Goals:

-   Single source of truth for streaming state.
-   Predictable finalization semantics.
-   Micro-batched updates for performance (reduced watcher churn & GC pressure).
-   Extensible channel tagging (main vs reasoning; future channels possible).

Non-goals: altering broader send pipeline logic, message normalization, virtualization algorithm; those are refactored elsewhere.

## 2. Architecture

```mermaid
graph TD
A[OpenRouter / Model Stream] -->|token delta| B[Stream Orchestrator (send loop)]
B -->|classify channel| C[Stream Accumulator]
C -->|rAF flush| D[Reactive StreamingState]
D --> E[ChatContainer.vue]
E --> F[ChatMessage.vue Rendering]
B -->|completion| C
C -->|finalize()| D
```

### Components

-   Stream Orchestrator: Existing loop in `useAi.ts` iterating over streamed events. Modified to invoke `append(delta, { kind })` instead of manual concatenation.
-   Stream Accumulator: New module (internal to `useAi.ts` or `composables/useStreamAccumulator.ts`). Handles buffering & flush scheduling.
-   StreamingState: Reactive object (likely `reactive<StreamingState>`) observed by UI.
-   UI Components (`ChatContainer.vue`, `ChatMessage.vue`): Simplified to read `streamState` and render placeholder message while `isActive`.

## 3. Data Model & Types

```ts
export interface StreamingState {
    text: string; // Main answer text accumulated
    reasoningText: string; // Optional reasoning channel
    isActive: boolean; // True during active streaming (pre-finalize)
    finalized: boolean; // True after finalize() (success, abort, or error)
    error: Error | null; // Non-null on error
    version: number; // Incremented on each flush for granular watchers
}

export type AppendKind = 'text' | 'reasoning';

export interface StreamAccumulatorApi {
    state: Readonly<StreamingState>;
    append(delta: string, options: { kind: AppendKind }): void;
    finalize(opts?: { error?: Error; aborted?: boolean }): void; // Idempotent
    reset(): void; // Prepare for a new stream (clears state except version++ optional)
}
```

Notes:

-   `version` allows watchers to trigger (e.g., scroll) without deep watching strings directly.
-   `reset()` can be used between sequential sends if desired.

## 4. Internal Algorithm

### Batching

-   Incoming `append()` calls push tuples to an in-memory staging buffer `{ main: string[], reasoning: string[] }`.
-   If no frame pending, schedule `requestAnimationFrame(flush)`. In SSR or test environment lacking rAF, fallback to `setTimeout(flush, 0)`.
-   `flush()` concatenates staged arrays into the state fields (single mutation per field if there is content) and increments `version` once.
-   After `finalize()`, `append()` becomes a no-op (dev warning if invoked).

### Finalization

```
finalize({ error, aborted }) steps:
1. If already finalized -> return.
2. If a frame is pending, synchronously run `flush()` first to drain remaining staged content.
3. If error provided -> set state.error = error.
4. Set state.isActive = false; state.finalized = true.
```

### Error vs Abort

-   Abort: `aborted: true` passed; no `error` set.
-   Error: `error` passed; sets `error`, still flushes buffers.

### Reasoning Channel

-   Classification occurs outside accumulator (the orchestrator decides kind).
-   Accumulator just stores into appropriate staging array.

## 5. Pseudocode

```ts
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
    let finalized = false;

    function schedule() {
        if (frame != null || finalized) return;
        frame = (
            typeof requestAnimationFrame !== 'undefined'
                ? requestAnimationFrame
                : (cb: FrameRequestCallback) =>
                      setTimeout(() => cb(performance.now()), 0)
        )(flush);
    }

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

    function append(delta: string, { kind }: { kind: AppendKind }) {
        if (finalized) {
            if (import.meta.dev)
                console.warn('[stream] append after finalize ignored');
            return;
        }
        if (!delta) return;
        if (kind === 'reasoning') pendingReasoning.push(delta);
        else pendingMain.push(delta);
        schedule();
    }

    function finalize(opts?: { error?: Error; aborted?: boolean }) {
        if (finalized) return;
        finalized = true;
        // If a frame is scheduled, flush immediately to avoid dropping trailing tokens.
        if (frame != null) {
            if (typeof cancelAnimationFrame !== 'undefined')
                cancelAnimationFrame(frame);
            flush();
        } else {
            // Ensure any unflushed tokens flush at least once.
            if (pendingMain.length || pendingReasoning.length) flush();
        }
        if (opts?.error) state.error = opts.error;
        state.isActive = false;
        state.finalized = true;
    }

    function reset() {
        finalized = false;
        if (frame != null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(frame);
            frame = null;
        }
        pendingMain = [];
        pendingReasoning = [];
        state.text = '';
        state.reasoningText = '';
        state.error = null;
        state.isActive = true;
        state.finalized = false;
        state.version++;
    }

    return { state, append, finalize, reset };
}
```

## 6. Integration Points

### Modifications in `useAi.ts` (send loop)

-   Replace manual `streamDisplayText += delta` style writes with `acc.append(delta, { kind })`.
-   On stream completion: `acc.finalize()`.
-   On error: `acc.finalize({ error })`.
-   On abort: `acc.finalize({ aborted: true })`.
-   Expose `streamState = acc.state` to components.

### Removal of `useTailStream.ts`

-   Delete file.
-   Remove imports from any module referencing it.
-   Remove legacy config constants (interval durations) if exclusive to that logic.

### `ChatContainer.vue`

-   Replace multi-watcher tail gating logic with:

```ts
const streamingMessage = computed(() =>
    streamState.isActive
        ? {
              role: 'assistant',
              id: currentPendingId,
              text: streamState.text,
              reasoning_text: streamState.reasoningText || undefined,
              streaming: true,
          }
        : null
);
```

-   Template renders `streamingMessage` (if not null) before finalized assistant message appears (final message commit occurs elsewhere when persisted).
-   Remove obsolete refs: `handoff`, `tailDisplay`, `tailReasoning`, `finalizedOnce` (if only for tail management).
-   Auto-scroll effect watches `[messages.length, streamState.version]`.

## 7. Error Handling Strategy

-   Distinguish three terminal cases: success, abort, error.
-   UI logic: if `state.error` -> show error indicator (existing style), else if finalized and no text -> show empty response fallback.
-   Logging: dev warnings for misuse (append after finalize, finalize twice).

## 8. Testing Strategy

### Unit Tests (Accumulator)

Cases:

1. Batches multiple appends in same tick (spy on version increments).
2. Separate frames increment version sequentially.
3. Reasoning vs main channels stored correctly.
4. Finalize flushes pending tokens.
5. Finalize idempotent.
6. Append after finalize ignored.
7. Error finalization sets error and final flush performed.
8. Abort finalization has no error.
9. Reset clears buffers and marks active again.

### Integration Tests

1. Mock stream (array of text tokens) -> final output equals baseline legacy captured snapshot.
2. Interleaved reasoning + main tokens ordering preserved.
3. Aborted stream still shows partial text.
4. Auto-scroll unaffected (simulate bottom vs scrolled-up state, ensure no forced scroll when scrolled up).

### Performance Harness

-   Simulate 200 tokens with micro-delays (<5ms) -> measure `version` increments; assert ≤20.

### Hook Order Snapshot

-   Before refactor capture `onToken`, `onFinalize` (or equivalent) hook invocation order; after refactor compare arrays.

## 9. Migration Plan (Phased)

1. Add accumulator implementation & unit tests (unused yet).
2. Integrate into `useAi.ts` behind feature flag (e.g., `const USE_NEW_STREAM=true`) for quick fallback.
3. Adapt orchestrator to call `append` & `finalize` while still updating legacy fields (dual write) -> run regression snapshot test.
4. Remove legacy tail logic and `useTailStream.ts` once parity confirmed.
5. Drop dual write + feature flag.
6. Simplify `ChatContainer.vue` watchers & template.
7. Remove now-unused constants / helpers.
8. Clean up documentation & finalize tests.

## 10. Performance Considerations

-   rAF batching reduces reactivity flushes from O(tokens) to O(frames). For typical 30–60 tokens/sec, expect ~30–60 flushes -> With micro-batching of multiple tokens per frame, often fewer.
-   String concatenation remains linear; no additional intermediate arrays beyond staging lists.
-   Avoids setInterval timers (reduced wake-ups & GC).

## 11. Security / Privacy

-   No new storage locations; transient buffers only.
-   No logging of raw token content beyond dev warnings for misuse (avoid including token text in warnings).

## 12. Future Extensions

-   Support channel priorities (e.g., render reasoning collapsed until finalization).
-   Add `onFlush` callback injection for analytics instrumentation.
-   Token-level instrumentation (expose counts) for adaptive latency indicators.

## 13. Open Questions (Deferred)

-   Should final assistant message persist directly from accumulator state or continue building separately? (Deferred to message normalization refactor.)
-   Do we need backpressure if tokens arrive faster than frame budget? (Currently acceptable; revisit if models accelerate.)

## 14. Acceptance Gate

Refactor accepted when requirements R1–R12 pass tests and legacy code fully purged.

## 15. Appendix: Legacy Removal Checklist

-   [ ] Delete `useTailStream.ts`.
-   [ ] Remove references in `ChatContainer.vue`, `useAi.ts`.
-   [ ] Delete constants: `TAIL_PUSH_INTERVAL`, `TAIL_FLUSH_INTERVAL` (names TBD once confirmed).
-   [ ] Remove watchers exclusively tied to legacy tail gating.
-   [ ] Confirm grep for `tailStream` returns zero results.
