# usePageShellTheme

Theme prop resolver for the app shell chrome: sidebar toggles, pane buttons, and the theme toggle. It resolves which components and button props the shell should render for the active theme.

## Purpose

`usePageShellTheme(themePlugin)` returns:

-   Component pickers — `sidebarExpandedComponent`, `sidebarCollapsedComponent`, `dashboardModalComponent`, `systemPromptsModalComponent`. Each falls back to `CORE_APP_COMPONENT_DEFAULTS` when the theme does not override it.
-   Button props — `sidebarToggleButtonProps`, `newPaneButtonProps`, `themeToggleButtonProps`, `notificationButtonProps`, `headerActionButtonProps`, `paneCloseButtonProps`. Each merges a retro base (`theme-btn`, ghost variant) with theme overrides keyed by identifier (`shell.sidebar-toggle`, `shell.new-pane`, and so on).

When `themePlugin` is `undefined`, button overrides resolve to an empty object and the defaults win.

## Usage

```vue
<script setup lang="ts">
import { usePageShellTheme } from '~/composables/core/usePageShellTheme';

const theme = usePageShellTheme(nuxtApp.$theme);
</script>

<template>
    <UButton v-bind="theme.sidebarToggleButtonProps" icon="i-ph-sidebar" />
</template>
```

## Notes

-   Override identifiers follow the `shell.<control>` naming scheme.
-   `notificationButtonProps` reuses the theme toggle props with `square: true`.

## Related

-   `useThemeResolver` — the override resolution engine.
-   `useChatInputTheme` — themed props for the chat input.
