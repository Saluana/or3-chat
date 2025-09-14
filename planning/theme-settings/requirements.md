# Theme Customization (Theme Page) Requirements

artifact_id: 0f1d0c1e-5f5f-4d59-8a7f-0df5e2d7432c

## 1. Introduction

Provide a customizable theming layer letting users adjust core visual presentation without rebuilding the app. Initial scope: background imagery (content + sidebar layers), opacity & repeat behavior, optional second overlay pattern, root font size, and accessibility reduction of visual noise for high‑contrast modes. Persistence is local (localStorage) in v1; color token editing and server sync are deferred.

## 2. User Roles

-   End User: Adjusts theme for personal comfort / aesthetics.
-   Power User (Accessibility): Reduces patterns for clarity in high contrast variants.
-   Developer (Internal): Extensible contract (CSS vars + composable) for future features (palette editor, export/import, cloud sync).

## 3. Glossary

-   Content Background Layer 1 / 2: Two stacked repeating images under main content (`::before` / `::after`).
-   Sidebar Background: Pattern image behind sidebar content.
-   Root Font Size: Base pixel size applied to `html, body` driving rem scaling.
-   High Contrast Variant: Existing theme classes ending with `-high-contrast`.

## 4. Functional Requirements

### R1 Theme Settings Persistence

As a user, I want my custom theme settings stored locally so they apply automatically on reload.
Acceptance:

-   WHEN app loads AND settings exist in localStorage under `theme:settings:v1` THEN system SHALL apply them before first paint of interactive UI (best effort after hydration if pre-paint impossible).
-   IF no saved settings THEN system SHALL initialize defaults matching current hardcoded design values.

### R2 Root Font Size Adjustment

As a user, I want to change the default font size to improve readability.
Acceptance:

-   WHEN user drags slider (range 14–24) THEN html/body font-size SHALL update (debounced ≤75ms) via CSS var.
-   WHEN user clicks Reset All THEN font size SHALL revert to default (20px).

### R3 Content Background Layer 1 Customization

As a user, I want to customize or remove the primary content background pattern.
Acceptance:

-   WHEN user uploads valid image (png|jpg|jpeg|webp|svg) ≤2MB THEN layer 1 SHALL update immediately.
-   IF user selects Remove THEN layer 1 image var SHALL become `none` and opacity forced to 0.
-   IF user sets opacity slider THEN visual change SHALL reflect within 75ms.
-   IF invalid file type or size >2MB THEN system SHALL show a rejection toast and ignore change.

### R4 Content Background Layer 2 Customization

As a user, I want to optionally enable a secondary overlay pattern.
Acceptance:

-   WHEN user toggles second layer on with a preset or upload THEN layer 2 SHALL display over layer 1 using configured opacity.
-   IF disabled THEN layer 2 image SHALL be `none` and opacity 0.

### R5 Sidebar Background Customization

As a user, I want to customize the sidebar repeating background.
Acceptance:

-   WHEN user applies preset OR uploads valid image THEN sidebar pattern SHALL change accordingly.
-   WHEN user selects Remove THEN sidebar pattern SHALL be `none` with opacity 0.

### R6 Repeat / Mode Control

As a user, I want to control whether backgrounds repeat.
Acceptance:

-   WHEN user switches repeat toggle (repeat/no-repeat) for content or sidebar THEN corresponding CSS var SHALL update and render change.

### R7 Accessibility Pattern Reduction

As a high-contrast user, I want patterns auto-reduced to avoid noise.
Acceptance:

-   IF current theme class ends with `-high-contrast` AND setting `reducePatternsInHighContrast` is true THEN opacities for active pattern layers SHALL clamp to ≤0.04 (unless individually edited after activation in current session).
-   WHEN user unchecks this option THEN original opacities SHALL restore.

### R8 Preview & Instant Feedback

As a user, I want to see changes instantly while adjusting.
Acceptance:

-   WHEN a setting changes THEN corresponding CSS computed style SHALL update without full page reload.

### R9 Reset All

As a user, I want to revert all theme settings to shipped defaults.
Acceptance:

-   WHEN user clicks Reset All AND confirms THEN all settings SHALL reset, stored JSON cleared, defaults applied.

### R10 Robustness & Validation

As a user, I expect invalid inputs are rejected safely.
Acceptance:

-   IF image fails to load (error event) THEN system SHALL revert to previous image and display toast.
-   IF localStorage quota exceeded THEN system SHALL warn (toast) and changes SHALL still apply for current session (in-memory) but not persist.

### R11 Extensibility Contract

As a developer, I want a stable CSS variable + composable API for future additions.
Acceptance:

-   System SHALL expose well-namespaced CSS vars documented inline and in `design.md`.
-   Composable SHALL allow partial updates via `set(partial)`.

## 5. Non-Functional Requirements

### Performance

-   Applying user changes SHALL avoid layout thrash (≤2 reflows typical) via debounced mutations.
-   Initial application of stored settings SHALL occur within 50ms after `app:beforeMount` hook callback.

### Maintainability

-   All new logic isolated in new composable + a lightweight client plugin; no modifications to existing color theme plugin beyond optional import order guarantee.

### Security

-   No remote uploads; only client-local data URLs or object URLs (v1). No XSS exposure (CSS only).

### Accessibility

-   Changes SHALL not reduce text contrast (color tokens remain unchanged). Pattern reduction option present.

## 6. Out of Scope (Deferred)

-   Color palette editing / generation.
-   Server or account-based sync.
-   Export/import JSON.
-   Per-component scale factors (buttons, inputs) separate from root size.

## 7. Defaults Table

| Setting                      | Default                |
| ---------------------------- | ---------------------- |
| baseFontPx                   | 20                     |
| contentBg1                   | /bg-repeat.webp        |
| contentBg2                   | /bg-repeat-2.webp      |
| contentBg1Opacity            | 0.08                   |
| contentBg2Opacity            | 0.125                  |
| sidebarBg                    | /sidebar-repeater.webp |
| sidebarBgOpacity             | 0.10                   |
| sidebarRepeat                | repeat                 |
| contentRepeat                | repeat                 |
| reducePatternsInHighContrast | true                   |

## 8. Acceptance Test Scenarios (High Level)

1. Load with no settings → defaults applied (R1).
2. Change font size to 22px → computed style reflects 22px (R2).
3. Upload custom sidebar image → background updates (R5).
4. Remove content layer 1 → pattern gone, opacity 0 (R3).
5. Enable high-contrast theme with reduction on → opacities clamped (R7).
6. Reset All → all defaults restored (R9).

## 9. Risks & Mitigations

| Risk                                      | Mitigation                                                |
| ----------------------------------------- | --------------------------------------------------------- |
| Large data URI slows initial load         | Show size warning >300KB; encourage repeat small textures |
| User sets unreadably small font size      | Enforce minimum 14px                                      |
| High contrast toggle race with font apply | Apply settings after variant class detection (microtask)  |
| Object URLs leak memory                   | Revoke previous URL on replacement                        |

## 10. Traceability

Req IDs map to tasks in `tasks.md` and design decisions in `design.md`.
