# CSS Selectors

`cssSelectors` lets themes target DOM that cannot easily use component
overrides (third-party widgets, portals, legacy HTML).

## How it works

Each selector supports:

- `style`: compiled into `/public/themes/<theme>.css` (build time).
- `class`: applied at runtime via `applyThemeClasses()`.

Example:

```ts
cssSelectors: {
  '.monaco-editor': {
    style: { border: '2px solid var(--md-outline)' },
    class: 'rounded-md shadow-lg',
  },
}
```

## Build-time CSS

`style` entries are compiled by:

```bash
bun run theme:build-css
```

The result is loaded by the theme plugin as:

```
/themes/<theme>.css
```

This file is scoped with `[data-theme="<name>"]` so only the active theme
applies.

## Runtime classes

`class` entries are applied at runtime:

- On theme activation (see `app/plugins/90.theme.client.ts`)
- On page navigation (`page:finish` hook, debounced)
- On demand via `applyThemeClasses()`

For lazy-loaded components, use:

```ts
import { useThemeClasses } from '~/composables/core/useThemeClasses';
useThemeClasses();
```

## Dynamic DOM updates

If you inject DOM outside Vue (or after the theme applies), re-run:

```ts
import { applyThemeClasses } from '~/theme/_shared/css-selector-runtime';

const theme = await nuxtApp.$theme.loadTheme(nuxtApp.$theme.activeTheme.value);
if (theme?.cssSelectors) {
  applyThemeClasses(nuxtApp.$theme.activeTheme.value, theme.cssSelectors);
}
```

## Tips

- Use `style` for static CSS values (zero runtime cost).
- Use `class` for Tailwind utilities or responsive variants.
- Keep selectors specific to avoid accidental matches.

## Troubleshooting

- No styles? Ensure `bun run theme:build-css` has been run.
- No classes? Verify elements exist and call `useThemeClasses()` for lazy
  components.
- Specificity issues? Check competing CSS in DevTools.
