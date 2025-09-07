## Unified Streaming Core

This refactor replaces the legacy interval–based `useTailStream` + duplicated tail/handoff watchers in `ChatContainer.vue` with a single rAF–batched accumulator (`createStreamAccumulator`).

### Key Points

-   Single reactive state object: `{ text, reasoningText, isActive, finalized, error, version }`.
-   `append(delta,{kind})` buffers tokens per frame → ≤1 reactive write / frame.
-   `finalize({ error?, aborted? })` flushes & idempotently seals state.
-   UI consumes `streamState` directly; `ChatContainer.vue` uses one `streamingMessage` computed.
-   Auto-scroll driven by `messages.length` + `streamState.version` (no tail watchers).
-   Legacy files removed: `useTailStream.ts`, `TailStream.vue`.

### Benefits

-   Fewer watchers & conditionals → simpler mental model.
-   Reduced flicker: rAF batching eliminates rapid DOM churn.
-   Easier future extensions (image deltas, tool calls) by extending accumulator.

### Usage Sketch

```ts
const acc = createStreamAccumulator();
acc.append('Hello ', { kind: 'text' });
acc.append('[plan]', { kind: 'reasoning' });
// ... later
acc.finalize();
```

### Scroll / Auto-Scroll Behavior

Scrolling logic is now centralized in `VirtualMessageList.vue` (legacy `useAutoScroll` + `useRafBatch` removed). Snapping is gated by three conditions (`shouldAutoScroll`):

1. `stick` intent flag (cleared on deliberate upward user scroll >12px or leaving bottom threshold)
2. `atBottom` (distance to bottom <= configurable `autoScrollThreshold`, default 100px)
3. `!editingActive` (external suppression during in–place message editing)

Additional nuances:

-   Streaming maintenance: while `isStreaming` and `shouldAutoScroll` are true, we rAF‑batch `scrollToBottom` micro-adjusts (non-smooth) to keep the tail pinned without jank.
-   New message additions while auto-scroll eligible use a smooth scroll (batched) for better perceived continuity; markdown expansion / layout growth uses an immediate snap.
-   Dynamic average item size blending (70/30) refines virtualization estimation for large heterogeneous message sets.
-   Component emits `scroll-state { atBottom, stick }`, `reached-top`, `reached-bottom`, enabling higher-level orchestration without duplicating math.

Integration tests (Section 6.1 & 6.2) cover: streaming jank prevention, disengagement & re‑engagement, editing suppression, dynamic item size convergence, and virtualization stability during rapid appends.

### Testing

-   Unit tests validate batching, finalize semantics, reasoning separation.
-   Performance test ensures ≤20 version bumps for 200 token burst.
-   Integration tests verify scroll stickiness rules.

### Follow Ups

-   Potential: expose streaming chunk event for plugin ecosystem.
-   Potential: memory cap / truncation strategy for extremely long reasoning traces.
