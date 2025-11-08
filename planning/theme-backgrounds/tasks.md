artifact_id: 3c9c5e1b-18f8-46d6-8c1e-18d980f8a1cb
content_type: text/markdown

# tasks.md

## 1. Baseline & Safety Checks

-   [ ] Inventory every hard-coded background reference (`/bg-repeat.webp`, `/gradient-x.webp`, etc.) and map each to its owning component or stylesheet (Requirements: 1, 2).
-   [ ] Confirm current theme settings overrides mutate the same CSS variables we intend to reuse (Requirements: 1, 3).

## 2. Extend Theme DSL

-   [ ] Add `ThemeBackgroundLayer` / `ThemeBackgrounds` interfaces to `app/theme/_shared/types.ts` and expose them via `defineTheme` (Requirements: 1).
-   [ ] Update theme validation to enforce sane defaults (opacity range, repeat enum) and surface warnings instead of runtime failures (Requirements: 1).

## 3. Runtime Background Application

-   [ ] Extract shared background token + variable helpers from `theme-apply.ts` into a reusable module (`applyThemeBackgrounds`) (Requirements: 1, 3).
-   [ ] Wire the theme plugin (`01.theme.client.ts`) to call `applyThemeBackgrounds` whenever `setActiveTheme` resolves, including cleanup of previous theme values (Requirements: 1).
-   [ ] Ensure `applyToRoot` (dashboard settings) invokes the same helper so user overrides retain precedence (Requirements: 3).

## 4. Retro Theme Migration

-   [ ] Populate `app/theme/retro/theme.ts` with a `backgrounds` block mirroring existing textures and remove retro-specific CSS defaults from `assets/css/main.css` (Requirements: 2).
-   [ ] Adjust component-level CSS fallbacks (`ResizableSidebarLayout`, `SidebarHeader`, etc.) to rely on the CSS variables (Requirements: 2).

## 5. Verification & Tooling

-   [ ] Add Vitest coverage for the background helper and update existing theme resolver tests to assert variable updates (Requirements: 1).
-   [ ] Add or update an end-to-end smoke test that flips between `retro` and a neutral theme to confirm backgrounds change without flashes (Requirements: 1, 2).
-   [ ] Document the new `backgrounds` DSL in `docs/` so future theme authors can supply textures without touching core CSS (Requirements: 1, 2, 3).
