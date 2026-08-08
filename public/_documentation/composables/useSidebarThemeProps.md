# useSidebarThemeProps

Theme-aware props for the sidebar's project selector and form fields.

## Purpose

`useSidebarThemeProps()` returns:

-   `projectSelect` — computed props for the project select menu. Theme overrides (identifier `sidebar.project-select`) are merged and a `w-full` class is always applied.
-   `formField` — computed theme overrides for `formField` components in the sidebar context.

Both come from `useThemeOverrides` with `isNuxtUI: true`, so themes can target them by identifier.

## Usage

```vue
<script setup lang="ts">
import { useSidebarThemeProps } from '~/composables/sidebar/useSidebarThemeProps';

const { projectSelect, formField } = useSidebarThemeProps();
</script>

<template>
    <USelectMenu v-bind="projectSelect" :options="projects" />
</template>
```

## Notes

-   Overrides win over defaults; the width class is preserved regardless.

## Related

-   `useThemeResolver` — the override engine.
-   `useSidebarProjectDisplay` — the data for the select options.
