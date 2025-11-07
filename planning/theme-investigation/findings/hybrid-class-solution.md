# Hybrid CSS Selector Solution: Build-Time + Lightweight Class Support

## Overview

This document proposes a **hybrid approach** that combines the performance benefits of build-time CSS generation with the flexibility of class-based styling for rapid prototyping.

## Problem Statement

**User Need:** Class support is important for rapid prototyping and applying utility classes like `dark:hover:bg-primary`.

**Challenge:** How to support classes without the overhead of MutationObserver while maintaining build-time performance.

## Recommended Hybrid Solution

### Approach: Build-Time CSS Generation + Utility Class Composition

**Strategy:** Generate CSS at build time that includes both direct properties AND composed utility classes.

**Key Insight:** Since the project uses Tailwind CSS, we can leverage Tailwind's class composition at build time by generating CSS that applies the same styles as the utility classes.

### Implementation

#### 1. Enhanced Theme Definition

```typescript
// In theme.ts
cssSelectors: {
  '.custom-element': {
    // Direct CSS properties
    style: {
      backgroundColor: 'var(--md-primary)',
      border: '2px solid var(--md-inverse-surface)',
    },
    // Utility classes (resolved at build time)
    class: 'retro-shadow rounded-md hover:scale-105 dark:bg-surface',
  },
  
  '#special-button': {
    // Can use just classes
    class: 'px-4 py-2 text-white dark:text-black hover:opacity-80',
  },
  
  '.another-element': {
    // Or just styles
    style: {
      padding: '8px',
    },
  },
}
```

#### 2. Build Script with Tailwind Integration

**Option A: Extract Tailwind Classes to CSS (Recommended)**

```typescript
// scripts/build-theme-css.ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

interface ClassToCSS {
  [className: string]: string; // CSS declarations
}

/**
 * Extract CSS from Tailwind classes
 * Uses Tailwind's JIT to generate actual CSS for each class
 */
async function extractTailwindCSS(classes: string[]): Promise<ClassToCSS> {
  const result: ClassToCSS = {};
  
  // Generate temporary HTML with all classes
  const html = classes.map(c => `<div class="${c}"></div>`).join('');
  
  // Process with Tailwind
  const processor = postcss([
    tailwindcss({
      content: [{ raw: html, extension: 'html' }],
      // Use project's Tailwind config
      ...require('../tailwind.config.js'),
    }),
  ]);
  
  const inputCSS = `
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
  `;
  
  const result = await processor.process(inputCSS, { from: undefined });
  
  // Parse result CSS and extract declarations for each class
  const parsed = postcss.parse(result.css);
  const classMap: ClassToCSS = {};
  
  parsed.walkRules((rule) => {
    // Extract class name from selector (e.g., ".hover\\:scale-105:hover" -> "hover:scale-105")
    const match = rule.selector.match(/\.([^:]+)(?::(.+))?/);
    if (match) {
      const className = match[1].replace(/\\\\/g, '');
      const pseudo = match[2] || '';
      const declarations = rule.nodes
        .filter(n => n.type === 'decl')
        .map(n => `${n.prop}: ${n.value}`)
        .join('; ');
      
      classMap[className] = {
        declarations,
        pseudo,
      };
    }
  });
  
  return classMap;
}

/**
 * Build CSS for a single theme with class support
 */
export async function buildThemeCSS(theme: ThemeDefinition): Promise<string> {
  const blocks: string[] = [];
  const selectors = theme.cssSelectors || {};
  
  // Collect all classes used across all selectors
  const allClasses = new Set<string>();
  for (const config of Object.values(selectors)) {
    if (config.class) {
      config.class.split(/\s+/).forEach(c => allClasses.add(c));
    }
  }
  
  // Extract CSS for all classes (one-time operation)
  const classCSS = await extractTailwindCSS(Array.from(allClasses));
  
  // Generate scoped CSS for each selector
  for (const [selector, config] of Object.entries(selectors)) {
    const declarations: string[] = [];
    const pseudoRules: Map<string, string[]> = new Map();
    
    // Add direct style properties
    if (config.style) {
      Object.entries(config.style).forEach(([prop, value]) => {
        declarations.push(`  ${toKebab(prop)}: ${value};`);
      });
    }
    
    // Add class-based properties
    if (config.class) {
      const classes = config.class.split(/\s+/).filter(Boolean);
      
      for (const className of classes) {
        const cssInfo = classCSS[className];
        if (!cssInfo) continue;
        
        if (cssInfo.pseudo) {
          // Pseudo-class (e.g., hover:, dark:)
          if (!pseudoRules.has(cssInfo.pseudo)) {
            pseudoRules.set(cssInfo.pseudo, []);
          }
          pseudoRules.get(cssInfo.pseudo)!.push(`  ${cssInfo.declarations};`);
        } else {
          // Regular class
          declarations.push(`  ${cssInfo.declarations};`);
        }
      }
    }
    
    // Generate base rule
    if (declarations.length > 0) {
      blocks.push(
        `[data-theme="${theme.name}"] ${selector} {\n${declarations.join('\n')}\n}`
      );
    }
    
    // Generate pseudo-class rules
    for (const [pseudo, decls] of pseudoRules) {
      const pseudoSelector = pseudo === 'dark' 
        ? `.dark [data-theme="${theme.name}"] ${selector}`
        : `[data-theme="${theme.name}"] ${selector}:${pseudo}`;
      
      blocks.push(
        `${pseudoSelector} {\n${decls.join('\n')}\n}`
      );
    }
  }
  
  return blocks.join('\n\n');
}
```

**Option B: Simpler Approach - Class Reference (Lightweight)**

If Option A is too complex, we can use a simpler approach that references classes without extracting:

```typescript
/**
 * Build CSS with class references
 * Classes are NOT extracted - they rely on Tailwind being present
 */
export function buildThemeCSSSimple(theme: ThemeDefinition): string {
  const blocks: string[] = [];
  const selectors = theme.cssSelectors || {};
  
  for (const [selector, config] of Object.entries(selectors)) {
    const declarations: string[] = [];
    
    // Add direct style properties
    if (config.style) {
      Object.entries(config.style).forEach(([prop, value]) => {
        declarations.push(`  ${toKebab(prop)}: ${value};`);
      });
    }
    
    // Generate scoped selector
    const scopedSelector = `[data-theme="${theme.name}"] ${selector}`;
    
    // Add direct CSS
    if (declarations.length > 0) {
      blocks.push(`${scopedSelector} {\n${declarations.join('\n')}\n}`);
    }
    
    // For classes, use @apply directive (Tailwind v4 compatible)
    if (config.class) {
      blocks.push(
        `${scopedSelector} {\n  @apply ${config.class};\n}`
      );
    }
  }
  
  return blocks.join('\n\n');
}
```

**Generated CSS Example (Option B):**

```css
/* From theme.ts cssSelectors */

[data-theme="retro"] .custom-element {
  background-color: var(--md-primary);
  border: 2px solid var(--md-inverse-surface);
}

[data-theme="retro"] .custom-element {
  @apply retro-shadow rounded-md hover:scale-105 dark:bg-surface;
}

[data-theme="retro"] #special-button {
  @apply px-4 py-2 text-white dark:text-black hover:opacity-80;
}
```

#### 3. PostCSS Processing

Ensure the generated CSS file is processed by Tailwind/PostCSS:

```typescript
// In build script
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

async function buildAllThemeCSS(): Promise<void> {
  const themes = await discoverThemes();
  
  for (const theme of themes) {
    // Generate CSS with @apply directives
    const rawCSS = buildThemeCSSSimple(theme);
    
    // Process through PostCSS to resolve @apply
    const processor = postcss([
      tailwindcss(),
    ]);
    
    const result = await processor.process(rawCSS, {
      from: undefined,
      to: `public/themes/${theme.name}.css`,
    });
    
    // Write processed CSS
    writeFileSync(
      `public/themes/${theme.name}.css`,
      result.css,
      'utf8'
    );
  }
}
```

### Performance Comparison

| Feature | Pure Build-Time | Hybrid (Option A) | Hybrid (Option B) |
|---------|----------------|-------------------|-------------------|
| Theme Switch | 0ms | 0ms | 0ms |
| Runtime Overhead | 0ms | 0ms | 0ms |
| Build Time | Fast | Slower (extract) | Fast (PostCSS) |
| Class Support | ❌ | ✅ Full | ✅ Via @apply |
| Dark/Hover Support | Via style | ✅ | ✅ |
| Bundle Size | Smallest | Larger | Medium |

### Recommendation: Option B (Lightweight Hybrid)

**Why Option B:**
1. ✅ **Simple** - Uses Tailwind's @apply directive
2. ✅ **Fast** - No class extraction needed
3. ✅ **Full Support** - All Tailwind features work (dark:, hover:, etc.)
4. ✅ **Maintainable** - Standard Tailwind workflow
5. ✅ **Zero Runtime Cost** - Still build-time only

**How it works:**
1. Author uses both `style` and `class` in theme.ts
2. Build script generates CSS with @apply directives
3. PostCSS/Tailwind processes the file (already in build pipeline)
4. Final CSS has all utilities expanded
5. Runtime just sets data-theme attribute

### Updated Type Definition

```typescript
export interface CSSSelectorConfig {
  /** Direct CSS properties */
  style?: CSSProperties;
  /** Tailwind utility classes (processed via @apply) */
  class?: string;
}

export type CSSSelector = CSSSelectorConfig | CSSProperties;
```

### Example Usage

```typescript
// theme.ts
export default defineTheme({
  name: 'retro',
  
  cssSelectors: {
    // Rapid prototyping with Tailwind
    '.modal-overlay': {
      class: 'fixed inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/70',
    },
    
    // Mix style and class
    '.custom-button': {
      style: {
        border: '2px solid var(--md-inverse-surface)',
      },
      class: 'px-4 py-2 rounded-md hover:scale-105 transition-transform',
    },
    
    // Complex responsive utilities
    '.responsive-grid': {
      class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
    },
    
    // Dark mode variants
    '.card': {
      class: 'bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg',
    },
  },
});
```

### Implementation Steps

1. **Update build script** to support `class` property via @apply
2. **Ensure PostCSS processes** theme CSS files
3. **Update types** to include class support
4. **Document @apply usage** and limitations
5. **Test with various Tailwind utilities**

### Trade-offs

**What we gain:**
- ✅ Full Tailwind utility support
- ✅ Rapid prototyping with classes
- ✅ Dark mode, hover, responsive variants
- ✅ Still zero runtime overhead

**What we accept:**
- ⚠️ Slightly larger CSS files (utilities are expanded)
- ⚠️ Build time slightly longer (PostCSS processing)
- ⚠️ @apply has some limitations (can't use arbitrary values)

### Alternative: Option C - Minimal Runtime for Classes Only

If @apply limitations are problematic, we can use a **minimal runtime** approach:

```typescript
// Only for classes, not styles
const applyThemeClasses = (themeName: string, selectors: Record<string, any>) => {
  for (const [selector, config] of Object.entries(selectors)) {
    if (!config.class) continue;
    
    try {
      document.querySelectorAll(selector).forEach(el => {
        // Only add classes if theme is active
        if (document.documentElement.getAttribute('data-theme') === themeName) {
          el.classList.add(...config.class.split(/\s+/));
        }
      });
    } catch {}
  }
};

// Call once on theme load, no observer needed
setActiveTheme(name).then(() => {
  const theme = getTheme(name);
  if (theme.cssSelectors) {
    applyThemeClasses(name, theme.cssSelectors);
  }
});
```

**Performance:**
- One-time class application: ~1-2ms
- No MutationObserver overhead
- Classes persist on existing elements

## Conclusion

**Recommended: Hybrid Option B (Build-Time + @apply)**

This provides the best balance:
- ✅ Zero runtime overhead (still build-time)
- ✅ Full class support via @apply
- ✅ Simple implementation
- ✅ Works with all Tailwind features
- ✅ Maintainable and standard

The user gets rapid prototyping with classes while maintaining the performance benefits of build-time generation.
