# useIcon

Reactive resolver for semantic icon tokens. It returns the concrete Iconify name for a token under the active theme.

## Purpose

`useIcon(token)` returns a computed string like `'pixelarticons:home'`. The icon registry maps each token to theme-specific icons, so switching themes updates every `useIcon` result automatically.

## Usage

```vue
<script setup lang="ts">
import { useIcon } from '~/composables/useIcon';

const sidebarIcon = useIcon('shell.sidebar.toggle.left');
</script>

<template>
    <UButton :icon="sidebarIcon" />
</template>
```

## Notes

-   Tokens are defined in `~/config/icon-tokens` (`IconToken` type).
-   Resolution is reactive against the active theme via `useThemeResolver`.

## Related

-   `useThemeResolver` — the active theme source.
-   `~/config/icon-tokens` — the token catalog.
