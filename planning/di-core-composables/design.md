---
artifact_id: 2a7d2c8d-8c2f-4a2a-9d48-96b5d9adcc4c
title: Design - Core composables remediation (non-breaking)
status: draft
owner: core
date: 2026-02-01
---

# Goals

- Fix correctness and lifecycle issues called out in `planning/di-core-composables/dumb-issues.md`.
- Preserve public APIs and existing hook semantics.
- Keep hot paths fast (message loading, pane resize, token counts).

# Non-goals

- Large refactors of multi-pane architecture.
- Changing hook engine semantics.
- Reworking Dexie schema unless needed for a measured, justified improvement.

# Architecture

The changes are intentionally local to each composable, using existing OR3 patterns:

- Shared singletons are allowed when implemented via an explicit registry pattern (`globalThis` storage with HMR cleanup), as already used by `multiPaneApi` and other registries.
- Component lifecycle cleanup uses Vue’s effect scope disposal (`onScopeDispose`) when the composable is called inside a scope.

```mermaid
flowchart TD
  A[Component/Composable consumers] --> B[use* composables]
  B --> C[globalThis registries (when needed)]
  B --> D[Hooks engine ($hooks)]
  B --> E[Dexie db helpers]
  B --> F[Web Worker (tokenizer)]
```

# Detailed designs

## 1) `useLazyBoundaries`: move singleton to explicit registry + align types

### Problem
- Module-level singleton + module-level sets/maps can behave poorly under Nuxt HMR, leading to stale listeners.
- Duplicate divergent type `LazyBoundaryController` exists in implementation vs `types/lazy-boundaries.d.ts`.

### Design
- Replace module-level `lazyBoundariesInstance`, `moduleCache`, and `telemetryListeners` with a single registry object stored on `globalThis`.
- Provide explicit `resetLazyBoundariesForHMR()` invoked from `import.meta.hot.dispose` to clear registry state.
- Import and use `LazyBoundaryController` type from `types/lazy-boundaries.d.ts` to avoid divergence.

Registry shape:

```ts
type LazyBoundariesRegistry = {
  controller: LazyBoundaryController;
  moduleCache: Map<LazyBoundaryKey, Promise<unknown> | undefined>;
  telemetryListeners: Set<(payload: LazyTelemetryPayload) => void>;
  boundaryStates: Record<LazyBoundaryKey, LazyBoundaryState>; // wrapped in reactive()
};
```

Performance notes:
- No runtime overhead added to `load()` hot path beyond a single `getRegistry()` call.
- Concurrency remains promise-cached per key.

Testing notes:
- Add/adjust tests to ensure registry resets on HMR/test resets do not leak listeners.

## 2) `useResponsiveState`: consistent return type + ref-counted cleanup

### Problem
- SSR returns a different shape than client.
- `createResponsiveState()` defines `isDesktop` but doesn’t return it.
- Shared state is module-cached; listeners are only removed on HMR dispose.

### Design
- Introduce an explicit interface and return it in both SSR and client.

```ts
export interface ResponsiveState {
  isMobile: Ref<boolean>;
  isTablet: Ref<boolean>;
  isDesktop: Ref<boolean>;
  hydrated: Ref<boolean>;
}
```

- Ensure client returns all four refs.
- Implement reference counting *only when a Vue scope exists*:
  - On call: increment `consumerCount`.
  - On `onScopeDispose`: decrement.
  - When count hits 0: remove matchMedia listeners and clear cached state.
  - If called outside a Vue scope: do not ref-count (keep current behavior).

Performance notes:
- Listener creation remains once-per-app in the common case.
- No per-resize overhead beyond existing update function.

## 3) `useMultiPane`: bound persisted widths

### Problem
- Persisted widths can accumulate extra entries across long usage patterns.

### Design
- Add a small helper run whenever pane count changes:

```ts
function normalizeStoredWidths(paneCount: number) {
  if (paneWidths.value.length > paneCount) {
    paneWidths.value = paneWidths.value.slice(0, paneCount);
  }
}
```

- Call it after `addPane()` (post-push) and after `closePane()` (post-splice), plus in `getPaneWidth()` fast path when a mismatch is detected.

Performance notes:
- O(1) in steady state; O(n) only when panes change.

## 4) `defaultLoadMessagesFor`: safe mapping without perf regression

### Problem
- Blind casts from Dexie rows risk silent corruption.
- Full Zod parsing for every message could regress large-thread performance.

### Design
- Use a fast-path structural validator (cheap JS checks) and only perform heavier validation in `import.meta.dev`.
- Preserve ordering semantics.

Pseudo:

```ts
function isMessageLike(x: any): x is { id: string; role: string; deleted?: boolean } {
  return x && typeof x.id === 'string' && typeof x.role === 'string';
}

for (const msg of msgs) {
  if (!isMessageLike(msg) || msg.deleted) continue;
  // dev-only: safeParse(MessageSchema) and log failures
  // map to MultiPaneMessage
}
```

Optional follow-up (only if profiling proves needed):
- Add a compound Dexie index `[thread_id+deleted+index]` in a new DB version to enable indexed querying of non-deleted messages.
- This should be gated behind measurement since index creation can be costly for large existing DBs.

## 5) `useTokenizer`: atomic workerPromise initialization

### Problem
- `ensureWorker()` uses a check-then-set pattern; concurrent calls can construct multiple workers.

### Design
- Replace with a single in-flight promise initialized exactly once:

```ts
if (!workerPromise) {
  workerPromise = (async () => {
    try { /* construct worker */ }
    catch { return null; }
  })();
}
return workerPromise;
```

- Keep existing failure behavior (fallback encoder) and HMR disposal.

Performance notes:
- No added overhead; reduces redundant work.

## 6) `usePreviewCache.ensure`: loader failure handling

### Problem
- Loader rejection leaves metrics incremented (`misses++`) and callers see a thrown error, but state consistency isn’t guaranteed.

### Design
- Wrap loader in try/catch.
- Only mutate `map`/`totalBytes` after validation.
- Keep `misses++` semantics (a miss occurred) but ensure no bytes are added for failed loads.
- Optionally add a dev-only diagnostic log.

## 7) `usePanePrompt`: hook-based cleanup on pane close

### Problem
- `pendingByPane` can accumulate orphan keys.
- Multi-pane currently only emits `ui.pane.close:action:before`, and no built-in cleanup exists.

### Design
- Add a new *additive* hook emission: `ui.pane.close:action:after` in `useMultiPane.closePane()` after pane removal.
- In `usePanePrompt`, register exactly one global hook handler (guarded by `globalThis` boolean) that listens to `ui.pane.close:action:after` and calls `clearPanePendingPrompt(pane.id)`.
- Ensure the handler is HMR-disposed.

Performance notes:
- Constant-time hook call on pane close only.

## 8) `useScrollLock`: expose readonly ref

### Problem
- Currently returns `computed(() => isLockedRef.value)`.

### Design
- Return `readonly(isLockedRef)` to expose a stable ref-like handle.

## 9) `useWorkspaceBackup`: categorize import errors

### Problem
- Import catches map all failures to `ERR_DB_WRITE_FAILED`.

### Design
- Introduce minimal error classification in the import catch block:
  - Validation errors (schema parse / zod) → `ERR_VALIDATION_FAILED`
  - Quota / storage errors → `ERR_DB_QUOTA_EXCEEDED`
  - Generic write errors → `ERR_DB_WRITE_FAILED`
- Keep the existing `reportError` plumbing and tags.

# Documentation changes

- Update JSDoc blocks to the repo’s structured style (Purpose/Behavior/Constraints/Non-Goals/@example).
- Verify doc files under `public/_documentation/composables/` match behavior after changes; update summaries only where needed.

# Testing strategy

Unit tests (Vitest):

- `useTokenizer`: concurrency test (multiple `ensureWorker()` calls) asserting only one `Worker` constructed.
- `useResponsiveState`: return shape includes `isDesktop` and `hydrated` in SSR branch; listener install occurs once.
- `usePreviewCache`: ensure rejects on loader failure and leaves `totalBytes` unchanged.
- `useMultiPane`: widths array truncation when closing panes and when stored widths exceed pane count.
- `usePanePrompt`: when `ui.pane.close:action:after` fires, pending prompt entry is removed; HMR guard prevents duplicate registrations.

Perf safety checks:
- Add a micro-benchmark style unit test (non-flaky) that loads N synthetic messages and ensures mapping executes within a reasonable bound in test environment (use wide margin, only to catch accidental O(n^2) behavior).
