# Theme System Architecture

This document explains the internal architecture of the OR3 theme system, including the compilation process and runtime resolution.

## Overview

The theme system is designed for **performance** and **type safety**. It splits responsibilities between a build-time compiler and a runtime resolver.

```mermaid
graph TD
    A[Theme Definition] -->|bun run theme:compile| B[Theme Compiler]
    B --> C[Compiled Theme Config]
    B --> D[Generated Types]
    B --> E[CSS Variables]

    C --> F[Runtime Resolver]
    F -->|resolve()| G[Component Props]

    E --> H[Browser CSS]
    G --> I[Vue Component]
```

## 1. Theme Definition (DSL)

Themes are defined using a TypeScript DSL (`defineTheme`). This provides:

-   **Type Safety**: Autocomplete for colors, overrides, and config.
-   **Validation**: Runtime checks in dev mode for missing colors or invalid selectors.

```typescript
// app/theme/my-theme/theme.ts
export default defineTheme({
    name: 'my-theme',
    colors: { ... },
    overrides: { ... }
});
```

## 2. Theme Compiler

The compiler (`scripts/theme-compiler.ts`) runs at build time (or via `bun run theme:compile`).

### Responsibilities:

1.  **Validation**: Checks all themes for errors (missing colors, invalid selectors).
2.  **CSS Generation**: Converts the color palette and font settings into CSS variables (`.light` and `.dark` blocks).
3.  **Selector Parsing**: Parses CSS-like selectors (e.g., `button.chat#send`) into structured objects (`ParsedSelector`).
4.  **Specificity Calculation**: Pre-calculates specificity scores for all overrides.
5.  **Type Generation**: Generates `types/theme-generated.d.ts` with union types for `ThemeName`, `ThemeContext`, and `ThemeIdentifier`.

### Output:

The compiler produces optimized runtime configurations where selectors are already parsed and sorted by specificity.

## 3. Runtime Resolver

The `RuntimeResolver` (`app/theme/_shared/runtime-resolver.ts`) is a lightweight class instantiated for the active theme.

### Responsibilities:

1.  **Matching**: Efficiently matches components against the pre-compiled overrides.
2.  **Merging**: Merges props from multiple matching overrides based on specificity.
3.  **Prop Mapping**: Maps semantic props (`variant`, `size`, `color`) to CSS classes for non-Nuxt UI components using `propMaps`.

### Performance:

-   **Resolution**: <1ms per component.
-   **Indexing**: Overrides are indexed by component type for O(1) lookup.
-   **Caching**: Results are cached (via `useThemeOverrides`) to prevent unnecessary re-calculation.

## 4. CSS Selectors (Hybrid)

For global styles or 3rd party libraries, the system uses a hybrid approach:

1.  **Static CSS**: `style` properties in `cssSelectors` are compiled into static CSS files (`public/themes/{name}.css`).
2.  **Runtime Classes**: `class` properties are applied at runtime using `applyThemeClasses`.

This allows using Tailwind utilities for dynamic theming while keeping static styles performant.

## 5. Integration

-   **`v-theme` Directive**: The primary interface for components. It uses the resolver to apply props.
-   **`useTheme` Composable**: Manages active theme state and persistence.
-   **`useThemeResolver`**: Provides programmatic access to the resolver.

## Directory Structure

```
app/theme/
├── _shared/           # Core system (Compiler, Resolver, Types)
├── retro/             # 'retro' theme definition
├── blank/             # 'blank' theme definition
└── ...
```

## Key Files

-   `app/theme/_shared/define-theme.ts`: DSL definition.
-   `app/theme/_shared/runtime-resolver.ts`: Runtime logic.
-   `scripts/theme-compiler.ts`: Build-time compiler.
-   `app/theme/_shared/types.ts`: System type definitions.
