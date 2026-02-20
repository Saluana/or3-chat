# Quick Start: Create a Theme

This guide walks through creating a theme and wiring it into components.

## Prerequisites

- OR3 dev environment set up
- Basic CSS and Tailwind familiarity

## 1) Scaffold a theme

```bash
bun run theme:create
```

This creates:

```
app/theme/my-theme/
  theme.ts
  styles.css        # optional, only if you add it to stylesheets[]
```

You can also add:

```
app/theme/my-theme/
  app.config.ts     # optional app config patch
  icons.config.ts   # optional icon overrides
  styles/           # optional TS style helpers
```

## 2) Define the theme

```ts
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
  name: 'my-theme',
  displayName: 'My Theme',
  description: 'A clean, minimal theme',

  colors: {
    primary: '#086db8',
    secondary: '#ff6b6b',
    surface: '#ffffff',
    onSurface: '#1f2937',
    dark: {
      primary: '#2c638b',
      surface: '#0b0b0b',
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
    'button#chat.send': { color: 'primary', size: 'lg' },
  },
});
```

Required colors: `primary`, `secondary`, `surface`. `onPrimary`,
`onSecondary`, and `onSurface` are recommended.

## 3) Add stylesheets (optional)

If you want a theme CSS file:

```ts
stylesheets: ['./styles.css'],
```

Paths can be `./styles.css`, `~/theme/my-theme/styles.css`, or external URLs.

## 4) Use the theme in components

### v-theme directive (recommended)

```vue
<template>
  <UButton v-theme>Default button</UButton>
  <UButton v-theme="'chat.send'">Send</UButton>
  <UButton v-theme="{ identifier: 'chat.send', context: 'chat' }">Send</UButton>
</template>
```

### Programmatic overrides

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

## 5) Contexts and identifiers

Selectors use `data-context` and `data-id`:

```ts
overrides: {
  'button.chat': { variant: 'ghost' },      // data-context="chat"
  'button#chat.send': { color: 'primary' }, // data-id="chat.send"
}
```

Context auto-detection only covers a few containers:

- `#app-chat-container` or `[data-context="chat"]`
- `#app-sidebar` or `[data-context="sidebar"]`
- `#app-dashboard-modal` or `[data-context="dashboard"]`
- `#app-header` or `[data-context="header"]`

For other contexts, add `data-context="your-context"` on a wrapper.

## 6) cssSelectors (optional)

Use this for third-party or legacy DOM:

```ts
cssSelectors: {
  '.monaco-editor': {
    style: { border: '2px solid var(--md-outline)' },
    class: 'rounded-md shadow-lg',
  },
}
```

If you use `style`, build the CSS file:

```bash
bun run theme:build-css
```

## 7) Activate the theme

To switch at runtime:

```ts
const { setActiveTheme } = useThemeResolver();
await setActiveTheme('my-theme');
```

To change the default theme for the app:

```bash
bun run theme:switch
```

## Troubleshooting quick hits

- No overrides? Ensure `v-theme` is used and the identifier matches.
- Wrong context? Add `data-context` or use `context` in the directive.
- Missing CSS selector styles? Run `bun run theme:build-css`.
- Types missing? Run `bun run theme:validate`.
