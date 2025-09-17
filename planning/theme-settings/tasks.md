# Theme Customization Tasks

artifact_id: 9b0e02fd-1333-4c9e-bfd3-0f3c9d7eaa55

## Legend

-   Req refs correspond to `requirements.md` (R1..R11)
-   All tasks unchecked initially

## 1. Composable & Types

-   [x] 1.1 Create `app/composables/useThemeSettings.ts` exporting `ThemeSettings`, defaults, and API (Req: R1,R2,R3,R4,R5,R6,R7,R8,R9,R11)
-   [x] 1.2 Implement validation + clamp logic (Req: R2,R3,R4,R5,R6,R7,R10)
-   [x] 1.3 Implement `applyToRoot` writing CSS vars (Req: R2,R3,R4,R5,R6,R8,R11)
-   [x] 1.4 Implement high-contrast clamp function (Req: R7)
-   [x] 1.5 Implement persistence (load/save/localStorage + error handling) (Req: R1,R10)
-   [x] 1.6 Add reset() restoring defaults & clearing storage (Req: R9)
-   [x] 1.7 Unit tests for composable (default init, clamps, high contrast) (Req: R10,R7,R2)

## 2. CSS Variables & Global Styles

-   [x] 2.1 Add variable declarations to `app/assets/css/main.css` root scope (Req: R3,R4,R5,R2,R6,R11)
-   [x] 2.2 Replace hardcoded font-size with var reference (Req: R2)
-   [x] 2.3 Update `.content-bg::before/::after` in `ResizableSidebarLayout.vue` to use vars (Req: R3,R4,R6)
-   [x] 2.4 Update `aside::before` sidebar pattern to vars (Req: R5,R6)
-   [x] 2.5 Add repeat variable usage in both areas (Req: R6)
-   [x] 2.6 Confirm fallback visuals unchanged with defaults (manual reasoning: defaults identical to previous hardcoded values) (Req: R8,R10)

## 3. Client Plugin

-   [x] 3.1 Create `app/plugins/theme-settings.client.ts` to load & apply early (Req: R1,R8)
-   [x] 3.2 Ensure HMR-safe (dispose logic if needed) (Req: R10)

## 4. Theme Page UI

-   [x] 4.1 Implement base skeleton in `ThemePage.vue` (sections + layout) (Req: R2,R3,R4,R5,R6,R7,R9)
-   [x] 4.2 Font size slider + live preview (Req: R2,R8)
-   [x] 4.3 Content layer 1 controls: preset buttons, upload, opacity, remove, repeat (Req: R3,R6)
-   [x] 4.4 Content layer 2 toggle + controls (Req: R4)
-   [x] 4.5 Sidebar background controls (preset, upload, opacity, remove, repeat) (Req: R5,R6)
-   [x] 4.6 Accessibility checkbox (pattern reduction) (Req: R7)
-   [x] 4.7 Reset all button with confirm (Req: R9)
-   [x] 4.8 Debounce sliders (opacity + font) (Req: R8,R10)
-   [x] 4.9 Image validation + error toasts (Req: R10)
-   [x] 4.10 Handle object URL lifecycle (revoke on replace/unmount) (Req: R10)

## 5. Testing

-   [ ] 5.1 Unit tests (composable) completed (Req: R10)
-   [ ] 5.2 Integration test: simulate font change + variable update (Req: R2,R8)
-   [ ] 5.3 Integration test: upload mock image sets css var (Req: R3,R5)
-   [ ] 5.4 Manual checklist run (Req: R8,R9,R10)

## 6. Documentation

-   [ ] 6.1 Add short section to existing docs (e.g. new `docs/UI/theme-settings.md`) summarizing variable contract & usage (Req: R11)
-   [ ] 6.2 Inline JSDoc in composable (Req: R11)

## 7. QA / Polish

-   [ ] 7.1 Verify high contrast opacity clamp activates & releases (Req: R7)
-   [ ] 7.2 Verify Reset All clears storage key (Req: R9,R1)
-   [ ] 7.3 Confirm no console errors on invalid upload (Req: R10)
-   [ ] 7.4 Confirm production build size unaffected materially (patterns remain external) (Req: R1)

## 8. Future (Deferred - not implemented now)

-   [ ] 8.1 Export/import JSON profile (Deferred) (Req: n/a)
-   [ ] 8.2 Server sync (Deferred) (Req: n/a)
-   [ ] 8.3 Color palette editor (Deferred) (Req: n/a)

## Dependencies

| Task        | Depends On |
| ----------- | ---------- |
| 2.3,2.4,2.5 | 2.1        |
| 3.1         | 1._ & 2._  |
| 4.\*        | 1._ & 2._  |
| 5.2,5.3     | 3.1,4.\*   |

## Traceability

| Requirement | Tasks                           |
| ----------- | ------------------------------- |
| R1          | 1.5,3.1,7.2                     |
| R2          | 1.1,1.2,1.3,2.2,4.2,5.2         |
| R3          | 1.1-1.3,2.1,2.3,4.3,5.3         |
| R4          | 1.1-1.3,2.1,2.3,4.4             |
| R5          | 1.1-1.3,2.1,2.4,4.5,5.3         |
| R6          | 1.1-1.3,2.1,2.3,2.4,2.5,4.3,4.5 |
| R7          | 1.4,4.6,7.1                     |
| R8          | 1.3,4.2,4.3,4.5,4.8,5.2         |
| R9          | 1.6,4.7,7.2                     |
| R10         | 1.2,1.5,4.8,4.9,4.10,5.1,7.3    |
| R11         | 1.1,1.3,6.1,6.2                 |
