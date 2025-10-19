## Task Checklist

-   [x] Consolidate responsive source of truth (Requirements: 1,2,3,5)

    -   [x] Update `useResponsiveState` to expose shared refs and mirror them into `app/state/global.ts` without adding new exports
    -   [x] Swap `PageShell.vue`, chat components, and the autocomplete plugin to the shared helper and drop the unused sidebar import

-   [ ] Verify migration behaviour (Requirements: 1,4,5)
    -   [ ] Run `bunx vitest useResponsiveState`
    -   [ ] Perform a manual viewport smoke test around the breakpoint and document any regressions
