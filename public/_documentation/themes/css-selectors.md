# CSS Selectors - Theme System Feature

## Overview

The CSS Selector system allows themes to style elements that cannot easily be integrated with the component override system. This includes third-party libraries (Monaco, TipTap), legacy code, portal/teleported elements (modals, tooltips), and external widgets.

## How It Works

The system uses a **hybrid build-time + runtime approach**:

1. **Build-time**: CSS properties are compiled into static CSS files (`public/themes/{theme}.css`)
2. **Runtime**: Tailwind utility classes are applied via `classList.add()` when theme switches

This provides:
- ✅ Zero runtime overhead for CSS properties
- ✅ Full Tailwind v4 support (including dark:, hover:, responsive)
- ✅ Browser-native CSS cascade
- ✅ Cacheable static CSS files

## Usage

### Defining CSS Selectors in Theme

```typescript
// app/theme/retro/theme.ts
export default defineTheme({
    name: 'retro',
    // ... colors, overrides, etc.
    
    cssSelectors: {
        // CSS properties only (build-time)
        '.monaco-editor': {
            style: {
                border: '2px solid var(--md-outline)',
                borderRadius: '3px',
                backgroundColor: 'var(--md-surface)',
            },
        },
        
        // Tailwind classes only (runtime)
        '.modal-overlay': {
            class: 'fixed inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/70',
        },
        
        // Both styles and classes
        '.tiptap': {
            style: {
                fontFamily: 'VT323, monospace',
                fontSize: '20px',
            },
            class: 'prose prose-retro max-w-none dark:prose-invert',
        },
        
        // Complex selectors
        '.custom-widget .inner-element': {
            style: {
                color: 'var(--md-on-surface)',
            },
            class: 'transition-colors duration-200',
        },
    },
});
```

### Building CSS Files

Run the build script to generate static CSS files:

```bash
bun run theme:build-css
```

This creates `public/themes/{theme}.css` for each theme with cssSelectors.

**When to rebuild:**
- After modifying cssSelectors in any theme
- Before deploying to production
- Can be added to pre-build scripts

### Auto-Application on Page Navigation

Classes are automatically re-applied when navigating between pages:

```typescript
// Automatically configured in app/plugins/01.theme.client.ts
nuxtApp.hook('page:finish', () => {
    const theme = getTheme(activeTheme.value);
    if (theme?.cssSelectors) {
        applyThemeClasses(activeTheme.value, theme.cssSelectors);
    }
});
```

### Lazy-Loaded Components

For components that load after theme initialization, use the `useThemeClasses` composable:

```vue
<script setup>
// In a lazy-loaded component
import { useThemeClasses } from '~/composables/core/useThemeClasses';

useThemeClasses();
</script>

<template>
    <div class="my-dynamic-component">
        <!-- This component's matching selectors will have classes applied -->
    </div>
</template>
```

## Performance

### Build-Time CSS
- **Generation**: ~1-5ms per theme
- **Runtime overhead**: 0ms (static CSS)
- **File size**: ~1-5KB per theme (depends on number of selectors)

### Runtime Classes
- **Theme switch**: ~0.5-2ms (depends on selector count)
- **Page navigation**: ~1-2ms (re-applies to new elements)
- **Memory**: ~500 bytes - 1KB (WeakMap tracking)

## Use Cases

### Third-Party Libraries

```typescript
cssSelectors: {
    // Monaco Editor
    '.monaco-editor': {
        style: {
            border: '2px solid var(--md-outline)',
            borderRadius: '3px',
        },
        class: 'retro-shadow',
    },
    
    // TipTap Editor
    '.ProseMirror': {
        style: {
            fontFamily: 'VT323, monospace',
            minHeight: '200px',
        },
        class: 'prose dark:prose-invert',
    },
}
```

### Portal/Teleported Elements

```typescript
cssSelectors: {
    // Modals (often teleported to body)
    '[data-portal="modal"]': {
        class: 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
    },
    
    // Tooltips
    '[data-tooltip]': {
        style: {
            backgroundColor: 'var(--md-inverse-surface)',
            color: 'var(--md-inverse-on-surface)',
        },
        class: 'rounded-md px-2 py-1 text-sm shadow-lg',
    },
}
```

### Legacy Code

```typescript
cssSelectors: {
    // Old components that can't be refactored yet
    '.legacy-component': {
        class: 'retro-btn retro-shadow',
    },
    
    '.legacy-input': {
        style: {
            border: '2px solid var(--md-outline)',
        },
    },
}
```

### Rapid Prototyping

```typescript
cssSelectors: {
    // Quick styling with Tailwind utilities
    '.prototype-card': {
        class: 'rounded-lg border-2 border-primary p-4 shadow-md hover:shadow-lg transition-shadow',
    },
    
    '.prototype-button': {
        class: 'bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary/80 active:scale-95 transition-all',
    },
}
```

## Best Practices

### When to Use CSS Selectors

✅ **Use cssSelectors for:**
- Third-party libraries you don't control
- Portal/teleported elements
- Legacy code that's hard to refactor
- External widgets
- Rapid prototyping
- Elements that need global styling

❌ **Don't use cssSelectors for:**
- Your own components (use component overrides instead)
- Elements that can easily accept props
- One-off styling (use inline classes)

### Performance Tips

1. **Prefer build-time styles over runtime classes**
   ```typescript
   // Good: Build-time (zero runtime cost)
   style: { color: 'var(--md-primary)' }
   
   // OK: Runtime (minimal cost)
   class: 'text-primary'
   ```

2. **Use specific selectors**
   ```typescript
   // Good: Specific
   '.monaco-editor .line-numbers'
   
   // Bad: Too broad
   'div'
   ```

3. **Group related selectors**
   ```typescript
   // Good: One selector with both
   '.editor': {
       style: { /* styles */ },
       class: '/* classes */',
   }
   
   // Bad: Separate selectors
   '.editor': { style: { /* styles */ } },
   '.editor': { class: '/* classes */' }, // Overwrites previous!
   ```

### Tailwind Utilities

All Tailwind v4 features work:

```typescript
cssSelectors: {
    '.my-element': {
        // Responsive
        class: 'text-sm md:text-base lg:text-lg',
        
        // Dark mode
        class: 'bg-white dark:bg-gray-900',
        
        // Hover/focus states
        class: 'hover:scale-105 focus:ring-2',
        
        // Arbitrary values
        class: 'p-[17px] bg-[#1a1c1e]',
        
        // Combined
        class: 'p-4 md:p-6 bg-primary hover:bg-primary/80 dark:bg-secondary',
    },
}
```

## Limitations

### Lazy-Loaded Components

**Problem**: Classes are only applied to elements present at theme switch time.

**Solution**: Use `useThemeClasses()` composable:

```vue
<script setup>
useThemeClasses(); // Re-applies on mount
</script>
```

### Specificity Conflicts

Theme CSS uses `[data-theme="name"] .selector` which has specificity `(0, 1, 1)`.

If your CSS has higher specificity, theme styles won't apply:

```css
/* This will override theme styles */
#my-id .selector { ... } /* (1, 0, 1) > (0, 1, 1) */

/* Theme styles will apply */
.selector { ... } /* (0, 1, 0) < (0, 1, 1) */
```

**Solution**: Use `!important` in theme styles if needed, or adjust your CSS specificity.

### Dynamic Content

If you add elements dynamically (not via Vue), you need to manually call:

```typescript
import { applyThemeClasses } from '~/theme/_shared/css-selector-runtime';

// After adding elements
const theme = await loadTheme(activeTheme.value);
if (theme?.cssSelectors) {
    applyThemeClasses(activeTheme.value, theme.cssSelectors);
}
```

## API Reference

### Types

```typescript
interface CSSelectorConfig {
    /** Direct CSS properties (build-time) */
    style?: Record<string, string>;
    
    /** Tailwind utility classes (runtime) */
    class?: string;
}
```

### Functions

```typescript
// Apply classes to matching elements
function applyThemeClasses(
    themeName: string,
    selectors: Record<string, CSSelectorConfig>
): void

// Remove classes from elements
function removeThemeClasses(
    selectors: Record<string, CSSelectorConfig>
): void

// Load theme CSS file
async function loadThemeCSS(themeName: string): Promise<void>

// Unload theme CSS file
function unloadThemeCSS(themeName: string): void
```

### Composable

```typescript
// Auto-applies theme classes on mount
function useThemeClasses(): void
```

## Examples

See `app/theme/retro/theme.ts` for example cssSelectors configuration.

## Troubleshooting

### Classes not applied
1. Check if CSS file was built: `ls public/themes/`
2. Run build script: `bun run theme:build-css`
3. Verify selector matches elements: `document.querySelectorAll('.your-selector')`
4. For lazy-loaded: Add `useThemeClasses()` composable

### Styles not applying
1. Check CSS file loaded: Look for `<link data-theme-css="retro">` in `<head>`
2. Check `[data-theme]` attribute: `document.documentElement.getAttribute('data-theme')`
3. Check specificity: Use browser DevTools to see which styles win

### Performance issues
1. Reduce number of selectors
2. Use more specific selectors
3. Prefer `style` over `class` for static properties
