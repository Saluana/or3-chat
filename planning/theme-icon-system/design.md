# Theme Icon System Design

## 1. Overview

The Theme Icon System introduces an abstraction layer between UI components and icon libraries. It uses a "Registry" pattern where semantic tokens are mapped to concrete icon strings. This mapping is determined by the currently active theme, with a robust fallback to a default set.

## 2. Architecture

### 2.1. Data Flow

1.  **Build Time:**

    -   `icons.config.ts` in a theme folder is read by the Theme Compiler.
    -   The compiler validates tokens against the canonical `IconToken` type.
    -   The compiler merges theme overrides with the `DefaultIconMap`.
    -   The resulting map is embedded into the compiled theme JSON.

2.  **Runtime (Initialization):**

    -   The `IconRegistry` is initialized with the `DefaultIconMap`.
    -   When a theme is loaded, its specific icon map is registered in the `IconRegistry`.

3.  **Runtime (Render):**
    -   Components call `useIcon('token.name')`.
    -   The composable queries `IconRegistry` for the current theme.
    -   `IconRegistry` returns the override if present, or the default.
    -   The result is a reactive string passed to `<UIcon>` or `<UButton>`.

### 2.2. Components

#### 2.2.1. Icon Registry (`app/theme/_shared/icon-registry.ts`)

Central singleton responsible for storing maps and resolving tokens.

```typescript
export type IconToken =
    | 'shell.sidebar.toggle'
    | 'shell.pane.add'
    | 'chat.message.send';
// ... generated from source of truth

export interface IconMap {
    [key: string]: string; // Token -> Icon Name
}

class IconRegistry {
    private defaults: IconMap;
    private themes: Map<string, IconMap> = new Map();
    private activeTheme: string = 'default';

    constructor(defaults: IconMap) {
        this.defaults = defaults;
    }

    registerTheme(themeName: string, icons: IconMap) {
        this.themes.set(themeName, icons);
    }

    setActiveTheme(themeName: string) {
        this.activeTheme = themeName;
    }

    resolve(token: IconToken): string {
        const themeMap = this.themes.get(this.activeTheme);
        return (
            themeMap?.[token] ||
            this.defaults[token] ||
            'heroicons:question-mark-circle'
        );
    }
}
```

#### 2.2.2. Composable (`app/composables/useIcon.ts`)

Reactive wrapper for Vue components.

```typescript
export const useIcon = (token: IconToken) => {
    const { $iconRegistry, $theme } = useNuxtApp();
    return computed(() => $iconRegistry.resolve(token));
};
```

#### 2.2.3. Theme Compiler Integration (`scripts/theme-compiler.ts`)

Updates the build script to handle `icons.config.ts`.

```typescript
// Pseudo-code for compiler update
const iconConfigPath = path.join(themeDir, 'icons.config.ts');
let themeIcons = {};
if (fs.existsSync(iconConfigPath)) {
    const config = await import(iconConfigPath);
    themeIcons = validateAndFlatten(config.default);
}
// Add themeIcons to the output JSON
```

## 3. Data Models

### 3.1. Canonical Token List (`app/config/icon-tokens.ts`)

The source of truth for all available icons.

```typescript
export const DEFAULT_ICONS = {
    'shell.sidebar.toggle': 'lucide:sidebar',
    'shell.pane.add': 'lucide:plus',
    'chat.message.send': 'lucide:send',
    // ...
} as const;

export type IconToken = keyof typeof DEFAULT_ICONS;
```

## 4. Error Handling

-   **Invalid Token (Build Time):** The compiler throws an error if `icons.config.ts` contains keys not present in `IconToken`.
-   **Missing Token (Runtime):** If a token is requested but not found in the default map (should be impossible with TS), return a fallback "unknown" icon (e.g., `heroicons:question-mark-circle`) to prevent rendering blank spaces.
-   **Circular Dependencies:** Not applicable as the registry is a flat map.

## 5. Testing Strategy

-   **Unit Tests:**
    -   Verify `IconRegistry` correctly falls back to defaults.
    -   Verify `IconRegistry` correctly prioritizes active theme overrides.
    -   Verify `useIcon` reactivity when theme changes.
-   **Build Tests:**
    -   Ensure `theme:compile` fails on invalid icon tokens.
    -   Ensure `theme:compile` succeeds with valid overrides.
-   **E2E Tests:**
    -   Load a custom theme and verify a specific element (e.g., sidebar toggle) renders the overridden icon class.
