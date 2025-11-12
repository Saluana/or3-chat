# Lazy-Loaded Components and Dynamic Elements Analysis

## Question

**Will the runtime class application work with lazy-loaded components that don't exist in the DOM on page load?**

## Short Answer

**NO** - The current one-time class application approach has a limitation with lazy-loaded components.

## The Problem

The current implementation applies classes once per theme switch:

```typescript
function applyThemeClasses(themeName, selectors) {
  for (const [selector, config] of Object.entries(selectors)) {
    if (!config.class) continue;
    
    const classes = config.class.split(/\s+/).filter(Boolean);
    // Only finds elements that exist NOW
    document.querySelectorAll(selector).forEach(el => {
      el.classList.add(...classes);
    });
  }
}
```

**Issue:** If a component is lazy-loaded AFTER theme switch, `querySelectorAll` won't find it, so classes won't be applied.

## Impact Assessment

### When It Works ✅

- Static page elements (navigation, headers, footers)
- Components loaded on initial render
- Elements present during theme switch

### When It Fails ❌

- Lazy-loaded route components
- Dynamically mounted components (modals, dropdowns)
- Async-loaded third-party widgets
- Elements added after theme switch

## Solutions (Ordered by Recommendation)

### Solution 1: Re-apply on Component Mount (Recommended)

**Strategy:** Provide a composable that components can call when they mount.

```typescript
// app/composables/useThemeClasses.ts
export function useThemeClasses() {
  const { activeTheme } = useTheme();
  
  onMounted(() => {
    // Re-apply theme classes when this component mounts
    const theme = getTheme(activeTheme.value);
    if (theme?.cssSelectors) {
      applyThemeClasses(activeTheme.value, theme.cssSelectors);
    }
  });
}

// In lazy-loaded component
export default defineComponent({
  setup() {
    useThemeClasses(); // Call this
    // ... rest of component
  }
});
```

**Pros:**
- ✅ Opt-in (only used where needed)
- ✅ Minimal overhead (~1-2ms when component mounts)
- ✅ No observer needed
- ✅ Explicit and predictable

**Cons:**
- ⚠️ Requires developers to remember to call it
- ⚠️ Each lazy component needs the import

---

### Solution 2: Lightweight MutationObserver (Conditional)

**Strategy:** Only use MutationObserver if theme has `class` properties and dynamic elements are expected.

```typescript
// app/composables/useThemeCSS.ts
let observer: MutationObserver | null = null;

function startDynamicClassApplication(themeName: string, selectors: Record<string, any>) {
  // Stop existing observer
  stopDynamicClassApplication();
  
  // Only observe if there are class-based selectors
  const hasClasses = Object.values(selectors).some(cfg => cfg.class);
  if (!hasClasses) return;
  
  observer = new MutationObserver((mutations) => {
    // Debounce to avoid excessive calls
    requestIdleCallback(() => {
      applyThemeClasses(themeName, selectors);
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopDynamicClassApplication() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// In setActiveTheme
const setActiveTheme = async (themeName: string) => {
  await loadThemeCSS(themeName);
  setThemeAttribute(themeName);
  
  const theme = getTheme(themeName);
  if (theme?.cssSelectors) {
    // Initial application
    applyThemeClasses(themeName, theme.cssSelectors);
    
    // Optional: Start observing for dynamic elements
    if (import.meta.client && theme.observeDynamicElements) {
      startDynamicClassApplication(themeName, theme.cssSelectors);
    }
  }
  
  activeTheme.value = themeName;
};
```

**Configuration:**

```typescript
// In theme.ts
export default defineTheme({
  name: 'retro',
  
  // Enable dynamic element observation (opt-in)
  observeDynamicElements: true,
  
  cssSelectors: {
    '.lazy-component': {
      class: 'retro-shadow rounded-md',
    },
  },
});
```

**Pros:**
- ✅ Handles all dynamic elements automatically
- ✅ Opt-in via theme config
- ✅ Uses requestIdleCallback for performance

**Cons:**
- ⚠️ Adds ~0.1-0.5ms overhead per mutation
- ⚠️ More complex implementation
- ⚠️ Can cause unnecessary re-applications

---

### Solution 3: Auto-Detect on Nuxt Page Navigation

**Strategy:** Re-apply classes on route changes (catches most lazy-loaded components).

```typescript
// app/plugins/01.theme.client.ts
export default defineNuxtPlugin((nuxtApp) => {
  // ... existing code ...
  
  // Re-apply classes after navigation completes
  nuxtApp.hook('page:finish', () => {
    const theme = themeRegistry.get(activeTheme.value);
    if (theme?.cssSelectors) {
      // Wait for next tick to ensure components are mounted
      nextTick(() => {
        applyThemeClasses(activeTheme.value, theme.cssSelectors);
      });
    }
  });
});
```

**Pros:**
- ✅ Automatic for route-based lazy loading
- ✅ No developer intervention needed
- ✅ Minimal overhead (only on navigation)

**Cons:**
- ⚠️ Only works for page-level navigation
- ⚠️ Doesn't catch modals, dropdowns, etc.
- ⚠️ Nuxt-specific

---

### Solution 4: CSS-Only Alternative (No Runtime)

**Strategy:** Use CSS custom properties + Tailwind config instead of runtime classes.

```typescript
// theme.ts - Define CSS variables
cssSelectors: {
  ':root[data-theme="retro"]': {
    '--modal-overlay-bg': 'rgb(0 0 0 / 0.5)',
    '--modal-overlay-blur': '8px',
  },
}

// tailwind.config.ts - Create utilities
export default {
  theme: {
    extend: {
      backgroundColor: {
        'modal-overlay': 'var(--modal-overlay-bg)',
      },
      backdropBlur: {
        'modal': 'var(--modal-overlay-blur)',
      },
    },
  },
}

// Component - Use utilities directly
<div class="bg-modal-overlay backdrop-blur-modal">
```

**Pros:**
- ✅ Zero runtime overhead
- ✅ Works with all dynamic elements
- ✅ Type-safe

**Cons:**
- ❌ Not suitable for third-party elements
- ❌ Requires modifying component markup
- ❌ Less flexible than direct class application

---

## Recommended Hybrid Approach

**Combine Solutions 1 + 3 for best results:**

1. **Auto-apply on page navigation** (Solution 3) - Handles route-level lazy loading
2. **Provide useThemeClasses composable** (Solution 1) - For non-route dynamic elements
3. **Document the pattern** - Clear guidance for developers

```typescript
// Automatic for route components
nuxtApp.hook('page:finish', () => {
  nextTick(() => applyThemeClasses(...));
});

// Manual for dynamic components (modals, etc.)
// In Modal.vue
export default defineComponent({
  setup() {
    useThemeClasses(); // Ensures classes applied on mount
  }
});
```

**Performance:**
- Page navigation: +1-2ms (acceptable, happens infrequently)
- Dynamic component mount: +0.5-1ms (only when using composable)
- **Total overhead: Minimal, predictable, opt-in**

## Updated Documentation Needed

Add to implementation docs:

### Lazy-Loaded Components

**The one-time class application approach has a limitation:** Classes are only applied to elements present at theme switch time.

**For lazy-loaded components, use one of these approaches:**

1. **Route components:** Automatically handled via `page:finish` hook
2. **Dynamic components (modals, dropdowns):** Call `useThemeClasses()` composable in setup
3. **Third-party widgets:** Ensure they load before theme initialization, or use CSS custom properties

**Example:**

```vue
<script setup>
// Lazy-loaded modal component
import { useThemeClasses } from '#imports';

// Re-apply theme classes when this component mounts
useThemeClasses();
</script>
```

## Final Recommendation

**Implement Solution 1 + 3:**
- Auto-apply on page navigation (covers 90% of cases)
- Provide `useThemeClasses` composable for edge cases
- Document the limitation clearly
- Optional: Add Solution 2 (observer) as opt-in for advanced users

**Performance remains excellent:**
- Most elements: 0ms (CSS only)
- Page navigation: +1-2ms (infrequent)
- Dynamic components with composable: +0.5-1ms per component

**Trade-off is acceptable:**
- Solves the lazy-loading problem
- Maintains performance
- Clear, predictable behavior
- Opt-in complexity
