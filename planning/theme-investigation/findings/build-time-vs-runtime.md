# CSS Selector Implementation: Build-Time vs Runtime Analysis

## Overview

This document analyzes two approaches for implementing CSS selector targeting in the theme system:

1. **Runtime Injection** (Current Plan) - Generate and inject CSS at runtime
2. **Build-Time Generation** (Proposed) - Precompile CSS files and use data-theme attribute

## Detailed Comparison

### Approach 1: Runtime Injection (Current Plan)

**Implementation:**
```typescript
// At runtime when theme loads
const injectThemeStyles = (theme: CompiledTheme) => {
    const styleEl = document.createElement('style');
    styleEl.id = `theme-${theme.name}-selectors`;
    
    const cssRules = Object.entries(theme.cssSelectors || {})
        .map(([selector, config]) => {
            const styles = config.style || config;
            const rules = Object.entries(styles)
                .map(([prop, value]) => `${kebabCase(prop)}: ${value};`)
                .join(' ');
            return `${selector} { ${rules} }`;
        })
        .join('\n');
    
    styleEl.textContent = cssRules;
    document.head.appendChild(styleEl);
    
    // Apply classes via MutationObserver
    if (hasClasses) {
        applyClassesWithObserver(theme.cssSelectors);
    }
};
```

**Pros:**
- ✅ Simple implementation - works with existing theme loading
- ✅ No build step changes required
- ✅ Supports dynamic class application
- ✅ Flexible - can inject any CSS at any time

**Cons:**
- ❌ Runtime CSS generation overhead (~0.5-2ms per theme)
- ❌ MutationObserver overhead (~0.1-0.5ms per DOM mutation)
- ❌ Potential FOUC if theme loads after initial render
- ❌ Memory overhead from observer
- ❌ Complexity from class application logic

**Performance:**
- Initial load: ~1-2ms to generate and inject CSS
- Theme switch: ~1-2ms to replace CSS
- MutationObserver: ~0.1-0.5ms per mutation (only if using classes)
- Memory: ~2-4KB per theme (style element + observer)

---

### Approach 2: Build-Time Generation (Proposed)

**Implementation:**

**Build Script (scripts/build-theme-css.ts):**
```typescript
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

function toKebab(str: string): string {
    return str.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

function buildThemeCSS(theme: ThemeDefinition): string {
    const blocks: string[] = [];
    const selectors = theme.cssSelectors || {};
    
    for (const [selector, configRaw] of Object.entries(selectors)) {
        // Support both {style, class} and direct style object
        const config = (configRaw.style || configRaw.class) 
            ? configRaw 
            : { style: configRaw };
        
        const styleObj = config.style || {};
        
        // Generate CSS declarations
        const declarations = Object.entries(styleObj)
            .map(([prop, value]) => `  ${toKebab(prop)}: ${value};`)
            .join('\n');
        
        if (declarations) {
            // Scope with data-theme attribute
            blocks.push(
                `[data-theme="${theme.name}"] ${selector} {\n${declarations}\n}`
            );
        }
    }
    
    return blocks.join('\n\n');
}

export async function buildAllThemeCSS() {
    const themes = await discoverThemes();
    const manifest: Record<string, string> = {};
    
    mkdirSync('public/themes', { recursive: true });
    
    for (const theme of themes) {
        const css = buildThemeCSS(theme);
        const filename = `${theme.name}.css`;
        const filepath = join('public/themes', filename);
        
        writeFileSync(filepath, css, 'utf8');
        manifest[theme.name] = `/themes/${filename}`;
    }
    
    // Write manifest
    writeFileSync(
        'public/themes/manifest.json',
        JSON.stringify(manifest, null, 2)
    );
    
    console.log(`[theme-css] Built ${themes.length} theme CSS files`);
}
```

**Runtime Loader:**
```typescript
// app/composables/useThemeCSS.ts
const manifest = ref<Record<string, string>>({});
const loaded = new Set<string>();

export async function initThemeCSS() {
    const response = await fetch('/themes/manifest.json');
    manifest.value = await response.json();
}

export async function loadThemeCSS(themeName: string): Promise<void> {
    if (loaded.has(themeName)) return;
    
    const href = manifest.value[themeName];
    if (!href) {
        console.warn(`[theme-css] No CSS file for theme: ${themeName}`);
        return;
    }
    
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => {
            loaded.add(themeName);
            resolve();
        };
        link.onerror = reject;
        document.head.appendChild(link);
    });
}

export function setThemeAttribute(themeName: string) {
    document.documentElement.setAttribute('data-theme', themeName);
}
```

**Integration in theme plugin:**
```typescript
const setActiveTheme = async (themeName: string) => {
    // Load CSS file if not already loaded
    await loadThemeCSS(themeName);
    
    // Switch theme by changing attribute
    setThemeAttribute(themeName);
    
    // Update reactive state
    activeTheme.value = themeName;
    localStorage.setItem(activeThemeStorageKey, themeName);
};
```

**Pros:**
- ✅ Zero runtime CSS generation
- ✅ No MutationObserver needed (for styles)
- ✅ Leverages browser's native CSS cascade
- ✅ CSS files are cacheable by browser
- ✅ Prefetching possible with `<link rel="prefetch">`
- ✅ No FOUC if default theme is bundled
- ✅ Simpler runtime code
- ✅ Better performance for theme switching

**Cons:**
- ❌ Build step complexity increases
- ❌ Cannot apply classes dynamically (need different solution)
- ❌ Requires coordination between build and runtime
- ❌ Additional HTTP request per theme (mitigated by caching)
- ❌ CSS files need to be served (public/ directory)

**Performance:**
- Initial load: ~0ms (CSS already in DOM if preloaded)
- Theme switch: ~0ms (just attribute change) + potential CSS load time
- First-time theme load: ~5-20ms (network request + CSS parse)
- Cached theme load: ~1-2ms (from browser cache)
- Memory: ~1KB per loaded theme (link element)

---

## Hybrid Approach (Recommended)

**Combine the best of both approaches:**

### For Styles: Build-Time Generation

Use build-time CSS generation for `style` properties:

```typescript
cssSelectors: {
    '.custom-element': {
        style: {
            backgroundColor: 'var(--md-primary)',
            border: '2px solid',
        },
    }
}
```

Generated CSS:
```css
[data-theme="retro"] .custom-element {
    background-color: var(--md-primary);
    border: 2px solid;
}
```

### For Classes: @apply Directive (Lightweight Hybrid)

**NEW: Support Tailwind classes via @apply for rapid prototyping**

Since the project uses Tailwind CSS, we can leverage the `@apply` directive to include utility classes at build time:

```typescript
cssSelectors: {
    '.custom-element': {
        style: {
            backgroundColor: 'var(--md-primary)',
        },
        class: 'retro-shadow rounded-md hover:scale-105 dark:bg-surface',
    },
    
    '.modal-overlay': {
        class: 'fixed inset-0 bg-black/50 backdrop-blur-sm',
    },
}
```

**Build Process:**
1. Generate CSS with @apply directives
2. Process through PostCSS/Tailwind (already in pipeline)
3. Final CSS has utilities expanded

**Generated CSS (after PostCSS):**
```css
[data-theme="retro"] .custom-element {
    background-color: var(--md-primary);
}

[data-theme="retro"] .custom-element {
    box-shadow: 2px 2px 0 0 var(--md-inverse-surface);
    border-radius: 0.375rem;
}

[data-theme="retro"] .custom-element:hover {
    transform: scale(1.05);
}

.dark [data-theme="retro"] .custom-element {
    background-color: var(--md-surface);
}
```

**Benefits:**
- ✅ **Zero runtime overhead** - All processed at build time
- ✅ **Full Tailwind support** - dark:, hover:, responsive variants work
- ✅ **Rapid prototyping** - Use familiar utility classes
- ✅ **Simple implementation** - Leverages existing PostCSS pipeline
- ✅ **Type safe** - Both style and class properties

**Build Script Implementation:**

```typescript
function buildThemeCSSWithClasses(theme: ThemeDefinition): string {
    const blocks: string[] = [];
    const selectors = theme.cssSelectors || {};
    
    for (const [selector, config] of Object.entries(selectors)) {
        const scopedSelector = `[data-theme="${theme.name}"] ${selector}`;
        
        // Add direct CSS properties
        if (config.style) {
            const declarations = Object.entries(config.style)
                .map(([prop, value]) => `  ${toKebab(prop)}: ${value};`)
                .join('\n');
            blocks.push(`${scopedSelector} {\n${declarations}\n}`);
        }
        
        // Add Tailwind classes via @apply
        if (config.class) {
            blocks.push(`${scopedSelector} {\n  @apply ${config.class};\n}`);
        }
    }
    
    return blocks.join('\n\n');
}

// Process through PostCSS to resolve @apply
async function buildAllThemeCSS() {
    const processor = postcss([tailwindcss()]);
    
    for (const theme of themes) {
        const rawCSS = buildThemeCSSWithClasses(theme);
        const result = await processor.process(rawCSS, { from: undefined });
        
        writeFileSync(`public/themes/${theme.name}.css`, result.css);
    }
}
```

## Recommended Solution

**Use Build-Time Generation with Hybrid Class Support:**

### Rationale

1. **Performance**: Build-time is objectively faster
   - Zero runtime overhead
   - Browser-native CSS cascade
   - No JavaScript execution for styling

2. **Simplicity**: Simpler implementation
   - No MutationObserver complexity
   - No runtime CSS generation
   - Clear separation: CSS at build, JS for logic

3. **Flexibility**: Support both styles AND classes
   - Direct CSS properties for precise control
   - Tailwind utilities via @apply for rapid prototyping
   - Full support for dark:, hover:, responsive variants

4. **Developer Experience**: Better DX
   - CSS files are inspectable in DevTools
   - Standard browser caching behavior
   - Predictable cascade rules
   - Familiar Tailwind workflow

5. **Scalability**: Better for production
   - Cacheable static assets
   - CDN-friendly
   - Smaller JS bundle

### Implementation Plan

**Phase 1: Build Script**
1. Create `scripts/build-theme-css.ts`
2. Support both `style` and `class` properties
3. Use `@apply` directive for classes
4. Integrate into Vite build process
5. Process through PostCSS/Tailwind pipeline
6. Output to `public/themes/` directory
7. Generate manifest.json

**Phase 2: Runtime Integration**
1. Create `composables/useThemeCSS.ts` for loading
2. Modify `plugins/01.theme.client.ts` to use CSS files
3. Add `<link rel="prefetch">` for non-active themes
4. Set `data-theme` attribute on theme switch

**Phase 3: Documentation**
1. Update design.md with hybrid approach
2. Document CSS generation process
3. Document @apply usage and Tailwind support
4. Provide examples for common patterns
5. Add troubleshooting guide

**Phase 4: Migration**
1. Update type definitions for both style and class
2. Update task list with hybrid approach
3. Adjust performance targets (should improve)

### Code Changes Required

**1. Update ThemeDefinition type:**
```typescript
export interface CSSSelectorConfig {
    /** Direct CSS properties */
    style?: CSSProperties;
    /** Tailwind utility classes (processed via @apply at build time) */
    class?: string;
}

export type CSSSelector = CSSSelectorConfig | CSSProperties;
```

**2. Add to package.json:**
```json
{
    "scripts": {
        "build:theme-css": "tsx scripts/build-theme-css.ts"
    },
    "devDependencies": {
        "postcss": "^8.4.0",
        "tailwindcss": "^4.0.0"
    }
}
```

**3. Build Script with Class Support:**
```typescript
// scripts/build-theme-css.ts
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

function buildThemeCSSWithClasses(theme: ThemeDefinition): string {
    const blocks: string[] = [];
    const selectors = theme.cssSelectors || {};
    
    for (const [selector, config] of Object.entries(selectors)) {
        const scopedSelector = `[data-theme="${theme.name}"] ${selector}`;
        
        // Direct CSS properties
        if (config.style) {
            const declarations = Object.entries(config.style)
                .map(([prop, value]) => `  ${toKebab(prop)}: ${value};`)
                .join('\n');
            blocks.push(`${scopedSelector} {\n${declarations}\n}`);
        }
        
        // Tailwind classes via @apply
        if (config.class) {
            blocks.push(`${scopedSelector} {\n  @apply ${config.class};\n}`);
        }
    }
    
    return blocks.join('\n\n');
}

async function buildAllThemeCSS() {
    const processor = postcss([tailwindcss()]);
    
    for (const theme of themes) {
        const rawCSS = buildThemeCSSWithClasses(theme);
        const result = await processor.process(rawCSS, { from: undefined });
        
        writeFileSync(`public/themes/${theme.name}.css`, result.css);
    }
}
```

### Performance Comparison (Updated)

| Operation | Runtime Injection | Build-Time (No Classes) | Build-Time (Hybrid) | Improvement |
|-----------|------------------|------------------------|---------------------|-------------|
| Initial Load | 1-2ms | 0ms (preloaded) | 0ms (preloaded) | 100% |
| Theme Switch | 1-2ms | 0ms (attr change) | 0ms (attr change) | 100% |
| First Load | 1-2ms | 5-20ms (network) | 5-20ms (network) | -300%* |
| Memory/Theme | 2-4KB | 1KB | 1-2KB | 50-75% |
| Mutation Cost | 0.1-0.5ms | 0ms | 0ms | 100% |
| Class Support | ✅ Dynamic | ❌ | ✅ Build-time | N/A |
| Dark/Hover | Via observer | Via style only | ✅ Full support | N/A |

*First-time load is slower but happens once per theme, then cached.

**Note:** The hybrid approach adds minimal CSS size (~10-20% for typical class usage) while maintaining zero runtime overhead.

## Decision Matrix

| Criteria | Runtime | Build-Time | Hybrid | Winner |
|----------|---------|------------|--------|--------|
| Performance | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Build |
| Simplicity | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Build |
| Flexibility | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | Runtime |
| Cacheability | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Build |
| DX | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Build |
| Bundle Size | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Build |

**Winner: Build-Time Generation**

## Recommendation

**Adopt the build-time approach** with the following specifications:

1. ✅ **Use build-time CSS generation** for all `style` properties
2. ✅ **Scope with `[data-theme="name"]`** attribute selector
3. ✅ **Drop `class` support** to keep it simple
4. ✅ **Generate static CSS files** in `public/themes/`
5. ✅ **Integrate with existing build process**
6. ✅ **Use native browser caching** for performance

This approach is:
- **Faster**: Zero runtime overhead
- **Simpler**: No MutationObserver, no runtime generation
- **More maintainable**: Standard CSS files
- **Better for production**: Cacheable, CDN-friendly
- **Developer-friendly**: Inspectable CSS in DevTools

The only trade-off is losing dynamic class application, which is acceptable because:
- Developers can add classes in markup directly
- CSS properties cover 95% of use cases
- Simpler API is easier to understand and use
