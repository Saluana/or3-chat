# Theme Icon System Tasks

## 1. Core Infrastructure

-   [x] **1.1 Define Canonical Token List**

    -   Create `app/config/icon-tokens.ts`.
    -   Define `DEFAULT_ICONS` object with all necessary semantic tokens and their default values (Lucide/Heroicons).
    -   Export `IconToken` type derived from keys.
    -   _Requirements: 2.1.1, 2.1.3, 2.4.1_

-   [x] **1.2 Implement Icon Registry**

    -   Create `app/theme/_shared/icon-registry.ts`.
    -   Implement `IconRegistry` class with `registerTheme`, `setActiveTheme`, and `resolve` methods.
    -   Ensure fallback logic is robust.
    -   _Requirements: 2.3.1, 2.3.2, 2.3.3, 3.1.1_

-   [x] **1.3 Create Vue Plugin/Composable**
    -   Create `app/plugins/icon-registry.ts` to instantiate and inject the registry.
    -   Create `app/composables/useIcon.ts` for reactive token resolution.
    -   _Requirements: 2.4.2, 3.2.1_

## 2. Build System Updates

-   [x] **2.1 Update Theme Compiler**

    -   Modify `scripts/theme-compiler.ts` to look for `icons.config.ts`.
    -   Implement validation logic to ensure keys match `IconToken`.
    -   Include the `icons` object in the compiled theme JSON output.
    -   _Requirements: 2.2.1, 2.2.2, 2.2.3_

-   [x] **2.2 Update Theme Loader**
    -   Modify `app/plugins/theme.client.ts` (or equivalent) to read the `icons` property from the loaded theme JSON.
    -   Call `iconRegistry.registerTheme` with the loaded data.
    -   _Requirements: 2.3.1, 3.1.2_

## 3. Migration & Refactoring

-   [ ] **3.1 Inventory Hardcoded Icons**

    -   Search codebase for `icon="`, `icon:`, and specific icon prefixes (e.g., `i-lucide`, `heroicons`).
    -   Map found icons to semantic tokens in `app/config/icon-tokens.ts`.

-   [ ] **3.2 Refactor Components (Phase 1: Shell)**

    -   Update `PageShell.vue`, `Sidebar.vue`, and navigation components to use `useIcon`.
    -   _Requirements: 2.1.2_

-   [ ] **3.3 Refactor Components (Phase 2: Chat)**

    -   Update chat input, message actions, and thread list to use `useIcon`.
    -   _Requirements: 2.1.2_

-   [ ] **3.4 Refactor Components (Phase 3: Dashboard & Settings)**
    -   Update remaining UI components.
    -   _Requirements: 2.1.2_

## 4. Documentation & Testing

-   [ ] **4.1 Add Unit Tests**

    -   Test `IconRegistry` logic (overrides, fallbacks).
    -   Test `useIcon` reactivity.
    -   _Requirements: 3.2.2_

-   [ ] **4.2 Create Developer Documentation**
    -   Create `docs/theme-icons.md`.
    -   Document how to add new tokens.
    -   Document how to override icons in a theme.
    -   _Requirements: 2.4.1_
