# useThemeClasses

Deprecated no-op composable.

## Purpose

`useThemeClasses()` previously applied theme selector classes to lazy-loaded components after mount. The active theme's selector classes are now applied automatically whenever DOM nodes are added, so calling this composable is no longer needed.

In dev mode it logs a deprecation warning.

## Usage

Do not call it in new code:

```ts
useThemeClasses(); // deprecated — no-op
```

## Related

-   `useThemeResolver` — the current theming entry point.
-   `useThemeSelection` — reading and persisting the selected theme.
