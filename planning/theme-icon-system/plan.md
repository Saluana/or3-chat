# Theme Icon Registry Plan

## Goals

-   Replace hardcoded icon names (e.g., `pixelarticons:card-plus`) with theme-aware tokens.
-   Allow each theme to override icons without touching component code.
-   Keep runtime cost negligible (simple object lookups, no extra network fetches).
-   Provide fallback icons so missing overrides never break rendering.

## Proposed Architecture

### 1. Icon Tokens

-   Define a canonical list of semantic identifiers (e.g., `shell.new-pane`, `chat.send`, `sidebar.new-thread`).
-   Store tokens centrally in a TypeScript enum or literal object so components reference tokens instead of raw icon strings.
-   Update Nuxt UI wrappers (`UButton`, etc.) to consume `iconRegistry.get(token)`.

### 2. Registry Implementation

-   Add `app/theme/_shared/icon-registry.ts`:
    -   Holds default icon map (covers every token).
    -   Exposes `registerIcons(themeName, map)` and `getIcon(token, themeName?)`.
    -   During theme activation, load theme-specific icon map and merge with defaults.
    -   Provide development warnings if a theme overrides unknown tokens or misses required icons.

### 3. Theme-Level Configuration

-   Allow each theme folder to export `icons.config.ts` alongside `theme.ts`.
-   Shape:

    ```ts
    import { defineThemeIcons } from '~/theme/_shared/icon-registry';

    export default defineThemeIcons({
        shell: {
            'new-pane': 'pixelarticons:card-plus',
            'sidebar-toggle': 'pixelarticons:arrow-bar-right',
        },
        chat: {
            send: 'i-lucide:send',
        },
    });
    ```

-   CLI (`theme:compile`) loads the icons config when present, validates token names, and embeds compiled icon map into the compiled theme payload.

### 4. Theme Plugin Integration

-   Extend `ThemePlugin` (see `plugins/01.theme.client.ts`) to:
    -   Load compiled icon map when activating a theme.
    -   Push it into `iconRegistry`.
    -   Expose `useIcon(token)` composable returning `computed(() => iconRegistry.get(token, activeTheme.value))` for convenience.
-   Ensure SSR safety by preloading default icons during server render.

### 5. Component Consumption

-   Replace hardcoded icon strings with tokens:
    ```vue
    <UButton :icon="useIcon('shell.new-pane')" />
    ```
    or
    ```ts
    const newPaneIcon = useIconToken('shell.new-pane');
    ```
-   Provide helper for plain strings: `resolveIcon('shell.new-pane')` returning the final icon name (string) for passing into third-party components.

### 6. Developer Ergonomics

-   Generate `ThemeIconToken` union type from the canonical token map for autocomplete.
-   Add lint check or script to ensure no hardcoded icon strings are left.
-   Document workflow in `docs/themes/icon-registry.md` (new file) covering:
    -   How to define tokens.
    -   How to override per theme.
    -   Runtime helpers.

## Rollout Plan

1. **Inventory**: Use grep to list all `icon="` occurrences and categorize tokens.
2. **Token Map**: Create `icon-tokens.ts` listing every identifier and default icon.
3. **Registry Core**: Implement `iconRegistry`, `defineThemeIcons`, and `useIcon` composable.
4. **Theme Compiler**: Update to import optional `icons.config.ts` and emit compiled icon maps.
5. **Plugin Wiring**: Load icon maps when switching themes.
6. **Component Migration**: Replace literals with tokens, starting from high-impact surfaces (`PageShell.vue`, sidebar, chat composer, dashboard).
7. **Testing**: Add unit tests for registry logic and e2e smoke test to ensure icons render after theme switch.
8. **Docs & Linting**: Publish documentation and add CI check preventing raw icon strings.

## Performance Considerations

-   Icon lookups are simple object reads (`O(1)`).
-   Theme switch only loads a single additional JSON blob (~1KB for dozens of tokens).
-   No additional network requests: icon maps bundled with compiled theme payloads.
-   SSR hydration safe: registry seeded before rendering components.

## Risks & Mitigations

-   **Missing tokens**: Provide runtime warning + fallback icon to avoid blank buttons.
-   **Theme drift**: Enforce schema validation during `theme:compile` so custom themes stay consistent.
-   **Developer adoption**: Provide codemod or lint autofix to convert hardcoded strings into tokens.

## Next Steps

1. Approve this plan.
2. Create the canonical token list + defaults.
3. Implement registry + compiler integration.
4. Migrate components incrementally (track progress in checklist).
