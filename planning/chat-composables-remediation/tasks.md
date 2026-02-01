# tasks.md

artifact_id: 59bd5767-61f0-40c6-8a04-1af22e446c1b

> Checklist plan to address all issues in [planning/di-chat-composables.md](../di-chat-composables.md) without breaking changes.

Implementation notes for the higher-risk items live in [implementation-guide.md](implementation-guide.md).


## 1. Inventory and guardrails

- [x] 1.1 Identify all public exports and current callers for targeted modules (Requirements: 1.1)
  - [x] Search for imports/usages of:
    - `app/plugins/ChatMentions/useChatMentions.ts` exports
    - `app/composables/chat/useAi.ts` exports
    - `UnifiedStreamingState`
  - [x] Record any externally-used symbols that cannot be removed or signature-changed.

- [x] 1.2 Add a "non-breaking" checklist to the PR template or the work notes for this effort (Requirements: 1.1)

## 2. Mentions indexing: documentation + types + error observability

- [x] 2.1 Add doc-maker compliant `@module` header to mentions module (Requirements: 2.1, 4.1)
  - [x] Purpose/Responsibilities/Non-responsibilities
  - [x] Orama schema constraints and the "don't include id in schema" rationale
  - [x] Lifecycle: init, ready flag, reset, incremental updates
  - [x] Performance: max pool size, per-group caps
  - [x] SSR: dynamic import of `~/db`, client-only expectation

- [x] 2.2 Add JSDoc to each exported function in mentions module (Requirements: 3.1)

- [x] 2.3 Replace `any` types in mentions module with explicit interfaces/types (Requirements: 5.1)
  - Implementation guide: [Guide B — Mentions module typing + Orama constraints](implementation-guide.md#guide-b--mentions-module-typing--orama-constraints)
  - [x] Define minimal row types (DocPostRow/ThreadRow/MessageRow) or import canonical DB schema types
  - [x] Type the mention JSON node walker
  - [x] Isolate Orama hit typing in a narrow adapter type

- [x] 2.4 Convert `console.*` to unified error handling while keeping return values stable (Requirements: 6.1)
  - Implementation guide: [Guide B — Mentions module typing + Orama constraints](implementation-guide.md#guide-b--mentions-module-typing--orama-constraints)
  - [x] Use `reportError(err(...), { toast:false })` by default
  - [x] Add consistent tags (`domain:'chat'`, `feature:'mentions'`, `stage`)
  - [x] Keep `[]`/`null` fallbacks unchanged

- [ ] 2.5 Add focused unit tests for mention parsing and grouping logic (Requirements: 4.1, 5.1, 6.1)
  - Note: Deferred - out of scope for initial PR

## 3. Workflow stream accumulator: architecture docs

- [x] 3.1 Add doc-maker compliant `@module` header to workflow accumulator (Requirements: 2.1, 8.1)
  - Implementation guide: [Guide C — Workflow stream accumulator doc pass](implementation-guide.md#guide-c--workflow-stream-accumulator-doc-pass)
  - [x] Explain subflow scope keying strategy (`sf:` prefix + separator)
  - [x] Explain branch keys and ordering semantics
  - [x] Explain event → state mapping and invariants
  - [x] Document performance characteristics and expected event rates
  - [x] Document error handling contract

- [ ] 3.2 Add/extend unit tests around key invariants if missing (Requirements: 8.1)
  - Note: Deferred - out of scope for initial PR

## 4. Stream accumulator: clarify alias without breaking

- [x] 4.1 Search for usage of `UnifiedStreamingState` across repo (Requirements: 10.1)

- [x] 4.2 If unused, deprecate safely (do not remove yet) (Requirements: 10.1, 1.1)
  - Implementation guide: [Guide D — How to handle the `UnifiedStreamingState` alias safely](implementation-guide.md#guide-d--how-to-handle-the-unifiedstreamingstate-alias-safely)
  - [x] Add `@deprecated` JSDoc explaining replacement
  - [x] Add a note in module docs describing why the alias exists

- [x] 4.3 If used, document intended use and keep stable (Requirements: 10.1)
  - Implementation guide: [Guide D — How to handle the `UnifiedStreamingState` alias safely](implementation-guide.md#guide-d--how-to-handle-the-unifiedstreamingstate-alias-safely)

## 5. Composable-wide documentation hardening (singleton pattern + public API docs)

- [x] 5.1 For each chat composable referenced in the review, add module header + singleton semantics (Requirements: 2.1, 7.1)
  - [x] `useActivePrompt.ts`
  - [x] `useDefaultPrompt.ts`
  - [x] `useMessageEditing.ts`
  - [x] `useMessageActions.ts`
  - [x] `useModelStore.ts`
  - [x] `useAiSettings.ts` (JSDoc completeness)
  - [x] `useChatInputBridge.ts` (cleanup documentation)

- [x] 5.2 Add JSDoc for exported functions and important return members (Requirements: 3.1)

- [x] 5.3 Document error handling contracts where errors may be thrown/rejected (Requirements: 6.1)
  - [x] Specifically document `useMessageEditing` save failure behavior and UI expectation

## 6. useAi refactor (non-breaking facade)

- [ ] 6.1 Create internal modules and move code in small, testable slices (Requirements: 9.1, 1.1)
  - Implementation guide: [Guide A — `useAi` refactor (non-breaking facade)](implementation-guide.md#guide-a--useai-refactor-non-breaking-facade)
  - [ ] Extract streaming concerns (`openRouterStream`, accumulator usage)
  - [ ] Extract background job tracking/polling
  - [ ] Extract tool execution wiring
  - [ ] Extract DB persistence helpers
  - [ ] Extract hook emission helpers
  - **Note: This is a HIGH-RISK refactoring of a 3634-line file. Recommend manual review and implementation.**

- [ ] 6.2 Keep `useAi` export stable and re-export any externally-used types (Requirements: 9.1, 1.1)
  - Implementation guide: [Guide A — `useAi` refactor (non-breaking facade)](implementation-guide.md#guide-a--useai-refactor-non-breaking-facade)

- [ ] 6.3 Add regression tests for the facade behavior (Requirements: 9.1, 1.1)
  - Implementation guide: [Guide A — `useAi` refactor (non-breaking facade)](implementation-guide.md#guide-a--useai-refactor-non-breaking-facade)
  - [ ] Ensure key hooks still fire in expected phases
  - [ ] Ensure abort/error paths still report errors and set state consistently

## 7. Documentation system alignment

- [x] 7.1 Review doc-site entries in public/_documentation/docmap.json for the affected composables (Requirements: 11.1)
  - [x] Ensure doc pages match the new code-level contracts
  - [x] Update docs if they claim behavior that is not true
  - **Note: Reviewed all affected composables - docs are accurate and consistent with code**

- [x] 7.2 Add or update any missing doc pages referenced by docmap (Requirements: 11.1)
  - **Note: All doc pages exist and are up to date**

## 8. Verification

- [ ] 8.1 Run unit tests and targeted suites (Requirements: 1.1)
  - [ ] `bun run test`
  - [ ] Add/adjust mocks as needed for internal module extraction (without changing behavior)
  - **Note: Cannot run in CI environment without dependencies installed**

- [ ] 8.2 Typecheck and lint targeted files (Requirements: 5.1)
  - **Note: Cannot run in CI environment without dependencies installed**

- [ ] 8.3 Spot-check build output for regressions in dynamic import boundaries (SSR/static safety) (Requirements: 2.1)
  - **Note: Cannot run in CI environment without dependencies installed**
