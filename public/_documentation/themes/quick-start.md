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
  README.md       # theme notes
  styles.css      # optional, only if you add it to stylesheets[]
```

You can also add:

```
app/theme/my-theme/
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

  ui: {
    input: {
      slots: {
        base: 'h-[var(--app-control-height-medium,36px)] rounded-[var(--md-border-radius-small,var(--md-border-radius))]',
      },
    },
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

Paths must resolve to local theme assets. External stylesheets are rejected;
this keeps theme CSS within the deployment's CSP and trust boundary.

## 4) Use the theme in components

### v-theme directive (DOM decoration)

```vue
<template>
  <UButton v-theme>Default button</UButton>
  <UButton v-theme="'chat.send'">Send</UButton>
  <UButton v-theme="{ identifier: 'chat.send', context: 'chat' }">Send</UButton>
</template>
```

`v-theme` adds owned classes, inline styles, and theme data attributes to the
rendered element. It does not change Vue component props.

### Programmatic component props (recommended for components)

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

## 8) Replace whole app surfaces (optional)

If you need to replace a full app component instead of only changing props or
CSS, use `customComponents`.

```ts
customComponents: {
  sidebar: './components/MySidebar.vue',
  'chat-input': './components/MyChatInput.vue',
}
```

Use this for layout-level changes such as:

- a custom sidebar shell
- a redesigned chat input
- a theme-specific message or workflow status surface

For the full contract, lifecycle, and best-practices guide, see
`/themes/component-overrides`.

## Troubleshooting quick hits

- No DOM decoration? Ensure `v-theme` is used and the identifier matches.
- No component prop override? Bind `useThemeOverrides()` with `v-bind`.
- Wrong context? Add `data-context` or use `context` in the directive.
- Missing CSS selector styles? Run `bun run theme:build-css`.
- Component override not showing? Check the `customComponents` key and file path.
- Types missing? Run `bun run theme:validate`.
