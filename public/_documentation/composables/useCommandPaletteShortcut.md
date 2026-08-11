# useCommandPaletteShortcut

Global keyboard handler for the command palette. It binds Cmd/Ctrl+K to open the palette and Escape to close it, then preloads the search code during idle time.

## Purpose

`useCommandPaletteShortcut()` registers window listeners while the component is mounted:

-   `Cmd+K` or `Ctrl+K` — opens the palette (capture phase, so it wins over pane-local handlers). Repeated presses refocus instead of stacking overlays.
-   `Escape` — closes the palette when it is open.
-   Idle time preloads the coordinator code. Workspace content is indexed only when the palette is opened, avoiding an always-resident copy of every searchable record.

Listeners are removed on unmount.

## Usage

```vue
<script setup lang="ts">
import { useCommandPaletteShortcut } from '~/composables/search/useCommandPaletteShortcut';

useCommandPaletteShortcut(); // in the shell layout
</script>
```

## Notes

-   Events that are already handled or composing (IME) are ignored.
-   Alt or Shift modifiers disable the shortcut.

## Related

-   `useCommandPalette` — the controller this wires up.
