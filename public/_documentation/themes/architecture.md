# Theme System Architecture

This document describes how the current OR3 theme system is wired from
definition to runtime application.

## Overview

```
Theme Definition (app/theme/*/theme.ts)
  -> Theme Manifest (import.meta.glob)
  -> Runtime compile + CSS variables
  -> Theme plugin ($theme) applies theme
  -> RuntimeResolver resolves overrides
  -> useThemeOverrides applies Vue props; v-theme decorates DOM targets
  -> cssSelectors apply styles/classes
```

## 1) Theme discovery

`app/theme/_shared/theme-manifest.ts` uses `import.meta.glob` to find:

- `app/theme/*/theme.ts`
- optional `icons.config.ts`
- optional `*.css` stylesheets

The loader still recognizes a legacy `app.config.ts` from installed themes for
compatibility, but new and shipped themes author Nuxt UI recipes in
`theme.ts → ui`.

Each theme becomes a `ThemeManifestEntry` with loaders and metadata.

Default theme precedence is:

1. `runtimeConfig.public.branding.defaultTheme` (if valid)
2. Theme marked with `isDefault`
3. Fallback constant (`retro`)
4. First sorted manifest entry

Multiple manifest defaults are rejected so selection cannot depend on import
order.

In dev mode, OR3 logs one warning when runtime config overrides manifest
default selection.

## 2) Runtime compilation

When a theme is loaded:

- Overrides are compiled with `compileOverridesRuntime()`.
- CSS variables are generated with `generateThemeCssVariables()`.
- A `RuntimeResolver` instance is created for the theme.

The canonical `compileThemeDefinition()` path is shared by the client, SSR,
and build tooling so all environments produce the same payload fields.

## 3) Theme application

Activating a theme does the following:

1. Sets `data-theme="<name>"` on `<html>`.
2. Injects CSS variables into a per-theme `<style>` tag.
3. Loads theme stylesheets declared in `stylesheets`.
4. Loads `/themes/<name>.css` if `cssSelectors.style` exists.
5. Applies `cssSelectors.class` via `applyThemeClasses()`.
6. Applies background layers (`app/core/theme/backgrounds.ts`).
7. Merges the immutable app config, an optional legacy app-config patch, and
   canonical `theme.ui`, in that order.
8. Registers theme icons with `iconRegistry`.
9. Registers packaged workspace profiles
   (`app/plugins/92.workspace-profile-theme.client.ts`) as choices, with the
   theme's `recommendedWorkspaceProfileId` surfaced as a recommendation.

### Visual ownership and cascade

- Theme tokens own shared values.
- `theme.ui` owns generic Nuxt UI controls.
- `theme.overrides` owns context- and identifier-specific controls.
- Theme stylesheets own only CSS-only effects, complex selectors, and
  third-party DOM.

Runtime override classes are ordered generic → context → identifier. This
keeps the most specific utility last for class-merging consumers. Density never
targets every native interactive element; each component opts into its intended
small, medium, or large token. Focus indicators are also attached explicitly
with `:focus-visible`, rather than through a global input selector.

### User theme overrides

Per-user overrides (`app/core/theme/useUserThemeOverrides.ts`) sit on top of
the active theme. Users can change colors, shared shape tokens, background
layers, and base font size without editing the theme. Overrides are stored per
color mode in localStorage (`or3:user-theme-overrides:light` / `:dark`) and
merged into the DOM at runtime. Each group has an `enabled` toggle, and values
are clamped (font size 14-24px, opacity 0-1). See the capability table below.

Typography overrides independently select body and heading fonts from the
bundled font catalog or retain the active theme's authored font for either
role. Existing saved `useSystemFont` values remain supported as a fallback for
profiles created before the independent selectors were introduced.

The color editor presents the highest-impact roles first: accent, app and panel
surfaces, text, borders, hover/selected states, and status colors. Less common
Material roles and individual surface levels remain available in a collapsed
Advanced section. Basic panel/elevated controls update their paired surface
levels, the Borders control also updates the subtle outline role, and primary
accent text is assigned a readable black or white contrast color. The exact
outline role remains independently editable for stronger component outlines.
Success and warning overrides also feed Nuxt UI's extended semantic color
variables.

The editor uses a responsive list-and-detail layout: users select a color role
from the categorized list, then edit that color with one full-size picker, hex
and RGB fields, quick colors, and a contextual preview. The picker is never
visually scaled, so its rendered geometry remains aligned with pointer and
touch coordinates on desktop and mobile.

The Backgrounds section uses the same focused editing model. Workspace base,
workspace overlay, and sidebar appear as lightweight area selectors, while one
inspector edits the selected area's image, layout, opacity, pattern size, and
base color. The master switch preserves saved values when disabled and restores
the active theme's authored backgrounds.

Theme Studio controls use the active theme's paired semantic roles for every
state: primary/on-primary for selected controls, surface/on-surface for neutral
controls, and the corresponding hover or container pair for interaction and
selection. The editor does not impose a fixed accent color, and it always
changes foreground and background together to preserve contrast in both modes.

These mappings are user-override behavior only. With color overrides disabled,
the active theme's authored variables—including custom state tokens—continue to
cascade unchanged. Existing saved detailed values remain supported and editable
under Advanced colors, and disabling then re-enabling colors preserves those
saved values.

The Shape section exposes three border-width tiers and three radius tiers.
`--md-border-width-subtle` is for dividers, `--md-border-width` remains the
standard component token, and `--md-border-width-strong` is for emphasis.
`--md-border-radius-small` is for controls, `--md-border-radius` remains the
standard surface token, and `--md-border-radius-large` is for large surfaces.
The established middle tokens remain the compatibility defaults: the four new
tiers inherit from them until a theme or user override opts in. Shape overrides
are stored separately per color mode, have their own enabled toggle, and
restore the active theme's authored values when disabled. Theme authors can set
the same tiers with `borderWidthSubtle`, `borderWidth`, `borderWidthStrong`,
`borderRadiusSmall`, `borderRadius`, and `borderRadiusLarge` on
`ThemeDefinition`; omitted outer tiers continue to inherit their middle token.
The shipped Blank theme uses a 1px component border by default so inputs and
other neutral controls remain visibly bounded, while its divider and emphasis
tiers remain at 0px to preserve the minimal layout.

Density and elevation use the same per-mode override model. Their constrained
presets set only the five `--app-control-height-*` / `--app-space-*` variables
or the three `--app-elevation-*` variables that the runtime owns. Selecting
Theme default or disabling a group removes those inline declarations and the
`data-density` / `data-elevation` markers, allowing authored theme values and
component-local fallbacks to cascade unchanged. Flat elevation removes generic
depth only; elevated overlays retain their opaque surface and border.

Focus width and motion are global accessibility preferences, rather than
per-mode style overrides. They are persisted in browser localStorage under
`or3:user-theme-accessibility`, apply to both light and dark modes, and are
validated on load. Focus width is 1–4px. Motion is `System` or `Reduced`; the
operating-system reduced-motion preference takes precedence, writing a short
100ms transition tier and stopping decorative loops while status content
remains visible. Themes retain ownership of normal-motion durations, focus
color, focus offset, and their authored elevation stacks through optional
`density`, `focus`, `motion`, and `elevation` fields on `ThemeDefinition`.

The signed-in preference repository is canonical once account storage is
ready. The SSR cookie supplies first paint, and localStorage is a migration and
offline cache. The selected source is exposed for diagnostics. Light/dark mode
is separate and stored in `theme` localStorage via `$theme.set()` and
`$theme.toggle()`.

## 4) Override resolution

`RuntimeResolver` matches overrides by:

- component name
- context (`data-context`)
- identifier (`data-id`)
- state (only when provided)
- HTML attribute selectors (when `element` is provided)

Matches are merged by specificity. Non-Nuxt UI components map `variant`/`size`/
`color` to classes via `propMaps`.

## 5) Component integration

### v-theme

`app/plugins/91.auto-theme.client.ts` provides the directive. It:

- detects component name from the VNode
- auto-detects context from DOM containers
- resolves overrides via `$theme.getResolver()`
- applies owned classes, inline styles, and `data-*` annotations to the rendered
  element

It cannot mutate Vue component props. Bind `useThemeOverrides()` with `v-bind`
when `variant`, `color`, `size`, `ui`, or other component props must change.

### useThemeOverrides

`app/composables/useThemeResolver.ts` provides `useThemeOverrides` for
programmatic resolution and reactive updates on theme changes.

## 6) CSS selectors

`cssSelectors` supports:

- `style`: compiled into `/public/themes/<name>.css` via
  `bun run theme:build-css`
- `class`: applied at runtime via `applyThemeClasses()`

Theme CSS is scoped by `[data-theme="<name>"]` to avoid cross-theme bleed.

## 7) Dynamic DOM

One selector session observes added DOM and applies matching runtime classes.
It tracks only the classes it owns, cancels stale jobs during activation, and
restores classes when a theme is removed. No global force-render mixin or
page-level rescans are required.

## Capability truth table

| Mechanism | Tokens | Vue props | DOM class/style | Trusted code | SSR |
|---|---:|---:|---:|---:|---:|
| Theme colors/fonts/backgrounds | Yes | No | CSS variables | No | Yes |
| `useThemeOverrides()` + `v-bind` | No | Yes | Via bound `class`/`style` | No | Yes |
| `v-theme` | No | No | Yes, owned DOM state | No | Annotation only |
| `cssSelectors.style` | No | No | Yes, generated/scoped | No | Yes |
| `customComponents` | Any | Any | Any | Yes | Yes |
| User overrides | Yes | No | Effective variables/backgrounds | No | Hydrated client |
