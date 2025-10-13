# useStreamAccumulator

Frame-batched accumulator for AI streaming tokens. It receives partial text/reasoning deltas, buffers them, and flushes at most once per animation frame so the UI stays smooth.

---

## Purpose

`useStreamAccumulator` replaces ad-hoc refs for building assistant responses. It normalises streaming flow with a single API:

-   `append()` collects text or reasoning deltas without immediate DOM churn
-   `finalize()` seals the stream and records errors/abort state
-   `reset()` prepares for the next stream
-   `state` exposes reactive fields (`text`, `reasoningText`, `isActive`, etc.) any component can watch

The accumulator automatically batches writes via `requestAnimationFrame` when available, falling back to microtasks in environments without rAF (tests, SSR stubs).

---

## Quick example

```ts
import { useStreamAccumulator } from '~/composables/chat/useStreamAccumulator';

const stream = useStreamAccumulator();

// Stream chunks coming from OpenRouter
stream.append('Hello', { kind: 'text' });
stream.append(', world!', { kind: 'text' });
stream.append('Considering user intent...', { kind: 'reasoning' });

// When the stream completes:
stream.finalize();

console.log(stream.state.text); // "Hello, world!"
```

---

## API

| Member                   | Type                                                                | Description                                                                                            |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `state`                  | `Readonly<StreamingState>`                                          | Reactive state object (see below).                                                                     |
| `append(delta, options)` | `(delta: string, options: { kind: 'text' \| 'reasoning' }) => void` | Queue a delta chunk for batching. Empty strings are ignored.                                           |
| `finalize(opts?)`        | `(opts?: { error?: Error; aborted?: boolean }) => void`             | Flush any pending chunks, mark the stream inactive/finalized, optionally capture an error. Idempotent. |
| `reset()`                | `() => void`                                                        | Cancel pending frames, clear buffers, and return the state to its initial active state.                |

### `StreamingState`

```ts
interface StreamingState {
    text: string;
    reasoningText: string;
    isActive: boolean;
    finalized: boolean;
    error: Error | null;
    version: number; // increments each flush for lightweight watchers
}
```

The composable exports `type UnifiedStreamingState = StreamingState` for consumers migrating from legacy code.

---

## Usage patterns

### Wiring into a stream handler

```ts
const accumulator = useStreamAccumulator();

async function handleChunk(chunk: StreamChunk) {
    if (chunk.type === 'text-delta') {
        accumulator.append(chunk.text, { kind: 'text' });
    } else if (chunk.type === 'reasoning-delta') {
        accumulator.append(chunk.reasoning, { kind: 'reasoning' });
    }
}

function handleComplete(error?: Error) {
    accumulator.finalize(error ? { error } : undefined);
}
```

### Reacting to flushes

```ts
watch(
    () => accumulator.state.version,
    () => {
        latestText.value = accumulator.state.text;
    }
);
```

### Reusing for multiple responses

```ts
accumulator.reset();
// start next stream by calling append() again
```

---

## Internals

1. **Batching** — Deltas are stored in `pendingMain` / `pendingReasoning` arrays until `flush()` concatenates and appends to `state`. `flush()` runs via rAF; if unavailable, a cancelable microtask is used.
2. **Idempotent finalize** — Calls after the first are no-ops (with dev warnings). `finalize()` cancels scheduled frames, flushes remaining buffers, flips `isActive` false, marks `finalized`, and sets `error` when provided.
3. **Reset logic** — Cancels pending frames/microtasks, clears buffers, resets state values, and bumps `version` so watchers notice the reset.
4. **Empty delta guard** — Ignores empty strings and warns (up to three times in dev) to highlight upstream tokenization issues.
5. **Environment-safe** — `getRAF()` / `getCAF()` resolve lazily so tests can stub them; SSR falls back to `setTimeout`.

---

## Tips & edge cases

-   **Multiple consumers**: `state` is reactive; share it across components without additional refs.
-   **Abort semantics**: Pass `finalize({ aborted: true })` if the stream was cancelled. Downstream UI can infer this from `state.isActive === false && state.finalized === true` plus the `aborted` flag you track externally.
-   **Error path**: Provide `finalize({ error })` to surface issues; UI can render the error based on `state.error`.
-   **Reset before reuse**: Always call `reset()` before starting another stream on the same accumulator.
-   **Performance**: Because flushing happens ≤ once per frame, high-frequency streams won’t thrash the DOM even when chunks arrive rapidly.

---

## Related modules

-   `useChat` — consumes this accumulator to build assistant messages.
-   Legacy `useTailStream` — superseded by this composable.
-   Streaming infrastructure in `~/core` — responsible for turning OpenRouter SSE events into `append()` calls.
