## Purpose

Document the requirements for consolidating responsive breakpoint state across the OR3 app. Today the codebase has two sources of truth for `isMobile`: a legacy global ref in `app/state/global.ts` that many chat components depend on, and the newer `useResponsiveState` composable introduced during the documentation shell mobile work. We need a plan to reconcile them without breaking existing flows.

## Requirements

1. **Maintain backward compatibility during migration**

    - Existing imports of `isMobile` from `~/state/global` must continue to work until each consumer is refactored.
    - No regressions in chat layout, keyboard shortcuts, or plugin behaviour.

2. **Single authoritative breakpoint source**

    - Define how the new responsive composable will drive global state (or vice versa) so that mobile detection logic is consistent across the app.
    - Ensure SSR hydration safety remains intact.

3. **Catalogue current usages**

    - Inventory every file that reads or writes `isMobile` (global or composable) and document its role.
    - Highlight mismatched breakpoint thresholds (e.g., 640px vs 768px) and areas needing attention.

4. **Testing confidence**

    - Update or add unit tests that cover the unified behaviour.
    - Provide guidance for manual verification (viewport toggling, keyboard shortcuts, autocomplete plugin, etc.).

5. **Developer guidance**
    - Outline migration steps for moving consumers off the legacy global ref.
    - Provide notes for future contributors on how to consume responsive state correctly.

## Acceptance Criteria

-   Requirements and design documents summarize existing behaviour and decisions.
-   Tasks are defined to execute the migration in manageable steps.
-   Test plan references the narrowed Vitest command (`bunx vitest useResponsiveState`) plus any additional suites touched by the migration.
