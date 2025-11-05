# Refined Theme System - Requirements

## Overview

A simplified, DX-focused theme system that reduces code by 40-50% while maintaining full customizability. The system prioritizes developer ergonomics, type safety, and build-time validation over runtime complexity.

## Core Principles

1. **Convention over Configuration** - Smart defaults reduce boilerplate
2. **Type Safety First** - Generate types from theme configs for autocomplete
3. **Build-time Validation** - Catch errors before runtime
4. **CSS-first** - Use cascade and specificity instead of JS merging where possible
5. **Progressive Enhancement** - Simple cases are simple, complex cases are possible

---

## Requirements

### 1. Simplified Theme Authoring

**User Story**: As a theme author, I want to create themes with minimal boilerplate so that I can focus on design rather than configuration structure.

**WHEN** creating a new theme  
**THEN** the system **SHALL** require only:

-   Color palette definition
-   Optional component overrides using CSS selector syntax
-   No manual aliasing of CSS variables
-   No nested configuration objects

**WHEN** defining component overrides  
**THEN** the system **SHALL** support:

-   Simple key-value pairs for common cases
-   CSS selector-based targeting for specificity
-   Automatic priority calculation from selector specificity

**Example**:

```typescript
defineTheme({
    name: 'nature',
    colors: { primary: '#3f8452', surface: '#f5faf5' },
    overrides: {
        button: { variant: 'forestSolid' },
        'button.chat': { variant: 'mossGhost' }, // Simple syntax (auto-expanded)
        'button#chat.send': { color: 'primary' }, // Identifier syntax
    },
});
```

---

### 2. Type-Safe Identifiers

**User Story**: As a developer, I want autocomplete for theme identifiers so that I avoid typos and discover available identifiers.

**WHEN** using a theme identifier in a component  
**THEN** the system **SHALL** provide TypeScript autocomplete from all registered identifiers

**WHEN** using an invalid identifier  
**THEN** the system **SHALL** show a compile-time error

**WHEN** theme configs change  
**THEN** the system **SHALL** automatically regenerate identifier types

---

### 3. Zero-Boilerplate Component Theming

**User Story**: As a developer, I want to use themed components without wrapper components so that my code is cleaner and more maintainable.

**WHEN** using a Nuxt UI component  
**THEN** the system **SHALL** automatically apply theme overrides without wrapper components

**WHEN** specifying an identifier  
**THEN** the system **SHALL** provide a simple directive or prop: `v-theme="'chat.send'"`

**WHEN** no identifier is specified  
**THEN** the system **SHALL** auto-detect context from DOM ancestry

---

### 4. Build-Time Theme Validation

**User Story**: As a theme author, I want to catch configuration errors before deploying so that users don't encounter runtime errors.

**WHEN** running the build or dev server  
**THEN** the system **SHALL** validate:

-   Required CSS variables are defined
-   Override selectors are syntactically valid
-   Referenced identifiers exist
-   Priority conflicts are detected

**WHEN** validation fails  
**THEN** the system **SHALL**:

-   Show clear error messages with file/line references
-   Suggest fixes for common mistakes
-   Fail the build for critical errors
-   Warn for non-critical issues

---

### 5. Reduced Code Duplication

**User Story**: As a maintainer, I want to reduce theme system code by 40%+ so that the system is easier to understand and maintain.

**WHEN** comparing to the current system  
**THEN** the refined system **SHALL**:

-   Eliminate 3 wrapper components (~600 lines)
-   Remove cache layer if hit rate < 50% (~100 lines)
-   Consolidate type definitions into single file
-   Remove CSS variable aliasing per theme (~60 lines per theme)
-   Provide test factories to reduce test boilerplate (~150 lines)

**Total target reduction**: 900-1200 lines

---

### 6. Backward Compatibility Path

**User Story**: As a developer with existing themes, I want to migrate gradually so that I don't break existing functionality.

**WHEN** adopting the refined system  
**THEN** the system **SHALL**:

-   Support a compatibility layer for old theme configs
-   Allow incremental migration (theme by theme)
-   Provide a migration tool to convert old configs to new DSL

**WHEN** using both old and new systems  
**THEN** the system **SHALL**:

-   Load both configuration formats
-   Prioritize new format over old when both exist
-   Log deprecation warnings for old format

**WHEN** migrating the default retro theme  
**THEN** the system **SHALL**:

-   Extract all retro-specific styles (retro-btn, retro-input, etc.) into the retro theme package
-   Remove retro-specific styles from global stylesheets
-   Maintain exact visual parity - no visual changes to the retro theme
-   Rename generic styles (retro-prose → or3-prose or app-prose)
-   Allow retro theme to be loaded as a theme package, not global styles

---

### 7. Developer Tooling

**User Story**: As a developer, I want CLI tools to help me work with themes so that I can validate, debug, and generate themes efficiently.

**WHEN** running `bun run theme:validate <name>`  
**THEN** the system **SHALL**:

-   Check CSS variable completeness
-   Validate override structure
-   Report unused rules
-   Show missing identifiers

**WHEN** running `bun run theme:create <name>`  
**THEN** the system **SHALL**:

-   Scaffold a new theme with best practices
-   Generate boilerplate files
-   Include example overrides

**WHEN** editing theme files in dev mode  
**THEN** the system **SHALL**:

-   Hot reload theme changes without page refresh
-   Show validation errors in console
-   Highlight affected components

---

### 8. Performance Requirements

**User Story**: As a user, I want theme switching to be instant so that the app feels responsive.

**WHEN** switching themes  
**THEN** the system **SHALL**:

-   Apply theme changes in < 50ms
-   Not cause layout shifts
-   Preserve component state

**WHEN** resolving overrides for a component  
**THEN** the system **SHALL**:

-   Complete resolution in < 1ms per component
-   Leverage Vue's computed caching effectively
-   Only re-resolve when dependencies change

---

### 9. Testing Improvements

**User Story**: As a developer writing tests, I want simple mocking utilities so that I can test themed components easily.

**WHEN** testing a themed component  
**THEN** the system **SHALL** provide:

-   Mock factories for common scenarios
-   Test helpers to set active theme
-   Utilities to assert override application

**Example**:

```typescript
const wrapper = mount(MyComponent, {
    global: { plugins: [mockTheme('nature')] },
});
expect(wrapper.classes()).toContain('nature-specific-class');
```

---

### 10. Documentation Requirements

**User Story**: As a new developer, I want clear documentation so that I can understand and use the theme system quickly.

**WHEN** reading theme documentation  
**THEN** the system **SHALL** provide:

-   Quick start guide (< 5 minutes to first theme)
-   API reference for all DSL options
-   Migration guide from old system
-   Example themes with comments
-   Architecture decision records (ADRs)

**WHEN** encountering an error  
**THEN** error messages **SHALL**:

-   Link to relevant documentation
-   Show code examples of correct usage
-   Explain why the error occurred

---

## Non-Functional Requirements

### Code Quality

-   All new code must have TypeScript types (no `any`)
-   Test coverage > 80% for core system
-   Linter passes with zero warnings
-   Build size increase < 5KB

### Browser Support

-   Same as current system (modern evergreen browsers)
-   No polyfills required for theme system features

### Accessibility

-   Theme switching does not break screen readers
-   Color contrast meets WCAG AA in all themes
-   Reduced motion preferences respected

---

## Success Metrics

1. **Code Reduction**: 40%+ less code in theme system
2. **Authoring Time**: Create new theme in < 30 minutes (vs 2+ hours current)
3. **Build Speed**: Theme validation adds < 500ms to build time
4. **Developer Satisfaction**: 80%+ prefer new system in internal survey
5. **Error Rate**: 50%+ fewer theme-related bugs in production

---

## Migration Constraints

### Retro Theme as Default

The current retro theme is the default theme and must remain visually identical after migration:

1. **Retro Theme Package**: All retro-specific code (retro-btn, retro-input, etc.) must be moved into its own theme package using the new system
2. **Remove Global Retro Styles**: Retro-specific styles must be removed from global stylesheets and only exist within the retro theme definition
3. **Generic Prose Styles**: The `retro-prose` class should be renamed to a generic name like `or3-prose` or `app-prose` that can be used across all themes
4. **Visual Parity**: After migration, the retro theme (as default) must look exactly the same as it does currently - no visual regressions
5. **Component Cleanup**: All components using ThemeButton, ThemeInput, etc. must be refactored to use the v-theme directive instead

---

## Out of Scope

These are explicitly NOT included in v1:

-   Theme marketplace/sharing platform
-   Visual theme editor GUI
-   Automatic theme generation from designs
-   Per-user theme customization (runtime)
-   Theme animations/transitions
-   CSS-in-JS theming solution

These may be considered for future versions.
