---
artifact_id: 0c4a8f55-1f6b-47a5-9f54-2ef1267cf0f5
title: Tasks - Core composables remediation (non-breaking)
status: draft
owner: core
date: 2026-02-01
---

# 0. Guardrails

- [x] Define "no breaking" constraints for this work (public exports unchanged; additive fields/hooks allowed). Requirements: 1.1, 2.1, 3.1
- [x] Add a short perf checklist to PR template notes (no Zod in large loops unless dev-only; avoid extra watchers/listeners). Requirements: 4.1

# 1. `useLazyBoundaries` registry + type alignment

- [x] Replace module-level singleton/caches with a `globalThis` registry and add HMR dispose cleanup. Requirements: 1.1
- [x] Remove/stop exporting the duplicate `LazyBoundaryController` interface in the composable implementation; import types from `types/lazy-boundaries.d.ts`. Requirements: 1.1
- [x] Ensure telemetry listener registration cannot duplicate across HMR (clear registry listeners on dispose). Requirements: 1.1
- [x] Update/adjust existing tests in `app/composables/core/__tests__/useLazyBoundaries.test.ts` if needed to reset registry deterministically. Requirements: 1.1

# 2. `useResponsiveState` return shape + lifecycle

- [x] Introduce explicit `ResponsiveState` interface with `isMobile/isTablet/isDesktop/hydrated`. Requirements: 2.1
- [x] Fix client implementation to actually return `isDesktop` and `hydrated`. Requirements: 2.1
- [x] Update SSR branch to return the full shape (desktop assumed true, hydrated false). Requirements: 2.1
- [x] Add ref-counted cleanup using `onScopeDispose` only when a Vue scope exists. Requirements: 2.2
- [x] Expand `app/composables/core/__tests__/useResponsiveState.test.ts` to assert return shape and no duplicate listener registrations. Requirements: 2.1, 2.2

# 3. `useMultiPane` widths bounding

- [x] Add `normalizeStoredWidths(paneCount)` and call it in `addPane()` and `closePane()` paths. Requirements: 3.1
- [x] Add a unit test that simulates a stored widths array longer than pane count and asserts truncation occurs after close/add. Requirements: 3.1
- [x] Ensure no behavioral regression in resize tests (`useMultiPane-resize.test.ts`). Requirements: 3.1

# 4. `defaultLoadMessagesFor` safe mapping

- [x] Implement fast structural validation for DB rows; skip invalid/deleted rows. Requirements: 4.1
- [x] Add dev-only `safeParse` diagnostics (log once per load or with capped count). Requirements: 4.1
- [x] Add/extend unit test with malformed message rows to confirm they are skipped and do not crash. Requirements: 4.1
- [x] (Optional, gated) Profile large-thread behavior; decide whether a new compound index is needed. If yes, create a separate task section and bump Dexie schema version with minimal migration. Requirements: 4.1

# 5. `useTokenizer` concurrency fix

- [x] Refactor `ensureWorker()` to use a single in-flight `workerPromise` initialized atomically. Requirements: 5.1
- [x] Add a unit test that calls the internal worker initialization concurrently and asserts only one `Worker` is constructed. Requirements: 5.1
- [x] Add a unit test for worker failure path rejecting pending requests and falling back. Requirements: 5.1

# 6. `usePreviewCache` error handling

- [x] Wrap loader in try/catch; validate result; only mutate bytes/map after validation. Requirements: 6.1
- [x] Add unit tests for:
  - [ ] loader rejection keeps `bytes` unchanged and rejects. Requirements: 6.1
  - [ ] invalid loader result rejects. Requirements: 6.1

# 7. `usePanePrompt` cleanup on pane close

- [x] Add `ui.pane.close:action:after` emission in `useMultiPane.closePane()` (additive hook). Requirements: 7.1
- [x] In `usePanePrompt`, register exactly one hooks handler (guarded in `globalThis`) that clears pending prompt entries on close-after. Requirements: 7.1
- [x] Add unit test: set pending prompt, close pane via `useMultiPane`, assert prompt cleared. Requirements: 7.1
- [x] Confirm hook documentation in `docs/core-hook-map.md` is updated to include the new close-after hook (additive). Requirements: 7.1, 10.1

# 8. `useScrollLock` reactive handle

- [x] Change `isLocked` to `readonly(isLockedRef)` and ensure typings still work. Requirements: 8.1
- [x] Update `app/composables/core/__tests__/useScrollLock.test.ts` if needed (should remain compatible). Requirements: 8.1

# 9. `useWorkspaceBackup` error categorization

- [x] Add minimal error classification for import failure (validation/quota/generic). Requirements: 9.1
- [x] Add/extend unit tests around import error mapping if feasible (mock thrown errors and assert reported codes). Requirements: 9.1

# 10. Documentation polish (no behavior changes)

- [x] Update JSDoc blocks for the touched composables to match structured style (Purpose/Behavior/Constraints/Non-Goals/@example). Requirements: 10.1
- [x] Verify docs under `public/_documentation/composables/` remain accurate; update summaries/examples where needed. Requirements: 10.1

# 11. Validation

- [x] Run unit tests: `bun run test`. Requirements: 10.1
- [x] Run lint if applicable: `bun run lint` (only fix issues related to changed code). Requirements: 10.1
- [x] (Optional) Add a lightweight perf sanity check script or test guard for message mapping (catch O(n^2) mistakes). Requirements: 4.1
