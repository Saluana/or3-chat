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
- optional `app.config.ts`
- optional `icons.config.ts`
- optional `*.css` stylesheets

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
7. Merges `app.config.ts` and `theme.ui` into `app.config`.
8. Registers theme icons with `iconRegistry`.

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
