### Option 3: Hybrid - Build-Time CSS + Minimal Runtime Classes

**Strategy:** Best of both worlds - CSS for styles, one-time runtime for classes.

**Implementation:**

```typescript
// In theme.ts
cssSelectors: {
  '.monaco-editor': {
    style: {
      border: '2px solid var(--md-inverse-surface)',
      borderRadius: '3px',
    },
    class: 'retro-shadow', // Simple classes only
  },

  '.custom-button': {
    // Just styles for precision
    style: {
      backgroundColor: 'var(--md-primary)',
      color: 'var(--md-on-primary)',
    },
  },

  '.modal-overlay': {
    // Just classes for rapid prototyping
    class: 'fixed inset-0 bg-black/50 backdrop-blur-sm dark:bg-black/70',
  },
}

// Build script generates CSS
function buildThemeCSS(theme: ThemeDefinition): string {
  const blocks: string[] = [];

  for (const [selector, config] of Object.entries(theme.cssSelectors || {})) {
    // Only generate CSS for style properties
    if (config.style) {
      const declarations = Object.entries(config.style)
        .map(([prop, value]) => `  ${toKebab(prop)}: ${value};`)
        .join('\n');

      blocks.push(
        `[data-theme="${theme.name}"] ${selector} {\n${declarations}\n}`
      );
    }
  }

  return blocks.join('\n\n');
}

// Runtime: Lightweight class application
const classApplicationCache = new WeakMap<HTMLElement, Set<string>>();

function applyThemeClasses(themeName: string, selectors: Record<string, any>) {
  for (const [selector, config] of Object.entries(selectors)) {
    if (!config.class) continue;

    const classes = config.class.split(/\s+/).filter(Boolean);

    try {
      document.querySelectorAll(selector).forEach(el => {
        // Track what we've added to avoid duplicates
        if (!classApplicationCache.has(el)) {
          classApplicationCache.set(el, new Set());
        }

        const applied = classApplicationCache.get(el)!;
        const newClasses = classes.filter(c => !applied.has(c));

        if (newClasses.length > 0) {
          el.classList.add(...newClasses);
          newClasses.forEach(c => applied.add(c));
        }
      });
    } catch (error) {
      if (import.meta.dev) {
        console.warn(`[theme] Invalid selector: "${selector}"`, error);
      }
    }
  }
}

// Integration
const setActiveTheme = async (themeName: string) => {
  // Load CSS file
  await loadThemeCSS(themeName);

  // Set attribute (CSS applies immediately)
  document.documentElement.setAttribute('data-theme', themeName);

  // Apply classes once (minimal overhead)
  const theme = getTheme(themeName);
  if (theme?.cssSelectors) {
    applyThemeClasses(themeName, theme.cssSelectors);
  }

  activeTheme.value = themeName;
};
```

**Performance Breakdown:**

-   CSS file load: 0ms (cached after first load)
-   Attribute change: 0ms
-   Class application: ~0.5-2ms depending on selector count
-   **Total: ~0.5-2ms per theme switch**

**Memory:**

-   WeakMap tracking: ~500 bytes - 1KB
-   No observer overhead

**Limitation: Lazy-Loaded Components**

⚠️ **Important:** Classes are only applied to elements present at theme switch time.

**Problem:** If a component is lazy-loaded AFTER theme initialization, `querySelectorAll` won't find it, so classes won't be applied.

**Solutions:**

1. **Auto-apply on page navigation** (Recommended for route components):

    ```typescript
    nuxtApp.hook('page:finish', () => {
        nextTick(() => {
            const theme = getTheme(activeTheme.value);
            if (theme?.cssSelectors) {
                applyThemeClasses(activeTheme.value, theme.cssSelectors);
            }
        });
    });
    ```

2. **Provide composable for dynamic components**:

    ```typescript
    // app/composables/useThemeClasses.ts
    export function useThemeClasses() {
        const { activeTheme } = useTheme();

        onMounted(() => {
            const theme = getTheme(activeTheme.value);
            if (theme?.cssSelectors) {
                applyThemeClasses(activeTheme.value, theme.cssSelectors);
            }
        });
    }

    // In lazy-loaded component
    <script setup>useThemeClasses(); // Re-apply when component mounts</script>;
    ```

3. **Optional MutationObserver** (for advanced cases):
    ```typescript
    // Enable via theme config
    observeDynamicElements: true;
    ```

See [lazy-loading-analysis.md](./lazy-loading-analysis.md) for detailed analysis and solutions.
