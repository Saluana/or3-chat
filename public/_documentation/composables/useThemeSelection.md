# useThemeSelection

Persistence for the user's selected theme. It loads the choice from the Dexie `kv` table (with a one-time `localStorage` migration) and saves changes.

## Purpose

`useThemeSelection()` returns:

-   `selectedTheme` — readonly ref of the theme name (or `null`).
-   `selectionSource` — where the value came from: `'kv'`, `'local-migration'`, or `'none'`.
-   `setSelectedTheme(name)` — persist and apply the choice.
-   `ensureLoaded()` — force-load the selection (client only).

Module helper:

-   `getThemeSelectionSync()` — synchronous read for plugin initialization; falls back to `localStorage` before KV loads.

## Usage

```ts
import { useThemeSelection } from '~/composables/useThemeSelection';

const { selectedTheme, setSelectedTheme } = useThemeSelection();

function onPick(name: string) {
    void setSelectedTheme(name);
}
```

## Notes

-   The storage key is `theme_selection` in `kv`; the legacy `localStorage` key is only used for migration.
-   Saves are serialized so rapid changes do not race.

## Related

-   `useThemeResolver` — applies the selected theme.
-   `useAiSettings` — follows the same KV storage pattern.
