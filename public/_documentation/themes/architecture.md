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
  -> v-theme / useThemeOverrides apply props
  -> cssSelectors apply styles/classes
```

## 1) Theme discovery

`app/theme/_shared/theme-manifest.ts` uses `import.meta.glob` to find:

- `app/theme/*/theme.ts`
- optional `app.config.ts`
- optional `icons.config.ts`
- optional `*.css` stylesheets

Each theme becomes a `ThemeManifestEntry` with loaders and metadata. The
default theme is taken from `isDefault` or the first discovered theme.

## 2) Runtime compilation

When a theme is loaded:

- Overrides are compiled with `compileOverridesRuntime()`.
- CSS variables are generated with `generateThemeCssVariables()`.
- A `RuntimeResolver` instance is created for the theme.

This happens in `app/plugins/90.theme.client.ts` (client) and
`app/plugins/90.theme.server.ts` (SSR).

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

Theme selection is stored in `localStorage` (`activeTheme`) and a cookie
(`or3_active_theme`). Light/dark mode is separate and stored in `theme`
localStorage via `$theme.set()` and `$theme.toggle()`.

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
- applies props and data attributes

### useThemeOverrides

`app/composables/useThemeResolver.ts` provides `useThemeOverrides` for
programmatic resolution and reactive updates on theme changes.

## 6) CSS selectors

`cssSelectors` supports:

- `style`: compiled into `/public/themes/<name>.css` via
  `bun run theme:build-css`
- `class`: applied at runtime via `applyThemeClasses()`

Theme CSS is scoped by `[data-theme="<name>"]` to avoid cross-theme bleed.

## 7) Lazy components

Lazy-loaded components are re-rendered on theme changes via
`app/plugins/92.theme-lazy-sync.client.ts`. For DOM elements that appear
after theme application, use `useThemeClasses()` to re-apply selector classes.
