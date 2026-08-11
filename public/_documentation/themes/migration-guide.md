# Migration Guide: Legacy -> Refined Theme System

This guide explains how to move from legacy CSS-based theming to the current
theme system.

## What changed

- Themes are defined in `app/theme/<theme>/theme.ts`.
- Component props are driven by overrides bound through `useThemeOverrides()`;
  `v-theme` supplies DOM classes/styles and target annotations.
- CSS variables are generated automatically from `colors`.
- `cssSelectors` are available for third-party DOM and legacy code.

## Step 1: Inventory existing styles

Identify:
- Existing CSS variables (colors, borders, typography).
- Component props hardcoded in templates (variant/size/color).
- Third-party widgets that need direct CSS selectors.

## Step 2: Create a theme

```bash
bun run theme:create
```

Define the new theme:

```ts
import { defineTheme } from '~/theme/_shared/define-theme';

export default defineTheme({
  name: 'my-theme',
  displayName: 'My Theme',
  description: 'Migrated from legacy CSS',
  colors: {
    primary: '#6366f1',
    secondary: '#ec4899',
    surface: '#ffffff',
    onSurface: '#1f2937',
    dark: {
      surface: '#111827',
      onSurface: '#f9fafb',
    },
  },
});
```

Required colors: `primary`, `secondary`, `surface`.

## Step 3: Move hardcoded props into overrides

Before:

```vue
<UButton variant="solid" color="primary" size="lg">Send</UButton>
```

After (theme):

```ts
overrides: {
  'button#chat.send': { variant: 'solid', color: 'primary', size: 'lg' },
}
```

After (component):

```vue
<script setup lang="ts">
const sendTheme = useThemeOverrides({
  component: 'button', context: 'chat', identifier: 'chat.send', isNuxtUI: true,
});
</script>
<UButton v-bind="sendTheme" v-theme="'chat.send'">Send</UButton>
```

## Step 4: Bind component props and annotate DOM targets

Use the resolver result for component props. Add `v-theme` when the rendered
element also needs identifier attributes, theme classes, or inline styles:

```vue
<UButton v-bind="defaultButtonTheme" v-theme>Default</UButton>
<UButton v-bind="sendTheme" v-theme="'chat.send'">Send</UButton>
```

Context is detected from DOM containers. For custom areas, add:

```html
<div data-context="modal">
  <UButton v-theme>Ok</UButton>
</div>
```

## Step 5: Migrate legacy CSS to tokens

Use theme tokens in CSS:

```css
.my-panel {
  background: var(--md-surface);
  color: var(--md-on-surface);
  border: 1px solid var(--md-outline);
}
```

Avoid `rgb(var(--md-primary))` style usage; tokens already contain full values.

### Appearance token fallbacks

For controls, focus, motion, and generic raised surfaces, use the shared
appearance tokens with the pre-migration literal as the fallback:

```css
.my-control {
  min-height: var(--app-control-height-medium, 36px);
  outline-offset: var(--app-focus-ring-offset, 2px);
  transition-duration: var(--app-motion-duration-fast, 150ms);
  box-shadow: var(--app-elevation-medium, 0 4px 10px rgb(0 0 0 / 0.1));
}
```

Theme authors may define `density`, `focus`, `motion`, and `elevation` in
`theme.ts`; all values are optional. The Theme Studio can then apply a
per-light/dark density or elevation preset, or restore the authored value with
Theme default. Focus-ring thickness (1–4px) and System/Reduced motion are
global accessibility preferences. Never use a theme to override the selected
focus width, and preserve a textual or still state when reduced motion stops a
decorative animation.

## Step 6: Use cssSelectors for non-component DOM

```ts
cssSelectors: {
  '.monaco-editor': {
    style: { border: '2px solid var(--md-outline)' },
    class: 'rounded-md shadow-lg',
  },
}
```

If you use `style`, build the static CSS file:

```bash
bun run theme:build-css
```

## Step 7: Update app config and icons (optional)

- `app/theme/<theme>/app.config.ts` merges into full app config.
- `app/theme/<theme>/icons.config.ts` overrides icon tokens.

## Step 8: Test

Validate + generate types:

```bash
bun run theme:validate
```

Switch the runtime theme:

```ts
const { setActiveTheme } = useThemeResolver();
await setActiveTheme('my-theme');
```

Or set the default theme for the app:

```bash
bun run theme:switch
```

## Common pitfalls

- **Missing `v-theme`**: Overrides only apply to themed elements.
- **Wrong context**: Add `data-context` or pass `context` in the directive.
- **State selectors**: `:hover` and `:active` only work if you pass `state`
  into the resolver manually; for DOM states use `cssSelectors` instead.
