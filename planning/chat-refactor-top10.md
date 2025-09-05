# Chat Codebase Reduction & Simplification Plan (Top 10 Targets)

Goal: Remove ≥1000 lines of chat-related code (without loss of features) by consolidating logic, deleting dead paths, extracting reusable primitives, and eliminating redundant watchers / state. This document enumerates the ten highest‑impact surgical refactors before implementation. Each item lists: What / Where / Why / How / Est. Lines / Perf Impact / Risk & Mitigation / Step Outline.

> Scope analyzed: `ChatMessage.vue`, `ChatContainer.vue`, `useAi.ts`, `useTailStream.ts`, `useOpenrouter.ts` (plus obvious collateral utilities they depend on). File excerpts intentionally paraphrased; do not implement yet.

## Summary Table

| #   | Theme                                | Primary Files                                       | Est. Lines Saved |
| --- | ------------------------------------ | --------------------------------------------------- | ---------------- |
| 1   | Unified Streaming Core               | `useAi.ts`, `useTailStream.ts`, `ChatContainer.vue` | 220–260          |
| 2   | Early Message Normalization          | `useAi.ts`, `ChatContainer.vue`, `ChatMessage.vue`  | 120–160          |
| 3   | Attachment & Thumbnail Composable    | `ChatMessage.vue`                                   | 130–170          |
| 4   | Watcher Consolidation & Effects      | `ChatContainer.vue`, `ChatMessage.vue`              | 110–150          |
| 5   | Reasoning Stream Path Simplification | `useAi.ts`, `ChatContainer.vue`, `ChatMessage.vue`  | 70–110           |
| 6   | PKCE Auth Utility Extraction         | `useOpenrouter.ts`                                  | 60–80            |
| 7   | Send Pipeline Modularization         | `useAi.ts`                                          | 160–220          |
| 8   | File Hash / Image Logic Unification  | `useAi.ts`, `ChatMessage.vue`                       | 80–120           |
| 9   | Scroll & Layout Simplification       | `ChatContainer.vue`                                 | 100–140          |
| 10  | Dead / Debug / Placeholder Purge     | All listed files                                    | 130–170          |
|     | **Total (de‑duped overlap)**         |                                                     | **≈1180–1580**   |

---

## 1. Unified Streaming Core (Eliminate legacy `useTailStream` + inline duplicates)

**Where**: `useTailStream.ts`, streaming state slices in `useAi.ts`, tail handling & watchers in `ChatContainer.vue`.

**Current**: We have a legacy `useTailStream` composable (push/flush interval) while `useChat` already embeds a bespoke streaming accumulator (`streamDisplayText`, `streamReasoning`, manual loop with write interval constants). `ChatContainer.vue` duplicates tail gating logic (recent vs virtual lists, `handoff`, multiple watchers to sync scroll). This double abstraction adds branching & state surfaces.

**Proposal**: Create a single minimal streaming state manager inside `useChat` (or extract `useStreamAccumulator`) that:

-   Maintains `text` + optional `reasoning` + `isActive` + `error`.
-   Provides `append(delta, { kind: 'reasoning' | 'text' })` and internal micro-batching with `requestAnimationFrame` (drop interval timer & buffer array complexity).
-   Emits a unified reactive object consumed directly by UI components.
-   Remove `useTailStream.ts` entirely and the placeholder integration logic in `ChatContainer.vue` (handoff, height lock branches, finalize heuristics).

**Why**: Cuts parallel buffering logic & watchers; reduces cognitive load (one source of truth). Avoids double flush semantics and reduces reactivity churn.

**How**: Inline simplified accumulator into `useChat` (≈40 LOC). Delete `useTailStream.ts` (≈90 LOC) + remove tail wrapper watchers (≈120+ LOC). Renormalize `ChatContainer.vue` streaming message omission logic to a single computed that either shows the in-progress assistant stub or the tail overlay.

**Est. Lines Saved**: 220–260.

**Perf Impact**: Fewer timers & watchers → less GC pressure, fewer string concatenations. Using rAF flush keeps UI responsive.

**Risks**: Subtle ordering differences for final flush; potential race on finalization. Mitigate with a dedicated `finalize()` call after stream iteration completes.

**Steps**:

1. Extract minimal accumulator interface.
2. Replace existing loop writes with `append` API.
3. Remove `useTailStream.ts`; update imports.
4. Simplify UI tail overlay/handoff logic.
5. Add regression test: streamed tokens accumulate identically to legacy path.

---

## 2. Early Message Normalization (Single internal representation)

**Where**: `useAi.ts` (build parts, arrays vs strings), `ChatContainer.vue` (mapping to `RenderMessage`), `ChatMessage.vue` (assistant content fallback logic).

**Current**: Messages oscillate between arrays of parts and plain strings. Container transforms to `RenderMessage` narrowing to string; `ChatMessage.vue` still defends against arrays. Extra watchers exist just to adapt shapes.

**Proposal**: Perform normalization at the boundary (post-build / pre-push) in `useChat`: always store assistant & user messages with a canonical shape `{ role, id, text: string, file_hashes, reasoning_text? }`. Provide a translation layer only for API payload building. UI components only read `.text`.

**Why**: Removes repeated content shape checks and fallback code, simplifies watchers, reduces cognitive overhead.

**How**: Add tiny helpers: `partsToText(parts)`, `ensureUiMessage(msg)`. Remove mapping code in `ChatContainer.vue` converting arrays to strings; directly expose reactive array already normalized.

**Est. Lines Saved**: 120–160.

**Perf Impact**: Fewer computed string concatenations & conditional branches; reduced garbage from map transforms each render.

**Risks**: Any plugins expecting array `content` may break. Provide backward compat: keep original raw messages for hook/filter pipeline (store under a non-reactive symbol or separate array) until migration complete.

**Steps**:

1. Introduce canonical interface `UiChatMessage`.
2. Normalize at message creation (`sendMessage`, `retryMessage`).
3. Remove array defensive code in `ChatMessage.vue`.
4. Add compatibility accessor for legacy hooks.

---

## 3. Attachment & Thumbnail Composable Extraction

**Where**: `ChatMessage.vue`.

**Current**: File hashing, thumb caches, ref counting, PDF meta, inline hydration, watchers, and expansion toggles all inline inside the component. Large reactive scaffolding (≈180+ LOC) dominated by infrastructure not specific to rendering.

**Proposal**: Create `useMessageAttachments(hashes: Ref<string[]>)` composable returning:

```ts
{
    thumbnails,
        pdfMeta,
        ensureThumb,
        retainAll,
        releaseAll,
        firstThumb,
        expanded;
}
```

Encapsulate: cache maps, ref counting, PDF name logic, truncated display names, inline image hydration (export a `hydrate(containerEl)`), and expansion state (persistable via message id). Component shrinks to declarative usage.

**Why**: Reduces component bloat, improves testability, isolates side-effects (object URL creation/release).

**How**: Move logic & watchers to composable; keep global caches as implementation detail. Provide lifecycle hooks: `onMounted(() => retainAll())`, `onBeforeUnmount(() => releaseAll())` inside composable or via returned functions.

**Est. Lines Saved**: Net -130 to -170 (after adding ~70 LOC composable and deleting ~220 LOC duplicated/blended code & comments).

**Perf Impact**: No negative; slightly less reactive churn by scoping watchers.

**Risks**: Improper cleanup could leak object URLs. Mitigate with unit test verifying ref counts decrement to zero after unmount.

**Steps**:

1. Extract logic.
2. Replace inline watchers with composable-managed ones.
3. Add test: mount/unmount message with attachments ensures cleanup.

---

---

## 5. Reasoning Stream Path Simplification

**Where**: `useAi.ts` (`streamReasoning`), `ChatContainer.vue` (tail reasoning gating), `ChatMessage.vue` (isStreamingReasoning).

**Current**: `reasoning_text` optional path with special watchers / flags (`finalizedOnce`, `handoff`) while actual reasoning pipeline isn't fully implemented (placeholders & ellipses). Adds branching without clear UI divergence.

**Proposal**: Unify reasoning into the same streaming accumulator with metadata tags: each append has `{ channel: 'main' | 'reasoning' }`. UI renders reasoning block if non-empty prior to finalization. Remove bespoke flags except a single `streamState.finalized:boolean`.

**Why**: Eliminates branching & watchers tied to reasoning presence and reduces tail overlay complexity.

**How**: Accumulator stores `mainText`, `reasoningText`. UI reads both from single reactive object.

**Est. Lines Saved**: 70–110.

**Perf Impact**: Fewer conditionals; simpler reactive graph.

**Risks**: If later models interleave reasoning tokens, ordering must be preserved. Mitigate by storing arrays of chunks per channel and join at display time.

**Steps**:

1. Replace separate refs with struct.
2. Remove reasoning-specific watchers.
3. Adjust finalization logic.

---

## 6. PKCE Auth Utility Extraction & Simplification

**Where**: `useOpenrouter.ts`.

**Current**: Inline code for PKCE generation, fallback, URL building, warning, and state persistence; includes try/catch blocks for sessionStorage operations, manual state creation.

**Proposal**: Extract to `auth/pkce.ts`:

```ts
export function buildPkceAuthUrl({ redirect, clientId, authBase }): {
    url;
    verifier;
};
```

Return computed URL + verifier. Composable handles only: call builder, store verifier/method/state (utility returns those), redirect. Consolidate duplicate try/catch into a single guarded helper `safeSessionSet(key,val)`.

**Why**: Reduces noise in login composable; isolates testable logic; eases migration if auth provider changes.

**How**: Move hashing & base64url encode helpers (10 LOC) + challenge builder (≈25 LOC). Remove debug console statements or guard behind `if (import.meta.dev)`.

**Est. Lines Saved**: 60–80.

**Perf Impact**: Negligible. Slightly faster due to fewer repeated string operations (minor).

**Risks**: Incorrect PKCE encoding could break login. Mitigate with unit test comparing output to known RFC7636 example vectors.

**Steps**:

1. Create utility with test.
2. Replace in composable.
3. Remove unused helpers from file.

---

## 7. Send Pipeline Modularization

**Where**: `useAi.ts` (`sendMessage` monster function + `retryMessage`).

**Current**: Large monolithic async function performing: thread creation, history loading, system prompt injection, file/image normalization, hash merging, hook filtering, DB writes, streaming loop, final persistence, hook notifications, error handling. Embedded duplication: repeated `ensureThreadHistoryLoaded`, repeated assistant placeholder updates, image detection logic, output filtering.

**Proposal**: Split into composable-level private pure helpers:

-   `prepareThread(state, content, pendingPromptId) -> threadId`
-   `normalizeOutgoing(content, files, extraTextParts) -> { parts, text, hashes }`
-   `buildModelPayload(messages, modelId, options) -> { orMessages, modalities }`
-   `persistUserMessage(...)`
-   `startAssistantPlaceholder(...)`
-   `streamAssistantReply(controller, callbacks)`
-   `finalizeAssistantMessage(...)`
-   `handleStreamError(...)`

Orchestrator `sendMessage()` becomes a readable 40–60 LOC sequence. Each helper ~15–30 LOC and testable in isolation.

**Why**: Improves maintainability, test coverage capability, drastically reduces inline comments / placeholder braces (`{…}`), and prunes duplicate code segments.

**How**: Refactor incrementally—extract helpers without changing behavior first (mechanical), then prune redundant logic (e.g., remove second history ensure). Remove placeholder ellipsis blocks and dead branches.

**Est. Lines Saved**: 160–220 (after accounting for new helper files ~80 LOC and removing ~300 inline LOC & comments & placeholder scopes).

**Perf Impact**: Similar run-time; potential micro-improvement due to earlier bailouts & reduced repeated transforms.

**Risks**: Migration mistakes could alter hook call order. Mitigate by snapshotting current order (unit test: record hook invocation sequence before refactor) and asserting unchanged.

**Steps**:

1. Add tests logging hook sequence for a simple send.
2. Extract helpers sequentially.
3. Remove duplicate calls & placeholders.

---

## 8. File Hash / Image Logic Unification

**Where**: `useAi.ts` (assistant hash merge, legacy image param normalization), `ChatMessage.vue` (hashList computation & parsing), `ChatContainer.vue` (file_hashes mapping logic).

**Current**: Multiple scattered implementations merging prior assistant file hashes, parsing serialized JSON, mapping images → attachments, trimming image counts. Re-computed in various places.

**Proposal**: Create `utils/files/attachments.ts`:

```ts
export function normalizeImagesParam(images): NormalizedAttachment[];
export function mergeAssistantFileHashes(prev, current): string[];
export function parseHashes(raw): string[]; // tolerant
```

Re-use everywhere. In UI, pass pre-parsed hash arrays so components skip parsing logic.

**Why**: Removes repeated try/catch JSON parsing and ad-hoc merging, simplifying both send path and rendering.

**How**: Inline functions moved to single utility; consumer code shrinks to single-line calls.

**Est. Lines Saved**: 80–120.

**Perf Impact**: Less repeated parsing & array copying. Minor positive.

**Risks**: Edge-case differences if legacy parsing tolerated malformed input silently. Keep tolerant semantics (return [] on error).

**Steps**:

1. Implement utility with exhaustive tests.
2. Replace inline logic.
3. Remove local helpers & JSON parse blocks.

---

## 9. Scroll & Layout Simplification

**Where**: `ChatContainer.vue` (bottom padding computation, multiple scroll scheduling functions, virtualization handshake with tail streaming).

**Current**: Complex interplay between `RECENT_NON_VIRTUAL`, dynamic bottom padding, handoff overlays, schedule functions (`scheduleScrollIfAtBottom`), multiple watchers for input height, tail changes, thread switches.

**Proposal**: Introduce `useChatViewport({ inputHeightRef, streamState, messageListRef })` composable:

-   Computes `bottomPad` (includes safe-area logic inside) and returns a stable `applyAutoScrollOnMutation()` method.
-   Integrates virtualization boundary logic in one place: returns `{ stableMessages, recentMessages, streamingMessage }`.
-   Single effect monitors changes & triggers `autoScroll.onContentIncrease()`.
    Eliminate `handoff`, `assistantVisible`, `heightLockApplied`, finalize heuristics; rely on streaming message always occupying a slot (virtual or recent) to avoid flicker.

**Why**: Removes orchestration details from template script; reduces watchers & state flags; easier maintenance.

**How**: Move logic out; template simply renders three arrays + maybe a streaming placeholder component.

**Est. Lines Saved**: 100–140.

**Perf Impact**: More predictable scroll; fewer layout thrashes by consolidating rAF scheduling.

**Risks**: Potential visual flicker if streaming placeholder enters virtualization early. Mitigate by reserving a fixed sentinel ID until finalization.

**Steps**:

1. Build composable replicating current grouping logic.
2. Remove obsolete flags & watchers.
3. Visual QA across mobile + desktop.

---

## 10. Dead / Debug / Placeholder Code Purge

**Where**: All listed files (numerous `{…}` elisions, commented debug sections, no-op watchers, empty template regions, leftover class computations).

**Current**: Many ellipsis placeholders inside try/catch or conditionals (e.g., `if (prevAssistant?.file_hashes) { try {…} catch {}}`), commented debug watchers, dev logging (`console.debug` without dev guard), empty `<div>` wrappers, style blocks with CSS fragments referencing missing selectors, incomplete computed returns (e.g., `const inputWrapperClass` returns incomplete ternary second branch).

**Proposal**:

-   Remove ellipsis placeholder blocks and either implement minimal logic or delete branch entirely if unreachable.
-   Guard necessary debug logs with `if (import.meta.dev)`.
-   Delete unused CSS selectors & stale class names.
-   Collapse empty wrappers or convert to fragments.
-   Replace incomplete computed returning undefined branch with explicit default.

**Why**: Shrinks codebase, clarifies intent, reduces confusion & potential runtime pitfalls (e.g., undefined class strings).

**How**: Static analysis pass + grep for `{…}` and `console.debug('OpenRouter` style logs, plus orphan CSS patterns like `.message-body )` fragments.

**Est. Lines Saved**: 130–170.

**Perf Impact**: Slight reduction in bundle size + parse time.

**Risks**: Accidentally deleting code that was mid-implementation. Mitigate with diff review & enabling a temporary ESLint rule forbidding raw `{…}` tokens.

**Steps**:

1. Automated grep & list candidate lines.
2. Manual triage & remove.
3. Run full build + integration smoke test.

---

## Aggregate Impact & Strategy

-   Conservative cumulative savings exceed target (≥1000 LOC) even after accounting for added utility/composable code (~200–260 LOC newly introduced).
-   Complexity reduction centers on: fewer reactive sources, standardized message shape, and composable extraction.
-   Implementation order should minimize regression risk by stabilizing internal APIs first (Items 7 → 2 → 1) before UI pruning (Items 3,4,5,9) and final cleanup (10,6,8 interleaved where safe).

### Recommended Execution Order (Dependency-Aware)

1. Snapshot tests for current send + stream + scroll + auth flows.
2. (7) Modularize send pipeline (safer internal first).
3. (2) Normalize messages.
4. (1) Unify streaming core (delete legacy tail stream).
5. (5) Reasoning simplification.
6. (8) File hash utilities.
7. (3) Attachment composable.
8. (4) Watcher consolidation.
9. (9) Viewport/layout simplification.
10. (6) PKCE utility extraction.
11. (10) Dead code purge final pass.

### Validation / Safeguards

-   Add unit tests: message send (text only, with images), retry, abort mid-stream, reasoning tokens (if available), PKCE URL generation.
-   Add integration test with mock OpenRouter stream producing interleaved reasoning + content tokens verifying finalization identical.
-   Performance snapshot (before vs after) measuring average token flush latency & re-render count (Vue DevTools / perf instrumentation).

### Potential Havoc & Mitigations

| Risk                                     | Mitigation                                                      |
| ---------------------------------------- | --------------------------------------------------------------- |
| Hook ordering changed                    | Hook sequence snapshot test pre-refactor                        |
| Streaming final token lost               | Ensure final `flush()` + `finalize()` called in `finally` block |
| Attachments leak object URLs             | Ref-count in composable; test unmount path                      |
| Scroll jumps for users scrolled up       | Guard auto-scroll with previous bottom state check              |
| Auth breakage (PKCE)                     | RFC test vectors for code challenge + manual login QA           |
| Legacy plugins expecting `content` array | Provide compatibility accessor or deprecation layer             |

---

## Appendix: Representative Code Smell Samples (Targets)

> (Illustrative snippets — do not modify yet.)

### Placeholder Ellipses

`useAi.ts`:

```ts
if (prevAssistant?.file_hashes) {
    try { … } catch {}
}
```

Action: Replace with `assistantHashes = parseHashes(prevAssistant.file_hashes)` or remove block if redundant.

### Redundant Watchers

`ChatContainer.vue`:

```ts
watch(() => tailDisplay.value, () => { … });
watch(() => tailReasoning.value, () => { … });
// Could be a single effect reacting to streamState.version
```

### Bloated Component Logic

`ChatMessage.vue` – thumb lifecycle, hydration, expansion all inline:

```ts
const thumbnails = reactive<Record<string, ThumbState>>({});
// many lines managing caches & watchers
```

Target: Move to `useMessageAttachments`.

### Incomplete Computed

`ChatContainer.vue`:

```ts
const inputWrapperClass = computed(() =>
    isMobile.value
        ? 'pointer-events-none fixed inset-x-0 bottom-0 z-40'
        : // Desktop: keep input scoped to its pane container
);
```

Action: Provide explicit desktop class or unify both paths.

### Multi-Role Content Shape Defensiveness

`ChatMessage.vue`:

```ts
if (typeof raw === 'string') return raw;
if (Array.isArray(raw)) {
    /* fallback */
}
```

Action: Remove after early normalization.

### Dispersed Image Detection

`useAi.ts`:

```ts
const hasImageInput = (modelInputMessages as any[]).some(...)
const modelImageHint = /image|vision|flash/i.test(modelId);
```

Action: Utility `detectImageModalities(messages, modelId)`.

### Unscoped Debug Logging

`useOpenrouter.ts`:

```ts
console.debug('OpenRouter PKCE redirect URL:', url);
```

Action: Wrap with `if (import.meta.dev)` or remove.

---

## Next Step

Await approval to begin phased implementation following order above. No code changes committed yet beyond this planning artifact.

---

Prepared by: Refactor Planning Assistant
Date: ${new Date().toISOString()}
