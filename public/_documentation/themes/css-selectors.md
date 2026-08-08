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
- Automatically for newly added DOM: a session observes added nodes and
  applies matching classes (covers lazy-loaded components)
- On demand via `applyThemeClasses()`

The old `useThemeClasses()` helper (from `app/composables/core/useThemeClasses.ts`)
is deprecated and is now a no-op; lazy-loaded components are covered by the
DOM observer.

## Dynamic DOM updates

If you inject DOM outside Vue (or after the theme applies), the session's
observer picks it up automatically. You can also re-run manually:

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
- No classes? The DOM observer applies classes automatically; verify the
  selector matches real markup. The old `useThemeClasses()` helper is
  deprecated and is now a no-op.
- Specificity issues? Check competing CSS in DevTools.
