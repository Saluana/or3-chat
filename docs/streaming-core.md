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

### Scroll Behavior

`useAutoScroll` gates snapping: only scrolls if user recently at bottom & not actively scrolling. Integration tests (Task 9) cover both stick & non-stick paths.

### Testing

-   Unit tests validate batching, finalize semantics, reasoning separation.
-   Performance test ensures ≤20 version bumps for 200 token burst.
-   Integration tests verify scroll stickiness rules.

### Follow Ups

-   Potential: expose streaming chunk event for plugin ecosystem.
-   Potential: memory cap / truncation strategy for extremely long reasoning traces.
