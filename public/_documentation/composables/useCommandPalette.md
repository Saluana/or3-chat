# useCommandPalette

Controller for the global command palette. It manages open state, search query, result groups, keyboard selection, previews, and the action tray, and coordinates all search sources through a lazy-loaded coordinator.

## Purpose

`useCommandPalette()` returns a singleton `CommandPaletteController`:

-   State — `isOpen`, `query`, `loading`, `groups`, `flatResults`, `activeKey`, `activeResult`, `activeCategoryId`, `statuses`, `failedStatuses`, `categories`, `preview`, `previewLoading`, `actionTrayOpen`, `secondaryActions`, `announcement`, `errorMessage`, `focusToken`.
-   Actions — `open()`, `close()`, `toggle()`, `setActive(key)`, `activateByPointer(key)`, `hoverActive(key)`, `releaseHoverLock()`, `moveActive(delta)`, `runPrimary()`, `runAction(action, sourceId?)`, `openActionTray()`, `closeActionTray()`, `setCategoryFilter(categoryId)`, `retrySource(sourceId)`, `announce(message)`, `warm()`, `getCoordinator()`.

Module helpers:

-   `setPaletteHostContext(context)` / `getPaletteHostContext()` — register the host that answers "can I open a new pane?" questions.
-   `refreshPaletteRegistrySnapshot()` — bump the registry version after category registrations change.
-   `disposeCommandPalette()` — release the coordinator and listeners.

## Usage

```vue
<script setup lang="ts">
import { useCommandPalette } from '~/composables/search/useCommandPalette';

const palette = useCommandPalette();
</script>

<template>
    <UInput
        v-model="palette.query"
        @focus="palette.open()"
        @keydown.down="palette.moveActive(1)"
        @keydown.enter="palette.runPrimary()"
    />
</template>
```

## Notes

-   The search coordinator code is preloaded during idle time, while workspace indexes are built on first open. After the palette remains closed for two minutes, the coordinator and its indexes are disposed; reopening rebuilds them from current workspace data.
-   Selection lock semantics: keyboard selection wins until the pointer moves; clicked selections stay locked until another explicit click.

## Related

-   `useCommandPaletteShortcut` — the global Cmd/Ctrl+K handler.
-   `useSidebarSearch` / `useThreadSearch` — the search sources feeding results.
