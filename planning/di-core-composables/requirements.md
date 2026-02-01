---
artifact_id: 6b3f2c9b-6d2b-4aab-9aaf-0d7bc7d1a064
title: Core composables remediation (non-breaking)
status: draft
owner: core
date: 2026-02-01
---

# Overview

This work remediates issues found in core composables under `app/composables/core/` with a focus on:

- No breaking API changes for app code or plugins.
- No performance regressions in hot paths (pane rendering, message loading, token counting).
- Improved safety in dev/HMR and in long-running sessions.

Scope (directly):
- `useLazyBoundaries`
- `useResponsiveState`
- `useMultiPane`
- `useTokenizer`
- `usePreviewCache`
- `usePanePrompt`
- `useScrollLock`
- `useHookEffect` (documentation/template alignment only)
- `useWorkspaceBackup` (error reporting categorization only)

Notes from repo review:
- `public/_documentation/composables/usePreviewCache.md` and `public/_documentation/composables/usePanePrompt.md` already exist, and `public/_documentation/docmap.json` already lists both. The remediation work should focus on correctness and doc quality rather than creating missing entries.

# Requirements

## 1. Lazy boundaries: HMR-safe shared state without listener leaks

**User Story 1.1**
As a developer, I want `useLazyBoundaries` to maintain shared state without leaking listeners across HMR or tests, so that dev sessions remain stable and test runs are isolated.

**Acceptance Criteria**
- WHEN the module is hot-reloaded THEN telemetry listeners and internal caches SHALL be cleaned up deterministically.
- WHEN tests import the module multiple times (via `vi.resetModules`) THEN state SHALL not leak between tests.
- WHEN `load()` is called concurrently for the same key THEN the loader SHALL be executed at most once.
- The exported types SHALL match `types/lazy-boundaries.d.ts` (no duplicate divergent interfaces).

## 2. Responsive state: consistent SSR/client return shape + safe lifecycle

**User Story 2.1**
As a developer, I want `useResponsiveState()` to return a consistent shape on SSR and client, so that code can safely access `isDesktop`/`hydrated` without defensive checks.

**Acceptance Criteria**
- IF called during SSR THEN the return value SHALL include `isMobile`, `isTablet`, `isDesktop`, and `hydrated` refs.
- WHEN hydrated client-side THEN `hydrated.value` SHALL become `true` after the initial breakpoint sync.

**User Story 2.2**
As a developer, I want responsive listeners to not accumulate in edge cases, so that long-running sessions do not degrade.

**Acceptance Criteria**
- WHEN multiple components call `useResponsiveState()` THEN matchMedia listeners SHALL be created at most once.
- WHEN the last tracked consumer scope disposes THEN listeners SHALL be removed and internal shared state MAY be released (only if created within a Vue effect scope).
- IF called outside of a Vue scope (no disposer available) THEN the shared listeners SHALL remain active (no behavior regression).

## 3. Multi-pane widths: bounded localStorage and stable behavior

**User Story 3.1**
As a user, I want pane widths persistence to not grow unbounded, so that localStorage does not bloat over time.

**Acceptance Criteria**
- WHEN panes are closed THEN persisted widths SHALL be truncated to current pane count.
- WHEN panes are opened THEN persisted widths SHALL be either (a) extended deterministically or (b) re-initialized for the new count.
- IF stored widths are invalid or mismatched THEN the UI SHALL fall back to equal-percentage widths (current behavior preserved).

## 4. Multi-pane message loading: safe mapping without hot-path regression

**User Story 4.1**
As a developer, I want `defaultLoadMessagesFor()` to robustly map DB messages to `MultiPaneMessage` without silent corruption, so that downstream UI gets valid data.

**Acceptance Criteria**
- WHEN DB rows contain unexpected shapes THEN the loader SHALL (a) skip invalid rows and (b) log diagnostics in `import.meta.dev`.
- Parsing/validation SHALL not introduce measurable regressions for large threads.
- Message ordering SHALL remain stable (existing `index` ordering preserved; do not change semantics).

## 5. Tokenizer: eliminate duplicate-worker races

**User Story 5.1**
As a developer, I want `useTokenizer` to create at most one worker even under concurrent calls, so that token counting does not waste resources.

**Acceptance Criteria**
- WHEN `ensureWorker()` is called concurrently THEN exactly one `Worker` SHALL be constructed.
- WHEN the worker fails THEN all pending requests SHALL be rejected and subsequent calls SHALL fall back to the dynamic import encoder.
- This change SHALL not block initial render; worker creation remains async.

## 6. Preview cache: failure handling without poisoning cache state

**User Story 6.1**
As a developer, I want `usePreviewCache.ensure()` to handle loader failures predictably, so that cache metrics and state remain consistent.

**Acceptance Criteria**
- WHEN the loader rejects THEN `ensure()` SHALL reject and SHALL NOT increment `totalBytes`.
- WHEN the loader resolves with an invalid result THEN `ensure()` SHALL reject with a clear error.
- Cache metrics (`hits/misses/evictions/bytes`) SHALL remain internally consistent after failures.

## 7. Pane prompt: automatic cleanup when panes close

**User Story 7.1**
As a developer, I want `usePanePrompt`’s in-memory map to be cleaned when panes close, so that long sessions do not accumulate orphaned pane IDs.

**Acceptance Criteria**
- WHEN a pane is closed THEN its pending prompt entry SHALL be cleared automatically.
- Cleanup SHALL not require callsites to remember to call `clearPanePendingPrompt()`.
- The cleanup mechanism SHALL be HMR-safe (no duplicate hook handlers on reload).

## 8. Scroll lock: expose a stable reactive handle

**User Story 8.1**
As a developer, I want `useScrollLock` to expose a readonly ref-like `isLocked`, so that it can be used in templates and composables without unexpected computed wrappers.

**Acceptance Criteria**
- WHEN `useScrollLock()` is used THEN `isLocked` SHALL be a readonly `Ref<boolean>` (not a computed).
- Existing usage reading `isLocked.value` SHALL continue to work.

## 9. Workspace backup: error categorization for actionable UX

**User Story 9.1**
As a user, I want workspace import errors to be categorized, so that the UI can provide actionable guidance (validation vs quota vs write errors).

**Acceptance Criteria**
- WHEN import fails due to validation THEN error code SHALL be specific (not always `ERR_DB_WRITE_FAILED`).
- WHEN import fails due to quota or storage issues THEN the error code/message SHALL be specific.
- Existing error reporting plumbing (`reportError`, `asAppError`) SHALL remain compatible.

## 10. Documentation and tests

**User Story 10.1**
As a maintainer, I want improved test coverage around the risky fixes, so that refactors remain safe.

**Acceptance Criteria**
- Unit tests SHALL cover tokenizer concurrency, responsive return-shape, preview cache failure, pane widths truncation, and pane prompt cleanup.
- Docs/JSDoc SHALL be updated to match the repo’s structured documentation expectations without changing runtime behavior.
