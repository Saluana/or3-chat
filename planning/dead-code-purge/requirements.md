# requirements.md

artifact_id: 7b9cf5a1-4e8b-4b89-a8d5-469e0c55b9e7

## Introduction

This initiative performs a targeted purge of dead, placeholder, and unguarded debug code across key chat modules (`useAi.ts`, `useTailStream.ts` / successors, `useOpenrouter.ts`, `ChatContainer.vue`, `ChatMessage.vue`, related utilities). The objective is to eliminate inert branches, `{…}` ellipsis stubs, obsolete watchers, empty template wrappers, stray CSS selectors, and incomplete computed properties without changing observable behavior. Result: leaner codebase, reduced cognitive overhead, lower bundle size, and fewer silent failure surfaces (e.g., undefined class strings).

## Functional Requirements (User Stories)

### 1. Placeholder Ellipsis Removal

As a maintainer, I want all `{…}` placeholder blocks removed or replaced with minimal working logic so that no inert branches obscure intent.
Acceptance Criteria:

-   WHEN grep is executed for the literal pattern `{…}` (Unicode ellipsis or three dots variant) THEN it SHALL return zero matches in `app/` source after refactor.
-   IF a branch guarded only by a placeholder has no runtime effect THEN it SHALL be deleted entirely (not replaced by an empty block).
-   IF minimal logic is required to preserve data flow (e.g., hash merge) THEN a concise implementation SHALL replace the placeholder with ≤5 LOC.

### 2. Unguarded Debug Log Hardening

As a developer, I want only intentional debug logs to remain and they must be dev‑guarded so production noise and potential PII leakage is prevented.
Acceptance Criteria:

-   WHEN searching for `console.debug(` or `console.log(` in modified target files THEN each occurrence SHALL be wrapped in `if (import.meta.dev)` OR removed.
-   WHEN searching for `console.warn(` or `console.error(` THEN only meaningful user‑facing or error reporting logs remain; spurious development warnings removed unless they indicate misuse.
-   No new logging added during purge except guarded replacements.

### 3. Redundant / No‑Op Watcher Elimination

As a maintainer, I want watchers that produce no side effects (empty callbacks, commented bodies, pure reads) removed to streamline reactivity.
Acceptance Criteria:

-   WHEN a watcher callback body is empty, only logs, or commented out THEN the watcher SHALL be removed.
-   Combined effects: multiple watchers on the same reactive sources performing sequential lightweight adjustments SHALL be merged where trivial (≤10 LOC) or removed if obsolete.
-   Post‑purge linting SHALL show no unused variable warnings introduced by watcher removal.

### 4. Incomplete Computed & Class Logic Completion

As a developer, I want all computed properties to return explicit values across all branches to avoid undefined style/class emission.
Acceptance Criteria:

-   WHEN static analysis inspects computed declarations THEN each has a final `return` on every code path.
-   Example case `inputWrapperClass` SHALL provide a concrete desktop fallback (e.g., `''` or defined class string) instead of a dangling comment or missing branch.
-   No runtime warnings for accessing undefined class bindings in affected components.

### 5. Empty Wrapper & Fragment Simplification

As a UI maintainer, I want extraneous `<div>` wrappers with no semantic/stylistic purpose removed so that DOM depth and CSS complexity decrease.
Acceptance Criteria:

-   WHEN a wrapper has: (a) no attributes, (b) single child element, (c) no flex/grid/layout styling, THEN it SHALL be removed or converted to a Vue fragment.
-   Resultant template SHALL remain functionally identical (visual regression test or manual snapshot of layout unaffected).

### 6. Orphan / Dead CSS Selector Cleanup

As a CSS maintainer, I want unused selectors and broken fragments purged so that stylesheet parsing cost and developer confusion decrease.
Acceptance Criteria:

-   WHEN searching for each selector removed, no corresponding usage in templates, scripts (`class=`), or JS string class utilities exists.
-   Broken selector fragments (e.g., `.message-body )`) SHALL be removed entirely.
-   CSS file diffs SHALL not remove selectors still referenced (verified by grep before deletion).

### 7. Dead Branch & Unreachable Code Deletion

As a maintainer, I want obviously unreachable conditional paths (always false guards, feature flags no longer toggled) removed to clarify logic.
Acceptance Criteria:

-   Static pass identifies branches with constants (e.g., `if (false)`, `if (ENABLE_FOO && ...)` where `ENABLE_FOO` no longer defined) and removes them.
-   No references to deleted flags remain.

### 8. ESLint Temporary Rule Enforcement

As a maintainer, I want a transient lint safeguard to prevent reintroduction of placeholder ellipsis so that the purge remains effective.
Acceptance Criteria:

-   A temporary custom rule or simple `no-restricted-syntax` / `no-restricted-patterns` entry SHALL flag `{…}` tokens.
-   Lint run post‑purge SHALL pass (no occurrences) and rule documented for later removal.

### 9. Behavior Preservation

As a user, I expect identical chat functionality post‑purge so that cleanup does not regress UX.
Acceptance Criteria:

-   Smoke test: send message, receive streaming response, attachments display, scroll behavior, auth redirect – all succeed pre vs post.
-   Snapshot or DOM size change limited to removal of empty wrappers (no visible layout shift beyond ±1px tolerance due to margin collapse).

### 10. Measurable Reduction

As an engineering lead, I want a quantifiable line reduction to validate impact.
Acceptance Criteria:

-   Net deletion of ≥130 LOC (target upper bound 170) across impacted files ignoring test additions.
-   A summary diff metric recorded in commit message (e.g., `Dead code purge: -152 LOC net`).

## Non-Functional Requirements

-   Safety: No new TypeScript errors or failing unit tests introduced.
-   Performance: Bundle size change tracked (optional `nuxt build --analyze` before/after); no negative perf regressions.
-   Clarity: Remaining logs are purposeful and minimal.
-   Reversibility: Single commit or small series allowing easy rollback.

## Out of Scope

-   Larger architectural refactors (stream unification, normalization) covered by other planning artifacts.
-   API surface changes or new features.
-   Accessibility or design system modifications.

## Dependencies / Preconditions

-   Recommended (not mandatory) to execute AFTER major refactors (stream core, normalization) to avoid churn conflicts.
-   Current test suite stable (baseline captured before purge start).

## Acceptance / Sign-off Checklist

-   [ ] All placeholder blocks removed or replaced (Req 1).
-   [ ] All debug logs guarded or trimmed (Req 2).
-   [ ] Redundant watchers removed (Req 3).
-   [ ] Computed returns complete (Req 4).
-   [ ] Empty wrappers removed (Req 5).
-   [ ] Orphan selectors purged (Req 6).
-   [ ] Dead branches deleted (Req 7).
-   [ ] Lint rule active & passes (Req 8).
-   [ ] Functional smoke test parity (Req 9).
-   [ ] Net LOC reduction ≥130 (Req 10).
-   [ ] Documentation (this file + design + tasks) updated.
