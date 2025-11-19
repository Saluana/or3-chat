# Theme Border Variables

## Overview

The theme system now supports `--md-border-width` and `--md-border-radius` CSS variables that can be customized per theme.

## Usage in Themes

Define border styling in your theme's `theme.ts` file:

```typescript
export default defineTheme({
    name: 'my-theme',
    displayName: 'My Theme',
    
    // Border styling
    borderWidth: '2px',
    borderRadius: '8px',
    
    colors: {
        // ... color palette
    },
});
```

## Available Variables

- `--md-border-width`: Default border width (e.g., `1px`, `2px`)
- `--md-border-radius`: Default border radius (e.g., `3px`, `8px`, `12px`)

## Default Values

If not specified in a theme, the base Material Design CSS files provide defaults:

- Light/Dark/Contrast variants: `--md-border-width: 1px` and `--md-border-radius: 8px`

## Current Theme Values

### Retro Theme
- Border Width: `2px`
- Border Radius: `3px`
- Creates a pixel-perfect, retro aesthetic with hard edges

### Professional Theme  
- Border Width: `1px`
- Border Radius: `8px`
- Creates a modern, refined look with subtle rounding

## Using in Components

You can reference these variables in your CSS/Tailwind:

```vue
<template>
    <div class="custom-card">
        Content
    </div>
</template>

<style scoped>
.custom-card {
    border: var(--md-border-width) solid var(--md-outline);
    border-radius: var(--md-border-radius);
}
</style>
```

Or with Tailwind arbitrary values:

```vue
<div class="border-[var(--md-border-width)] rounded-[var(--md-border-radius)]">
```

## Implementation Details

1. Base CSS files (`light.css`, `dark.css`, etc.) define default values
2. Theme definitions can override these via `borderWidth` and `borderRadius` properties
3. The theme compiler generates CSS variables that are injected at runtime
4. Variables are scoped to `html[data-theme="theme-name"]` selector
