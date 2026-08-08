# useThemeResolver

Core theming API. It resolves theme overrides for components, tracks the active theme, and switches themes.

## Purpose

`useThemeResolver()` returns:

-   `activeTheme` — computed name of the current theme.
-   `resolveOverrides({ component, context, identifier, state?, isNuxtUI? })` — resolve override props for one element. Returns `{}` when the theme has no resolver.
-   `setActiveTheme(name)` — switch themes.

`useThemeOverrides(params)` is the reactive wrapper: it returns a computed that re-resolves when the theme changes and caches results per component instance.

## Usage

```ts
import { useThemeResolver, useThemeOverrides } from '~/composables/useThemeResolver';

const { activeTheme, setActiveTheme } = useThemeResolver();

const overrides = useThemeOverrides({
    component: 'button',
    context: 'chat',
    identifier: 'chat.send',
    isNuxtUI: true,
});
```

```vue
<UButton v-bind="overrides">Send</UButton>
```

## Notes

-   `isNuxtUI` selects the Nuxt UI override resolution path versus plain elements.
-   Element-scoped matches depend on live DOM and are not cached.
-   In dev, missing resolvers log a warning.

## Related

-   `useTypedThemeOverrides` — type-safe wrappers (`useButtonOverrides`, etc.).
-   `useThemeSelection` — which theme is selected.
-   `useChatInputTheme` / `usePageShellTheme` — themed prop bundles built on this API.
