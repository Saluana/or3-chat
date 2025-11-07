# CSS Selector Targeting in theme.ts - Detailed Findings

## Executive Summary

**Question:** Can we target ID'd or classed non-Nuxt elements in theme.ts for styling? Would this be a good idea?

**Answer:** **YES** to both questions. CSS selector targeting is technically feasible and would be an excellent addition to the theme system. It enables theming of elements that cannot easily integrate `useThemeOverrides`, such as:
- Third-party components
- Portal/teleported elements
- Dynamically generated markup
- Legacy code that's difficult to refactor

## Current Capabilities

### Existing Selector Support

The theme system already has partial selector support through the override key syntax:

```typescript
// From retro/theme.ts
overrides: {
  'button#chat.send': { ... },      // ID-based selector
  'button.message': { ... },        // Class-based selector  
  'button[data-chip]': { ... },     // Attribute selector
}
```

**However**, these selectors only work when:
1. Components use `useThemeOverrides` with matching parameters
2. The component manually integrates the theme system
3. The selector matches the component/context/identifier params

**Limitation:** No direct CSS targeting - requires component cooperation.

## Proposed Enhancement

### Design Goals

1. **Direct Targeting** - Apply styles/classes to elements matching CSS selectors without component integration
2. **Flexibility** - Support both inline styles (CSS properties) and class names
3. **Performance** - Minimal runtime overhead, efficient DOM updates
4. **Developer Experience** - Intuitive API that follows theme.ts patterns
5. **Type Safety** - TypeScript support for autocomplete and validation

### API Design

#### Syntax Option 1: Unified Object (Recommended)

```typescript
export default defineTheme({
  name: 'retro',
  // ... other config ...
  
  cssSelectors: {
    // Full config with both style and class
    '.custom-input': {
      style: {
        backgroundColor: 'var(--md-surface)',
        border: '2px solid var(--md-inverse-surface)',
        borderRadius: '3px',
      },
      class: 'retro-shadow',
    },
    
    // Style only (shorthand)
    '#special-button': {
      color: 'var(--md-primary)',
      padding: '8px 16px',
    },
    
    // Class only
    '.dialog-overlay': {
      class: 'backdrop-blur-sm bg-black/20',
    },
    
    // Complex selectors
    '.chat-container > .message:not(.system)': {
      style: {
        margin: '8px 0',
      },
      class: 'retro-message',
    },
    
    // Pseudo-selectors (applied via CSS rules)
    '.retro-btn:hover': {
      style: {
        transform: 'translateY(-1px)',
        boxShadow: '3px 3px 0 0 var(--md-inverse-surface)',
      },
    },
  },
});
```

#### Type Definition

```typescript
// In app/theme/_shared/types.ts

/**
 * CSS properties supported in theme definitions
 * Includes common properties with autocomplete support
 */
export interface CSSProperties {
  // Layout
  display?: string;
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  
  // Flexbox
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  
  // Spacing
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  
  // Colors
  color?: string;
  backgroundColor?: string;
  
  // Border
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderWidth?: string;
  borderStyle?: string;
  borderColor?: string;
  borderRadius?: string;
  
  // Typography
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  lineHeight?: string;
  textAlign?: string;
  
  // Visual Effects
  opacity?: string;
  transform?: string;
  transition?: string;
  boxShadow?: string;
  
  // Allow any other CSS property
  [key: string]: string | undefined;
}

/**
 * Configuration for CSS selector-based styling
 */
export interface CSSSelectorConfig {
  /** CSS properties to apply as inline styles or CSS rules */
  style?: CSSProperties;
  /** Class names to add to matching elements */
  class?: string;
}

/**
 * CSS selectors can be either:
 * - CSSSelectorConfig object with style and/or class
 * - CSSProperties object (shorthand for { style: properties })
 */
export type CSSSelector = CSSSelectorConfig | CSSProperties;

/**
 * Theme definition with CSS selector support
 */
export interface ThemeDefinition {
  name: string;
  displayName: string;
  description?: string;
  colors?: ColorPalette;
  overrides?: OverrideDefinitions;
  ui?: UIPresets;
  propMaps?: PropClassMaps;
  
  /**
   * Direct CSS targeting for elements that cannot use useThemeOverrides
   * 
   * @example
   * ```typescript
   * cssSelectors: {
   *   '.my-element': {
   *     style: { color: 'red' },
   *     class: 'rounded-md shadow-lg'
   *   }
   * }
   * ```
   */
  cssSelectors?: Record<string, CSSSelector>;
}
```

## Implementation Strategy

### 1. CSS Rule Injection

For the `style` property, generate CSS rules and inject via `<style>` tag:

```typescript
// In app/plugins/01.theme.client.ts

interface ThemeSelectorObserver {
  styleElement: HTMLStyleElement;
  mutationObserver: MutationObserver | null;
}

const selectorObservers = new Map<string, ThemeSelectorObserver>();

/**
 * Inject CSS rules from theme's cssSelectors
 */
function injectThemeStyles(theme: CompiledTheme): void {
  const styleId = `theme-${theme.name}-selectors`;
  
  // Remove old style element if exists
  const oldStyle = document.getElementById(styleId);
  if (oldStyle) {
    oldStyle.remove();
  }
  
  // Create new style element
  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.setAttribute('data-theme', theme.name);
  
  // Generate CSS rules
  const cssRules = generateCSSRules(theme.cssSelectors || {});
  styleEl.textContent = cssRules;
  
  // Inject into document head
  document.head.appendChild(styleEl);
  
  // Store reference
  const observer: ThemeSelectorObserver = {
    styleElement: styleEl,
    mutationObserver: null,
  };
  
  // Apply classes to matching elements
  if (hasClassSelectors(theme.cssSelectors)) {
    observer.mutationObserver = applyClassesToSelectors(theme.cssSelectors);
  }
  
  selectorObservers.set(theme.name, observer);
}

/**
 * Generate CSS rules from selector configuration
 */
function generateCSSRules(cssSelectors: Record<string, CSSSelector>): string {
  const rules: string[] = [];
  
  for (const [selector, config] of Object.entries(cssSelectors)) {
    // Determine if it's a full config or shorthand
    const isFullConfig = 'style' in config || 'class' in config;
    const styles = isFullConfig ? (config as CSSSelectorConfig).style : config as CSSProperties;
    
    if (!styles || Object.keys(styles).length === 0) {
      continue;
    }
    
    // Convert camelCase to kebab-case and build CSS rule
    const properties = Object.entries(styles)
      .map(([prop, value]) => {
        const kebabProp = prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
        return `  ${kebabProp}: ${value};`;
      })
      .join('\n');
    
    rules.push(`${selector} {\n${properties}\n}`);
  }
  
  return rules.join('\n\n');
}

/**
 * Check if any selectors have class configuration
 */
function hasClassSelectors(cssSelectors: Record<string, CSSSelector> | undefined): boolean {
  if (!cssSelectors) return false;
  
  return Object.values(cssSelectors).some(config => {
    const isFullConfig = 'style' in config || 'class' in config;
    return isFullConfig && (config as CSSSelectorConfig).class;
  });
}
```

### 2. Class Application with MutationObserver

For the `class` property, apply classes to matching elements:

```typescript
/**
 * Apply classes to elements matching CSS selectors
 * Uses MutationObserver to handle dynamically added elements
 */
function applyClassesToSelectors(
  cssSelectors: Record<string, CSSSelector>
): MutationObserver {
  const classMap = new Map<string, string[]>();
  
  // Build map of selector -> class names
  for (const [selector, config] of Object.entries(cssSelectors)) {
    const isFullConfig = 'style' in config || 'class' in config;
    const classStr = isFullConfig ? (config as CSSSelectorConfig).class : '';
    
    if (classStr) {
      const classes = classStr.split(/\s+/).filter(Boolean);
      classMap.set(selector, classes);
    }
  }
  
  /**
   * Apply classes to all matching elements
   */
  const applyClasses = () => {
    for (const [selector, classes] of classMap) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          el.classList.add(...classes);
        });
      } catch (error) {
        if (import.meta.dev) {
          console.warn(`[theme] Invalid selector: "${selector}"`, error);
        }
      }
    }
  };
  
  // Apply immediately
  applyClasses();
  
  // Watch for DOM changes
  const observer = new MutationObserver((mutations) => {
    // Only reapply if nodes were added
    const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
    if (hasAddedNodes) {
      applyClasses();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  
  return observer;
}
```

### 3. Cleanup on Theme Switch

```typescript
/**
 * Remove theme-specific styles and observers
 */
function cleanupThemeSelectors(themeName: string): void {
  const observer = selectorObservers.get(themeName);
  
  if (observer) {
    // Remove style element
    observer.styleElement.remove();
    
    // Disconnect mutation observer
    if (observer.mutationObserver) {
      observer.mutationObserver.disconnect();
    }
    
    selectorObservers.delete(themeName);
  }
}

/**
 * Update setActiveTheme to use new system
 */
const setActiveTheme = async (themeName: string) => {
  const target = sanitizeThemeName(themeName) || DEFAULT_THEME;
  const available = await ensureThemeLoaded(target);
  
  if (!available) {
    // ... fallback logic ...
    return;
  }
  
  // Cleanup old theme
  if (activeTheme.value !== target) {
    cleanupThemeSelectors(activeTheme.value);
  }
  
  activeTheme.value = target;
  localStorage.setItem(activeThemeStorageKey, target);
  writeActiveThemeCookie(target);
  
  const theme = themeRegistry.get(target);
  if (theme) {
    // Inject new theme styles
    injectThemeStyles(theme);
  }
};
```

## Performance Analysis

### CSS Rule Generation

**Complexity:** O(n) where n = number of selectors

```typescript
// Example: 10 selectors with 5 properties each
// Time: ~0.1-0.2ms (string concatenation)
// Memory: ~1-2KB (CSS text)
```

**Impact:** Negligible - happens once per theme switch.

### Class Application

**Initial Application:** O(n × m) where n = selectors, m = matching elements

```typescript
// Example: 5 selectors, 20 matching elements total
// Time: ~1-2ms (querySelectorAll + classList operations)
```

**MutationObserver:** Triggered on DOM changes

```typescript
// Per mutation: O(n × k) where k = newly added elements
// Typical: 0.1-0.5ms per mutation
// Throttling possible if needed
```

**Impact:** Low - MutationObserver is efficient for this use case.

### Memory Overhead

Per theme with CSS selectors:
- Style element: ~500 bytes - 2KB (depending on rules)
- MutationObserver: ~1KB
- Class map: ~500 bytes
- **Total:** ~2-4KB per theme

**Impact:** Minimal - acceptable for this feature.

### Optimization Opportunities

1. **Debounce MutationObserver** - Batch class applications
2. **Selector Caching** - Cache querySelectorAll results
3. **Lazy Initialization** - Only create observer if selectors exist
4. **Priority Levels** - Critical vs. optional selectors

## Use Cases

### 1. Third-Party Components

```typescript
cssSelectors: {
  // Style Monaco editor
  '.monaco-editor': {
    style: {
      border: '2px solid var(--md-inverse-surface)',
      borderRadius: '3px',
    },
    class: 'retro-shadow',
  },
  
  // Style TipTap editor
  '.ProseMirror': {
    style: {
      minHeight: '100px',
      padding: '12px',
    },
  },
}
```

### 2. Portal/Teleported Elements

```typescript
cssSelectors: {
  // Nuxt UI modal overlay (teleported to body)
  '[data-headlessui-state="open"] .fixed.inset-0': {
    class: 'backdrop-blur-sm',
    style: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
  },
}
```

### 3. Dynamic Third-Party Widgets

```typescript
cssSelectors: {
  // External chat widget
  '#chat-widget-container': {
    style: {
      bottom: '20px',
      right: '20px',
      zIndex: '9999',
    },
    class: 'retro-shadow rounded-lg',
  },
}
```

### 4. Legacy Code Refactoring

```typescript
cssSelectors: {
  // Gradually migrate old components
  '.legacy-modal': {
    style: {
      border: '2px solid var(--md-inverse-surface)',
      backgroundColor: 'var(--md-surface)',
    },
    class: 'retro-shadow',
  },
}
```

## Advantages

✅ **No Component Refactoring** - Theme elements without touching their code
✅ **Third-Party Support** - Style external libraries and widgets  
✅ **Flexibility** - Both styles and classes supported
✅ **Type Safe** - TypeScript autocomplete and validation
✅ **Performant** - CSS rules + efficient observer pattern
✅ **Maintainable** - All theme config in one place
✅ **Testable** - Easy to verify applied styles/classes

## Disadvantages

⚠️ **Selector Specificity** - May conflict with component styles (use `!important` if needed)
⚠️ **MutationObserver Overhead** - Small performance cost for class application
⚠️ **Selector Fragility** - Changes to external component structure may break selectors
⚠️ **No Server-Side Rendering** - Classes applied client-side only
⚠️ **Debugging Complexity** - Harder to trace where styles come from

## Comparison with Alternatives

### Alternative 1: Global CSS Files

```css
/* theme-retro.css */
.custom-element {
  background-color: var(--md-primary);
}
```

**Pros:** Simple, familiar, SSR-compatible
**Cons:** Not co-located with theme, no TypeScript, harder to maintain

### Alternative 2: CSS-in-JS

```typescript
const styles = css`
  .custom-element {
    background-color: var(--md-primary);
  }
`;
```

**Pros:** Co-located, dynamic
**Cons:** Runtime overhead, bundle size, complexity

### Alternative 3: Inline Style Injection

```typescript
// Manually set element.style.backgroundColor = '...'
```

**Pros:** Direct control
**Cons:** Verbose, hard to maintain, no reusability

**Recommended:** CSS Selector targeting in theme.ts offers the best balance of co-location, performance, and developer experience.

## Validation & Type Checking

### Build-Time Validation

```typescript
// In theme compiler
export class ThemeCompiler {
  private validateCSSSelectors(selectors: Record<string, CSSSelector>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    
    for (const [selector, config] of Object.entries(selectors)) {
      // Validate selector syntax
      try {
        document.querySelector(selector);
      } catch {
        issues.push({
          code: 'INVALID_CSS_SELECTOR',
          message: `Invalid CSS selector: "${selector}"`,
          severity: 'error',
          suggestion: 'Check selector syntax against CSS specification',
        });
      }
      
      // Validate config structure
      const isFullConfig = 'style' in config || 'class' in config;
      if (isFullConfig) {
        const cfg = config as CSSSelectorConfig;
        
        if (!cfg.style && !cfg.class) {
          issues.push({
            code: 'EMPTY_SELECTOR_CONFIG',
            message: `Selector "${selector}" has neither style nor class`,
            severity: 'warning',
          });
        }
      }
    }
    
    return issues;
  }
}
```

## Migration Path

### Phase 1: Add Type Definitions
- Add `CSSSelector`, `CSSSelectorConfig`, `CSSProperties` types
- Extend `ThemeDefinition` interface

### Phase 2: Implement Core Functionality
- Add `injectThemeStyles` function
- Add `applyClassesToSelectors` with MutationObserver
- Integrate into `setActiveTheme`

### Phase 3: Validation
- Add compiler validation for selectors
- Add runtime error handling

### Phase 4: Documentation
- Add usage examples to theme README
- Document best practices and limitations
- Add migration guide for common use cases

## Conclusion

**CSS selector targeting is both feasible and beneficial.** It fills a gap in the current theme system by enabling theming of elements that cannot easily integrate `useThemeOverrides`. 

The proposed implementation:
- ✅ Supports both styles (CSS properties) and classes
- ✅ Has minimal performance impact
- ✅ Provides excellent developer experience
- ✅ Maintains type safety
- ✅ Integrates cleanly with existing system

**Recommendation:** Implement this feature in Sprint 2 (Phase 4 of the task list).
