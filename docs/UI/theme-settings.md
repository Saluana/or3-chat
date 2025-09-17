# Theme Settings Composable (useThemeSettings)

The `useThemeSettings` composable manages the app's theme profiles (light/dark), persists changes to localStorage, and applies CSS variables to the document root.

It is safe to use from components and client plugins. On SSR it no-ops DOM writes and will initialize when running in the browser.

## What it provides

-   `settings` — a computed ref of the active profile (`ThemeSettings`)
-   `light`, `dark` — refs holding the full theme profiles
-   `activeMode` — ref<'light' | 'dark'> with current mode
-   `set(patch)` — merge a partial patch into the active profile (clamped/sanitized)
-   `setForMode(mode, patch)` — update a specific profile regardless of active
-   `reset(mode?)` — reset the current or specified profile to defaults
-   `resetAll()` — reset both light and dark to defaults
-   `load()` — re-load the active profile from localStorage (if present) and apply
-   `reapply()` — re-apply current settings to the DOM (useful after class changes)
-   `switchMode(mode)` — switch the active profile and apply
-   `applyToRoot(settings)` — low-level function to apply any `ThemeSettings` to CSS vars

It also re-exports:

-   `DEFAULT_THEME_SETTINGS_LIGHT`, `DEFAULT_THEME_SETTINGS_DARK`
-   `THEME_SETTINGS_STORAGE_KEY(_LIGHT|_DARK)`

Types live in `app/composables/theme-types.ts` and defaults/keys in `app/composables/theme-defaults.ts`.

## Quick usage in a component

```ts
<script setup lang="ts">
import { useThemeSettings } from '~/composables/useThemeSettings';

const { settings, set, switchMode, activeMode } = useThemeSettings();

function bigger() {
  set({ baseFontPx: settings.value.baseFontPx + 1 });
}

function toggleMode() {
  switchMode(activeMode.value === 'light' ? 'dark' : 'light');
}
</script>

<template>
  <div class="flex gap-2 items-center">
    <button @click="bigger">A+</button>
    <button @click="toggleMode">Toggle {{ activeMode }}</button>
  </div>
</template>
```

## Backgrounds, colors, and palette

-   Background images accept absolute URLs, data URLs, `blob:` URLs, or `internal-file://<hash>` tokens. Internal tokens are resolved to object URLs automatically via IndexedDB.
-   Opacity values are clamped 0..1. If a layer has no image, its effective opacity becomes `1` so solid colors show.
-   When `reducePatternsInHighContrast` is true and the document has a `*-high-contrast` class, background opacities are clamped to <= 0.04.
-   If `customBgColorsEnabled` is true, the following color vars are set: `contentBg1Color`, `contentBg2Color`, `sidebarBgColor`, `headerBgColor`, `bottomBarBgColor`.
-   If `paletteEnabled` is true, the following CSS vars are set: `--md-primary`, `--md-secondary`, `--md-error`, `--md-surface-variant`, `--md-inverse-surface`, `--md-surface`.

## Using from a client plugin

Plugins can react to app events or provide UI to tweak the theme. The simplest pattern is to register a small UI action or run side effects on app start.

Example: add a keyboard shortcut to toggle theme mode.

```ts
// app/plugins/theme-toggle.client.ts
export default defineNuxtPlugin(() => {
    if (process.server) return;
    const { switchMode, activeMode } = useThemeSettings();
    const onKey = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
            e.preventDefault();
            switchMode(activeMode.value === 'light' ? 'dark' : 'light');
        }
    };
    window.addEventListener('keydown', onKey);
    if (import.meta.hot)
        import.meta.hot.dispose(() =>
            window.removeEventListener('keydown', onKey)
        );
});
```

Example: a Message Action that bumps font size by +1.

```ts
// app/plugins/examples/message-theme-actions.client.ts
import { registerMessageAction } from '~/plugins/message-actions.client';

export default defineNuxtPlugin(() => {
    const { set, settings } = useThemeSettings();
    registerMessageAction({
        id: 'theme:font-plus',
        icon: 'i-lucide-type',
        tooltip: 'Increase base font size',
        showOn: 'both',
        order: 300,
        async handler() {
            set({ baseFontPx: Math.min(24, settings.value.baseFontPx + 1) });
        },
    });
});
```

## Persistence and migration

-   Each profile persists to its own key: `theme:settings:v1:light` and `theme:settings:v1:dark`.
-   A legacy combined key `theme:settings:v1` is still read/written for backward compatibility (migration pre-populates the light profile on first run if only the legacy key exists).

## Gotchas and tips

-   DOM writes only happen in the browser. On SSR or tests, the composable initializes state without touching `document`.
-   If you manually add or remove classes like `dark-high-contrast` on `<html>`, call `reapply()` to force CSS var updates under the new state.
-   When providing custom backgrounds via internal files, ensure the file blob exists in the DB; missing hashes will safely no-op.
-   For larger integrations, prefer `setForMode('light'|'dark', patch)` so you don’t clobber the currently active profile unexpectedly.
