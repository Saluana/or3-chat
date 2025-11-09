# User Theme Overrides Composable (`useUserThemeOverrides`)

`useUserThemeOverrides` manages the light and dark customization profiles that sit on top of the compiled theme definitions. It handles persistence, legacy migration, and applies merged overrides to the document so backgrounds, typography, and palette adjustments take effect globally.

Because the composable is HMR-safe and only touches the DOM in the browser, it can be safely imported from components, composables, and client-side plugins.

## Returned API

| Property / Method  | Description                                                         |
| ------------------ | ------------------------------------------------------------------- |
| `overrides`        | Computed ref of the active mode (`UserThemeOverrides`).             |
| `light`, `dark`    | Refs containing the persisted overrides for each mode.              |
| `activeMode`       | Ref<'light' \| 'dark'> reflecting the HTML class list.              |
| `set(patch)`       | Deep merges a partial patch into the active mode (with validation). |
| `reset(mode?)`     | Clears overrides for the provided mode (or the active one).         |
| `resetAll()`       | Clears light and dark overrides.                                    |
| `switchMode(mode)` | Switches active mode and reapplies overrides.                       |
| `reapply()`        | Re-runs `applyMergedTheme()` for the current mode.                  |

Internally the composable also performs:

-   Legacy `ThemeSettings` migration via `migrateFromLegacy()`.
-   Storage round-trips using `or3:user-theme-overrides:light|dark` keys.
-   Mutation observation on `<html class="...">` so external toggles stay in sync.

## Usage Example

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';

const theme = useUserThemeOverrides();
const baseFont = computed(
    () => theme.overrides.value.typography?.baseFontPx ?? 20
);

function increaseFont() {
    theme.set({ typography: { baseFontPx: Math.min(baseFont.value + 1, 24) } });
}

function toggleMode() {
    theme.switchMode(theme.activeMode.value === 'light' ? 'dark' : 'light');
}
</script>

<template>
    <div class="flex gap-3">
        <UButton @click="increaseFont">Font +</UButton>
        <UButton @click="toggleMode"
            >Switch to
            {{ theme.activeMode.value === 'light' ? 'dark' : 'light' }}</UButton
        >
    </div>
</template>
```

## Background Layers and Palette

-   Background layers support public URLs, `blob:` URLs, `data:` URLs, and `internal-file://<hash>` tokens. Internal tokens are resolved with IndexedDB lookups inside `applyThemeBackgrounds()`.
-   Opacity values are clamped to `[0, 1]`. When a layer is cleared, the system writes `none` to the CSS variable and resets opacity to `1` so fallback colors show.
-   The `reducePatternsInHighContrast` flag lowers active opacities to ≤ `0.04` whenever a `*-high-contrast` class is present on `<html>`.
-   Palette overrides only apply when `colors.enabled` is true. Each provided token maps to the Material Design CSS variables (`--md-primary`, `--md-on-primary`, etc.).
-   Custom background colors write to `--app-content-bg-1-color`, `--app-content-bg-2-color`, and `--app-sidebar-bg-color` when `backgrounds.enabled` is true.

## Plugin Integration

Client plugins can consume the composable to react to startup events or expose shortcuts. Example: reapply overrides after the Nuxt app mounts (this is how the main app hydrates defaults):

```ts
// app/plugins/theme-overrides.client.ts
export default defineNuxtPlugin((nuxtApp) => {
    if (import.meta.server) return;
    const overrides = useUserThemeOverrides();
    nuxtApp.hook('app:mounted', () => overrides.reapply());
});
```

Example: register a quick action to enable a textured overlay.

```ts
export default defineNuxtPlugin(() => {
    if (import.meta.server) return;
    const { set } = useUserThemeOverrides();
    window.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === '8') {
            event.preventDefault();
            set({
                backgrounds: {
                    content: {
                        overlay: {
                            url: '/textures/scanline.webp',
                            opacity: 0.12,
                            repeat: 'repeat',
                            sizePx: 160,
                        },
                    },
                },
            });
        }
    });
});
```

## Persistence & Migration Notes

-   Overrides persist in separate light/dark entries under `or3:user-theme-overrides:*`.
-   On first load the composable migrates any legacy `ThemeSettings` keys, stores the converted overrides, and removes the deprecated entries to keep storage clean.
-   Because the composable is a singleton, state is shared across all consumers. Hot Module Replacement clears background blobs to avoid leaking `blob:` URLs.

## Tips

-   `set()` performs a deep merge, so you can supply minimal patches such as `{ colors: { primary: '#ff00aa' } }`.
-   Call `reapply()` after manually toggling `.light`/`.dark`/contrast classes outside of the theme plugin.
-   Use `reset(mode)` for UI buttons that revert only the visible mode, and `resetAll()` for “factory reset” flows.
-   For performance-sensitive flows debounce rapid calls to `set()` (sliders, opacity inputs) before writing to storage.
