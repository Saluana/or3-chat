# Theme System (Refined)

This README describes how the current theme system works in this repo and how
to integrate it into components and plugins.

## Quick mental model

1. Themes live in `app/theme/<theme>/theme.ts` and are discovered via
   `import.meta.glob` (see `app/theme/_shared/theme-manifest.ts`).
2. The theme plugin (`app/plugins/90.theme.client.ts` and
   `app/plugins/90.theme.server.ts`) loads theme definitions, compiles overrides,
   injects CSS variables, and applies selectors/backgrounds.
3. Components bind reactive props from `useThemeOverrides`; `v-theme` is the
   compatibility DOM class/style and target-annotation directive.
4. Optional theme assets include UI config, icon maps, backgrounds, and
   stylesheet files.

## Theme package structure

Example layout:

```
app/theme/blank/
  theme.ts             # Required definition, tokens, and Nuxt UI recipes
  icons.config.ts      # Optional icon overrides
  styles.css           # Optional stylesheet (loaded via stylesheets[])
  styles/              # Optional theme-specific TS style helpers
```

Themes are discovered from any `app/theme/*/theme.ts` directory (excluding
`_shared`).

## Authoring a theme

Themes use `defineTheme` from `app/theme/_shared/define-theme.ts`. A minimal
example:

```ts
import { defineTheme } from '../_shared/define-theme';

export default defineTheme({
  name: 'blank',
  displayName: 'Blank',
  description: 'Minimal theme',
  isDefault: true,

  colors: {
    primary: '#086DB8',
    secondary: '#ff6b6b',
    surface: '#ffffff',
    onSurface: '#022344',
    dark: {
      primary: '#2C638B',
      surface: '#000000',
      onSurface: '#e2e2e6',
    },
  },

  fonts: {
    sans: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    heading: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    baseSize: '16px',
  },

  overrides: {
    button: { variant: 'solid', size: 'md' },
    'button.chat': { variant: 'ghost' },
    'button#chat.send': { variant: 'solid', color: 'primary' },
  },
});
```

Key fields you can use:

- `colors` and `fonts`: generate their shared CSS variables.
- `borderWidthSubtle`, `borderWidth`, `borderWidthStrong`: define divider,
  component, and emphasis widths.
- `borderRadiusSmall`, `borderRadius`, `borderRadiusLarge`: define control,
  surface, and large-surface rounding.
- `overrides`: selector-driven component overrides resolved at runtime.
- `cssSelectors`: direct DOM targeting for third-party or legacy elements.
- `stylesheets`: optional CSS files to load per theme.
- `ui`: canonical Nuxt UI component recipes merged into `app.config.ui`.
- `propMaps`: map `variant`/`size`/`color` props to classes for non-Nuxt UI components.
- `backgrounds`: theme background layers (applied via `app/core/theme/backgrounds.ts`).
- `icons`: inlined icon overrides (or use `icons.config.ts`).

### Appearance tokens

Themes can optionally author the shared appearance contract. Every field is
optional: components must retain a literal fallback so existing and third-party
themes keep their baseline geometry and effects when a token is absent.

```ts
density: {
  controlHeightSmall: '32px',
  controlHeightMedium: '36px',
  controlHeightLarge: '44px',
  spaceControl: '8px',
  spaceSection: '16px',
},
focus: {
  ringColor: 'var(--md-primary)',
  ringOffset: '2px',
},
motion: {
  durationFast: '150ms',
  durationMedium: '200ms',
  durationSlow: '300ms',
  easingStandard: 'ease',
},
elevation: {
  low: '0 1px 2px rgb(0 0 0 / 0.05)',
  medium: '0 4px 10px rgb(0 0 0 / 0.1)',
  high: '0 12px 28px rgb(0 0 0 / 0.14)',
},
```

These generate `--app-control-height-*`, `--app-space-*`,
`--md-focus-ring`, `--app-focus-ring-offset`, `--app-motion-*`, and
`--app-elevation-*`. Use them with local fallbacks, for example:

```css
.toolbar-button {
  min-height: var(--app-control-height-small, 32px);
  transition-duration: var(--app-motion-duration-fast, 150ms);
  box-shadow: var(--app-elevation-low, 0 1px 2px rgb(0 0 0 / 0.05));
}
```

`--app-focus-ring-width` is intentionally not theme-authored. It is the
global accessibility preference (1–4px) and defaults to 2px.

### User appearance preferences

Theme Studio offers per-color-mode density (`Theme default`, `Compact`,
`Comfortable`, `Spacious`) and elevation (`Theme default`, `Flat`, `Subtle`,
`Expressive`) presets. A disabled group retains its selected value but removes
only the inline variables owned by the preference, revealing the active
theme's authored values again.

Focus-ring thickness and motion preference are global browser-local
accessibility settings stored in `or3:user-theme-accessibility`. Motion offers
`System` and `Reduced`; an operating-system reduced-motion preference always
wins. Reduced motion limits transitions to 100ms and stops decorative loops
without hiding the corresponding status content.

## Override selector syntax

Selectors are CSS-like and are normalized into `data-*` attributes:

- `button` applies to all buttons.
- `button.chat` expands to `button[data-context="chat"]`.
- `button#chat.send` expands to `button[data-id="chat.send"]`.
- `button:hover` is a state selector (see note below).
- `button[aria-expanded="true"]` uses attribute matching on the real element.

Known contexts are listed in `app/theme/_shared/contexts.ts`. Only a subset is
auto-detected (see "Context detection" below).

Important: state selectors (`:hover`, `:active`, etc.) only work when you pass
`state` into the resolver. The `v-theme` directive always uses
`state: 'default'`, so state-based overrides will not match unless you resolve
manually or use `cssSelectors` instead.

## How runtime theming is applied

When a theme becomes active, the theme plugin:

1. Loads the theme definition and optional icons. Legacy installed themes may
   still provide `app.config.ts` while they migrate.
2. Compiles overrides (`app/theme/_shared/runtime-compile.ts`) and instantiates
   a `RuntimeResolver`.
3. Injects CSS variables into a per-theme `<style>` tag.
4. Applies `data-theme="<name>"` to `<html>` for CSS scoping.
5. Loads per-theme stylesheets and `/themes/<name>.css` if needed.
6. Applies `cssSelectors` runtime classes with
   `applyThemeClasses()` in `app/theme/_shared/css-selector-runtime.ts`.
7. Applies theme backgrounds and registers icon overrides.

Theme selection is persisted in `localStorage`/cookies (`or3_active_theme`).
Light/dark mode is tracked separately via the older `theme.set()` API and
applies classes like `light`/`dark` to `<html>`.

## Component integration

### 1) `v-theme` directive (DOM decoration)

The directive auto-detects component name and context, resolves overrides, and
applies owned classes, inline styles, and `data-*` annotations to the rendered
DOM node:

```vue
<template>
  <!-- Auto-detect component name and context -->
  <UButton v-theme>Default themed button</UButton>

  <!-- Explicit identifier -->
  <UButton v-theme="'chat.send'">Send</UButton>

  <!-- Full control -->
  <UButton
    v-theme="{ identifier: 'chat.send', theme: 'blank', context: 'chat' }"
  >
    Send
  </UButton>
</template>
```

Notes:

- The directive cannot mutate Vue component props such as `variant`, `color`,
  `size`, or `ui`. Use `useThemeOverrides()` with `v-bind` for those.
- Vue warns on directives used on components with non-element roots. The
  directive still works (it targets the rendered root), but if the warning is
  noisy wrap the component in a plain element or use `useThemeOverrides`.
- The directive adds `data-id`, `data-theme-color`, `data-theme-variant`,
  `data-theme-size`, and `data-v-theme` attributes to the rendered element.

### 2) `useThemeOverrides` (programmatic + reactive)

Use this when you need explicit control or want to avoid the directive warning:

```vue
<script setup lang="ts">
const overrides = useThemeOverrides({
  component: 'button',
  context: 'chat',
  identifier: 'chat.send',
  isNuxtUI: true,
});
</script>

<template>
  <UButton v-bind="overrides">Send</UButton>
</template>
```

For custom (non-Nuxt UI) components, map `variant`/`size`/`color` to classes by
setting `isNuxtUI: false` and ensuring your root element accepts `class`:

```vue
<script setup lang="ts">
const overrides = useThemeOverrides({
  component: 'pane',
  context: 'sidebar',
  isNuxtUI: false,
});
</script>

<template>
  <div v-bind="overrides">Custom pane</div>
</template>
```

### 3) `useThemeResolver` (one-off resolution)

```ts
const { resolveOverrides } = useThemeResolver();
const props = resolveOverrides({
  component: 'input',
  context: 'global',
  identifier: 'search.query',
});
```

## Context detection

`v-theme` detects context via DOM ancestry:

- `#app-chat-container` or `[data-context="chat"]`
- `#app-sidebar` or `[data-context="sidebar"]`
- `#app-dashboard-modal` or `[data-context="dashboard"]`
- `#app-header` or `[data-context="header"]`
- fallback: `global`

For other contexts (see `app/theme/_shared/contexts.ts`), add a
`data-context="<name>"` attribute to a wrapper element.

## Plugin integration

Theme APIs are available on the Nuxt app instance:

```ts
export default defineNuxtPlugin((nuxtApp) => {
  const theme = nuxtApp.$theme;

  // Switch themes
  void theme.setActiveTheme('blank');

  // Resolve overrides for a third-party element
  const resolver = theme.getResolver(theme.activeTheme.value);
  if (resolver) {
    const el = document.querySelector('#external-widget');
    if (el instanceof HTMLElement) {
      const resolved = resolver.resolve({
        component: 'widget',
        context: 'global',
        element: el,
        isNuxtUI: false,
      });
      if (resolved.props.class) {
        el.classList.add(...String(resolved.props.class).split(' '));
      }
    }
  }
});
```

The plugin also exposes:

- `activeTheme` (ref)
- `resolversVersion` (increments after theme application)
- `getTheme()` and `loadTheme()` for cached definitions

## CSS selector targeting

Use `cssSelectors` when you need to style non-component DOM (Monaco, TipTap,
modal roots, etc.). Each selector supports:

- `style`: compiled into `/public/themes/<name>.css` by
  `bun run theme:build-css`
- `class`: applied at runtime via `applyThemeClasses()`

Example:

```ts
cssSelectors: {
  '.monaco-editor': {
    style: { border: '2px solid var(--md-outline)' },
    class: 'rounded-md shadow-lg',
  },
}
```

## Visual ownership and Nuxt UI integration

Every visual decision has one authoring owner:

- Shared values such as color, radius, focus color, density, motion, and
  elevation belong to tokens in `theme.ts`.
- Generic Nuxt UI component recipes belong to `theme.ui` in `theme.ts`.
- Context-specific app controls belong to `theme.overrides`.
- Stylesheets are an escape hatch for pseudo-elements, animations, third-party
  DOM, and selectors the component APIs cannot express.

Do not restyle a generic input, button, select, or tab in the stylesheet when
`theme.ui` can express the same decision. Density is likewise opt-in: component
recipes consume the appropriate small/medium/large token instead of relying on
a global selector that resizes every interactive element.

At runtime the app config order is immutable base config, legacy
`app.config.ts` compatibility patch, then canonical `theme.ui`. Contextual
component overrides are applied afterward, from generic to specific, so an
identifier override wins over a context override and a context override wins
over the generic component recipe.

## Icons

Themes can override icon tokens via:

- `icons` in `theme.ts`, or
- `icons.config.ts` in the theme directory

Use `useIcon()` to resolve tokens for the current theme:

```vue
<script setup>
const icon = useIcon('chat.send');
</script>

<template>
  <UButton :icon="icon">Send</UButton>
</template>
```

## Tooling

- `bun run theme:create` scaffolds a new theme.
- `bun run theme:validate` validates themes and generates
  `types/theme-generated.d.ts`.
- `bun run theme:build-css` builds `/public/themes/<name>.css` from
  `cssSelectors` that use `style`.
- `bun run theme:switch` updates `OR3_DEFAULT_THEME` in `.env`.
- `bun run test:e2e:theme-tokens` runs the shipped-theme appearance matrix.

## Debugging tips

- In dev, resolved props include `data-theme-target` and
  `data-theme-matches` for visibility into selector matching.
- Elements themed via the directive include `data-v-theme`.
- If overrides do not apply, verify component name, context, and identifier,
  then check that the theme is active and loaded.
