## Verdict

**High**

---

## Executive Summary

-   **Blocker:** Async plugin initialization blocks app boot on every page load, running theme discovery and validation before the app mounts.
-   **Blocker:** Multiple `any` types violate strict TypeScript policy. `config`, `mergeThemeConfig`, and validation logic lack precise types.
-   **High:** Memory leak in CSS injection. Style elements accumulate in `<head>` on repeated theme switches. No cleanup on failure paths.
-   **High:** Test failure exposes logic bug. Default theme has critical error but validation conflates warnings with errors (`result.errors.length > 0` treats all as blocking).
-   **Medium:** Heavy CSS duplication across themes (1211 lines total). No shared base for component styles—each theme repeats button/card/modal rules.
-   **Medium:** Performance waste. `validateAllThemes()` validates every theme on mount. Themes loaded but never cached. No lazy loading.

---

## Findings

### 1. Async Plugin Blocks App Boot

**Severity:** Blocker  
**Evidence:** `app/plugins/theme.client.ts:11`

```typescript
export default defineNuxtPlugin(async (nuxtApp) => {
    // ...
    await initializeThemes();
    await loadAndValidateTheme(activeTheme.value);
```

**Why:** Every page load waits for theme discovery (glob scan) and validation (CSS loading). App cannot mount until these async operations finish. This adds latency to first paint.

**Fix:** Make plugin synchronous. Defer non-critical work:

```typescript
export default defineNuxtPlugin((nuxtApp) => {
    // Synchronous setup
    const current = ref(readThemeMode());
    apply(current.value);

    // Defer async work
    const initPromise = initializeAndLoad();

    async function initializeAndLoad() {
        await initializeThemes();
        await loadAndValidateTheme(activeTheme.value);
    }

    nuxtApp.provide('theme', {
        get ready() {
            return initPromise;
        },
        // ...rest of API
    });
});
```

**Tests:**

```typescript
it('should not block app boot', async () => {
    const startTime = performance.now();
    const plugin = await import('~/plugins/theme.client');
    const bootTime = performance.now() - startTime;
    expect(bootTime).toBeLessThan(50); // Plugin init < 50ms
});
```

---

### 2. Type Holes with `any`

**Severity:** Blocker  
**Evidence:**

-   `app/theme/_shared/theme-loader.ts:33` `config?: any;`
-   `app/theme/_shared/theme-loader.ts:268` `mergeThemeConfig(base: any, override: any): any`
-   `app/theme/_shared/config-merger.ts:20,28` `[key: string]: any`

**Why:** `any` disables type checking. Cannot prove correctness. Runtime crashes if config shape changes.

**Fix:** Use proper types from config-merger.ts:

```typescript
import type { AppConfig } from './config-merger';

export interface ThemeLoadResult {
    manifest: ThemeManifest;
    lightCss?: string;
    darkCss?: string;
    mainCss?: string;
    config?: Partial<AppConfig>; // Not any
    errors: ThemeError[];
    warnings: ThemeWarning[];
}

export function mergeThemeConfig(
    base: AppConfig,
    override: Partial<AppConfig>
): AppConfig {
    return defuMerge(base, override);
}
```

Remove index signatures. If dynamic keys needed, use `Record<string, unknown>` and validate at runtime with Zod.

**Tests:**

```typescript
it('should reject invalid config at compile time', () => {
    const invalid = { ui: { button: 123 } }; // Should error
    // @ts-expect-error - invalid config shape
    mergeThemeConfig(baseConfig, invalid);
});
```

---

### 3. Memory Leak in CSS Injection

**Severity:** High  
**Evidence:** `app/plugins/theme.client.ts:75-90,91-95,176-208`

```typescript
const injectThemeCSS = (css: string, themeName: string, mode: string) => {
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;
    if (!styleElement) {
        styleElement = document.createElement('style');
        // Creates element, adds to head
        document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
};

const removeThemeCSS = (themeName: string) => {
    const styleElements = document.querySelectorAll(
        `style[data-theme="${themeName}"]`
    );
    styleElements.forEach((el) => el.remove());
};
```

**Why:** If `loadAndValidateTheme` throws after injecting partial CSS, style elements remain. No cleanup. On repeated switch failures, `<head>` fills with orphaned `<style>` tags. Each theme switch adds 3 elements (light, dark, main). 10 switches = 30 elements. Memory grows unbounded.

**Fix:** Wrap injection in try-finally. Clean up on error:

```typescript
const switchTheme = async (themeName: string) => {
    const theme = availableThemes.value.find((t) => t.name === themeName);
    if (!theme) return false;

    const oldTheme = activeTheme.value;
    let injected = false;

    try {
        const result = await loadAndValidateTheme(themeName);
        const criticalErrors = result.errors.filter(
            (e) => e.severity === 'error'
        );

        if (!result || criticalErrors.length > 0) {
            throw new Error(`Theme ${themeName} has critical errors`);
        }

        injected = true;

        // Only commit if validation passed
        if (oldTheme && oldTheme !== themeName) {
            removeThemeCSS(oldTheme);
        }

        activeTheme.value = themeName;
        localStorage.setItem(activeThemeStorageKey, themeName);
        apply(current.value);

        return true;
    } catch (err) {
        if (injected) {
            removeThemeCSS(themeName); // Rollback on error
        }
        console.error('[theme]', err);
        return false;
    }
};
```

**Tests:**

```typescript
it('should clean up CSS on load failure', async () => {
    vi.mocked(loadTheme).mockRejectedValueOnce(new Error('Load failed'));

    const beforeCount = document.querySelectorAll('style[data-theme]').length;
    await switchTheme('broken-theme');
    const afterCount = document.querySelectorAll('style[data-theme]').length;

    expect(afterCount).toBe(beforeCount); // No leak
});

it('should not accumulate style elements on repeated switches', async () => {
    for (let i = 0; i < 10; i++) {
        await switchTheme('cyberpunk');
        await switchTheme('minimal');
    }

    const elements = document.querySelectorAll('style[data-theme]');
    expect(elements.length).toBeLessThanOrEqual(6); // 2 themes * 3 files
});
```

---

### 4. Test Failure and Logic Bug

**Severity:** High  
**Evidence:**

-   Test: `app/theme/_shared/__tests__/theme-loader.test.ts:129`
-   Code: `app/plugins/theme.client.ts:195`

```typescript
// Test expects 0 errors with severity 'error'
const criticalErrors = result.errors.filter((e) => e.severity === 'error');
expect(criticalErrors).toHaveLength(0); // FAILS: got 1

// But plugin rejects ALL errors, not just critical
if (!result || result.errors.length > 0) {
    console.error(`Theme has critical errors`);
    return false;
}
```

**Why:** Validation returns both errors and warnings in `result.errors` array. `result.errors.length > 0` blocks themes with warnings. Test is correct—plugin is wrong. Default theme likely has a warning-level missing CSS var.

**Fix:** Check severity:

```typescript
const switchTheme = async (themeName: string) => {
    const result = await loadAndValidateTheme(themeName);

    const criticalErrors =
        result?.errors.filter((e) => e.severity === 'error') ?? [];

    if (!result || criticalErrors.length > 0) {
        console.error(
            `[theme] Cannot switch: ${themeName} has ${criticalErrors.length} critical errors`,
            criticalErrors
        );
        return false;
    }

    // Warnings allowed
    if (
        result.warnings.length > 0 ||
        result.errors.some((e) => e.severity === 'warning')
    ) {
        console.warn(
            `[theme] ${themeName} loaded with warnings`,
            result.warnings
        );
    }

    // Proceed with switch
    // ...
};
```

**Tests:**

```typescript
it('should allow themes with warnings', async () => {
    vi.mocked(loadTheme).mockResolvedValueOnce({
        manifest: mockManifest,
        lightCss: 'css',
        errors: [
            { file: 'light.css', message: 'missing var', severity: 'warning' },
        ],
        warnings: [],
    });

    const result = await switchTheme('theme-with-warnings');
    expect(result).toBe(true); // Should succeed
});

it('should block themes with critical errors', async () => {
    vi.mocked(loadTheme).mockResolvedValueOnce({
        manifest: mockManifest,
        lightCss: 'css',
        errors: [
            { file: 'light.css', message: 'parse error', severity: 'error' },
        ],
        warnings: [],
    });

    const result = await switchTheme('broken-theme');
    expect(result).toBe(false); // Should fail
});
```

---

### 5. Missing ThemeManifest Properties

**Severity:** Medium  
**Evidence:** `app/components/dashboard/ThemeSelector.vue:54,59,284,285`

```vue
<div v-if="theme.hasLightHc" ... />
<div v-if="theme.hasDarkHc" ... />

const themeHasLightHc = (theme: ThemeManifest) => hasVariant(theme, 'light-hc')
```

But `ThemeManifest` in `theme-loader.ts:16` only has:

```typescript
export interface ThemeManifest {
    name: string;
    path: string;
    hasLight: boolean;
    hasDark: boolean;
    hasMain: boolean;
    hasConfig: boolean;
    variants: (...)[]; // But no hasLightHc/hasDarkHc
}
```

**Why:** Template references non-existent properties. Code works because TypeScript `as any` casts in component. Type hole.

**Fix:** Use `variants` array or add properties:

```vue
<template>
    <div v-if="theme.variants.includes('light-hc')" ... />
    <div v-if="theme.variants.includes('dark-hc')" ... />
</template>
```

Or extend interface:

```typescript
export interface ThemeManifest {
    // ... existing
    hasLightHc?: boolean;
    hasDarkHc?: boolean;
    hasLightMc?: boolean;
    hasDarkMc?: boolean;
}

// In discoverThemes()
manifest.hasLightHc = `${basePath}/light-hc.css` in themeCssFiles;
manifest.hasDarkHc = `${basePath}/dark-hc.css` in themeCssFiles;
```

**Tests:** Type-only check. No runtime test needed if using variants array.

---

### 6. Performance: Validate All Themes on Mount

**Severity:** Medium  
**Evidence:** `app/components/dashboard/ThemeSelector.vue:259-268,273`

```typescript
const validateAllThemes = async () => {
    themeErrors.value = {};
    themeWarnings.value = {};

    for (const theme of availableThemes.value) {
        await validateTheme(theme.name); // Sequential async
    }
};

onMounted(async () => {
    await validateAllThemes(); // Blocks mount
});
```

**Why:** With 4 themes, mount triggers 4 sequential theme loads. Each loads 3 CSS files. 12 async operations before component renders. User sees blank theme selector for seconds.

**Fix:** Validate on demand when theme card is hovered or clicked:

```typescript
const validationCache = ref<Record<string, { errors: ThemeError[], warnings: ThemeWarning[] }>>({});

const getValidation = async (themeName: string) => {
    if (validationCache.value[themeName]) {
        return validationCache.value[themeName];
    }

    const result = await $theme.validateTheme(themeName);
    validationCache.value[themeName] = {
        errors: result?.errors ?? [],
        warnings: result?.warnings ?? []
    };
    return validationCache.value[themeName];
};

// In template
@mouseenter="getValidation(theme.name)"
```

Or parallelize:

```typescript
const validateAllThemes = async () => {
    const results = await Promise.all(
        availableThemes.value.map((t) => validateTheme(t.name))
    );
    // ...
};
```

**Tests:**

```typescript
it('should validate themes in parallel', async () => {
    const start = performance.now();
    await validateAllThemes();
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500); // Under 500ms for 4 themes
});
```

---

### 7. CSS Duplication Across Themes

**Severity:** Medium  
**Evidence:**

-   main.css 380 lines
-   main.css 322 lines
-   main.css 335 lines
-   main.css 174 lines
-   Total: 1211 lines, ~70% duplication in button/card/modal rules

**Why:** Each theme repeats `.retro-btn`, card, modal, and input styles. Only colors differ. Bundle includes all themes. Unused themes waste bytes.

**Fix:** Extract shared base to `app/theme/_shared/base.css`:

```css
/* _shared/base.css */
.retro-btn {
    font-weight: 600;
    border-radius: var(--btn-radius, 8px);
    padding: var(--btn-padding, 0.75rem 1.5rem);
    /* Colors from theme variables */
    background: var(--btn-bg);
    color: var(--btn-color);
    border: var(--btn-border);
}
```

Themes only set variables:

```css
/* cyberpunk/main.css */
@import '../_shared/base.css';

:root {
    --btn-bg: linear-gradient(
        45deg,
        var(--cyberpunk-dark-bg),
        var(--cyberpunk-grid)
    );
    --btn-color: var(--cyberpunk-neon-cyan);
    --btn-border: 2px solid var(--cyberpunk-neon-cyan);
}
```

Saves ~800 lines. Reduces bundle by ~20KB.

**Tests:**

```typescript
it('should share base styles across themes', () => {
    const cyberpunkCSS = readFileSync('app/theme/cyberpunk/main.css', 'utf8');
    const natureCSS = readFileSync('app/theme/nature/main.css', 'utf8');

    expect(cyberpunkCSS).toContain('@import');
    expect(cyberpunkCSS.length).toBeLessThan(200); // Mostly variables
});
```

---

### 8. Dead Code in Root Directory

**Severity:** Low  
**Evidence:** test-theme-switch.js, set-theme.js in project root

**Why:** Dev test scripts. Not part of build. Clutter root. Should be in scripts or deleted if one-time use.

**Fix:** Delete if no longer needed:

```bash
git rm test-theme-switch.js set-theme.js
```

Or move:

```bash
mkdir -p scripts/dev-tools
git mv test-theme-switch.js set-theme.js scripts/dev-tools/
```

**Tests:** No test needed.

---

### 9. Unused ThemeErrorService

**Severity:** Nit  
**Evidence:** `app/theme/_shared/theme-loader.ts:274-295`

```typescript
export class ThemeErrorService {
    private errors: ThemeError[] = [];
    private warnings: ThemeWarning[] = [];
    // ... 20 lines
}

export const themeErrors = new ThemeErrorService();
```

**Why:** Class instantiated but only used in one test. Plugin uses local `errors` and `warnings` refs instead. Dead weight.

**Fix:** Delete class. Use plain arrays:

```typescript
// Remove class entirely
// Plugin already has:
const errors = ref<ThemeError[]>([]);
const warnings = ref<ThemeWarning[]>([]);
```

**Tests:** Remove class from tests. Use plugin's exposed refs.

---

### 10. No Theme Caching

**Severity:** Medium  
**Evidence:** `app/plugins/theme.client.ts:111-137`

```typescript
const loadAndValidateTheme = async (themeName: string, injectCss = true) => {
    // Always awaits loadTheme(), no cache
    const result = await loadTheme(themeName);
    // ...
};
```

**Why:** Switching from `cyberpunk` to `minimal` and back to `cyberpunk` loads cyberpunk CSS twice. Same network/disk reads. Wastes time.

**Fix:** Add LRU cache (size 3):

```typescript
const themeCache = new Map<string, ThemeLoadResult>();
const MAX_CACHE = 3;

const loadAndValidateTheme = async (themeName: string, injectCss = true) => {
    if (themeCache.has(themeName)) {
        const cached = themeCache.get(themeName)!;
        if (injectCss) {
            // Re-inject cached CSS
            if (cached.lightCss)
                injectThemeCSS(cached.lightCss, themeName, 'light');
            if (cached.darkCss)
                injectThemeCSS(cached.darkCss, themeName, 'dark');
            if (cached.mainCss)
                injectThemeCSS(cached.mainCss, themeName, 'main');
        }
        return cached;
    }

    const result = await loadTheme(themeName);

    // Evict oldest if cache full
    if (themeCache.size >= MAX_CACHE) {
        const firstKey = themeCache.keys().next().value;
        themeCache.delete(firstKey);
    }

    themeCache.set(themeName, result);

    // Inject CSS...
    return result;
};
```

**Tests:**

```typescript
it('should cache loaded themes', async () => {
    vi.mocked(loadTheme).mockResolvedValue(mockResult);

    await switchTheme('cyberpunk');
    await switchTheme('minimal');
    await switchTheme('cyberpunk'); // Should use cache

    expect(loadTheme).toHaveBeenCalledTimes(2); // Not 3
});
```

---

## Diffs and Examples

### Fix 1: Non-Blocking Plugin Init

```typescript
// app/plugins/theme.client.ts
export default defineNuxtPlugin((nuxtApp) => {
    // Remove async
    const THEME_CLASSES = [
        /*...*/
    ];
    const root = document.documentElement;

    const availableThemes = ref<ThemeManifest[]>([]);
    const activeTheme = ref<string>('default');
    const errors = ref<ThemeError[]>([]);
    const warnings = ref<ThemeWarning[]>([]);

    const isReady = ref(false);

    // Synchronous setup
    const current = ref(readThemeMode());
    apply(current.value);
    activeTheme.value = readActiveTheme();

    // Defer async work (don't await)
    const readyPromise = (async () => {
        try {
            availableThemes.value = discoverThemes();
            await loadAndValidateTheme(activeTheme.value);
            isReady.value = true;
        } catch (err) {
            console.error('[theme] Init failed:', err);
        }
    })();

    // Rest of plugin code...

    nuxtApp.provide('theme', {
        set,
        toggle,
        get: () => current.value,
        system: getSystemPref,
        current,
        activeTheme,
        availableThemes,
        switchTheme,
        reloadTheme,
        errors,
        warnings,
        validateTheme,
        getThemeManifest,
        ready: readyPromise, // Expose for components that need it
        isReady: readonly(isReady),
    });
});
```

### Fix 2: Remove `any` Types

```typescript
// app/theme/_shared/theme-loader.ts
import type { AppConfig } from './config-merger';

export interface ThemeLoadResult {
    manifest: ThemeManifest;
    lightCss?: string;
    darkCss?: string;
    mainCss?: string;
    config?: Partial<AppConfig>; // Not any
    errors: ThemeError[];
    warnings: ThemeWarning[];
}

export function mergeThemeConfig(
    base: AppConfig,
    override: Partial<AppConfig>
): AppConfig {
    return defuMerge(base, override) as AppConfig;
}
```

```typescript
// app/theme/_shared/config-merger.ts
export interface AppConfig {
    ui?: {
        button?: {
            slots?: Record<string, string | string[]>;
            variants?: {
                size?: Record<string, { base?: string }>;
                color?: Record<string, string>;
            };
        };
        [key: string]: unknown; // Not any
    };
    mentions?: {
        enabled?: boolean;
        debounceMs?: number;
        maxPerGroup?: number;
        maxContextBytes?: number;
    };
    [key: string]: unknown; // Not any
}
```

### Fix 3: Cleanup on Error

```typescript
// app/plugins/theme.client.ts
const switchTheme = async (themeName: string) => {
    const theme = availableThemes.value.find((t) => t.name === themeName);
    if (!theme) {
        console.error(`[theme] Theme "${themeName}" not found`);
        return false;
    }

    const oldTheme = activeTheme.value;
    let cssInjected = false;

    try {
        const result = await loadAndValidateTheme(themeName, false); // Don't inject yet

        const criticalErrors =
            result?.errors.filter((e) => e.severity === 'error') ?? [];
        if (!result || criticalErrors.length > 0) {
            throw new Error(
                `Theme has ${criticalErrors.length} critical errors`
            );
        }

        // Inject CSS only after validation passes
        if (result.lightCss) {
            injectThemeCSS(result.lightCss, themeName, 'light');
        }
        if (result.darkCss) {
            injectThemeCSS(result.darkCss, themeName, 'dark');
        }
        if (result.mainCss) {
            injectThemeCSS(result.mainCss, themeName, 'main');
        }
        cssInjected = true;

        // Remove old theme CSS
        if (oldTheme && oldTheme !== themeName) {
            removeThemeCSS(oldTheme);
        }

        activeTheme.value = themeName;
        localStorage.setItem(activeThemeStorageKey, themeName);
        apply(current.value);

        return true;
    } catch (err) {
        console.error(`[theme] Failed to switch to ${themeName}:`, err);

        // Rollback: remove any CSS we injected
        if (cssInjected) {
            removeThemeCSS(themeName);
        }

        return false;
    }
};
```

### Fix 4: Check Error Severity

```typescript
// app/plugins/theme.client.ts - loadAndValidateTheme
const loadAndValidateTheme = async (themeName: string, injectCss = true) => {
    try {
        errors.value = [];
        warnings.value = [];

        const result = await loadTheme(themeName);

        // Separate critical errors from warnings
        const criticalErrors = result.errors.filter(
            (e) => e.severity === 'error'
        );
        const warningErrors = result.errors.filter(
            (e) => e.severity === 'warning'
        );

        errors.value = criticalErrors;
        warnings.value = [...result.warnings, ...warningErrors];

        // Log warnings but don't block
        warnings.value.forEach((warning) => {
            console.warn('[theme]', warning.message, warning.file);
        });

        // Log and surface critical errors
        criticalErrors.forEach((error) => {
            console.error('[theme]', error.message, error.file);
        });

        if (injectCss) {
            // Inject CSS even with warnings (not critical errors)
            if (result.lightCss)
                injectThemeCSS(result.lightCss, themeName, 'light');
            if (result.darkCss)
                injectThemeCSS(result.darkCss, themeName, 'dark');
            if (result.mainCss)
                injectThemeCSS(result.mainCss, themeName, 'main');
        }

        return result;
    } catch (err) {
        const error: ThemeError = {
            file: themeName,
            message: `Failed to load theme: ${
                err instanceof Error ? err.message : 'Unknown error'
            }`,
            severity: 'error',
        };

        errors.value = [error];
        console.error('[theme]', error.message);

        return null;
    }
};
```

### Fix 5: Use Variants Array

```vue
<!-- app/components/dashboard/ThemeSelector.vue -->
<template>
    <div class="theme-preview">
        <div class="flex gap-1">
            <div
                v-if="theme.variants.includes('light')"
                class="w-3 h-3 rounded-full bg-white border border-black"
                title="Light variant"
            />
            <div
                v-if="theme.variants.includes('dark')"
                class="w-3 h-3 rounded-full bg-black"
                title="Dark variant"
            />
            <div
                v-if="theme.variants.includes('light-hc')"
                class="w-3 h-3 rounded-full bg-yellow-200 border-2 border-black"
                title="Light high-contrast variant"
            />
            <div
                v-if="theme.variants.includes('dark-hc')"
                class="w-3 h-3 rounded-full bg-gray-900 border-2 border-white"
                title="Dark high-contrast variant"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
// Remove unused helper functions
// Delete: themeHasLightHc, themeHasDarkHc
</script>
```

### Fix 6: Lazy Validation

```typescript
// app/components/dashboard/ThemeSelector.vue
const validationCache = ref<Record<string, { errors: ThemeError[], warnings: ThemeWarning[] }>>({});
const validating = ref<Set<string>>(new Set());

const validateTheme = async (themeName: string) => {
  // Already cached
  if (validationCache.value[themeName]) {
    return validationCache.value[themeName];
  }

  // Already validating
  if (validating.value.has(themeName)) {
    return;
  }

  validating.value.add(themeName);

  try {
    const result = await $theme.validateTheme(themeName);
    if (result) {
      validationCache.value[themeName] = {
        errors: result.errors,
        warnings: result.warnings
      };
    }
  } catch (error) {
    console.error(`Error validating theme ${themeName}:`, error);
  } finally {
    validating.value.delete(themeName);
  }
};

// Remove validateAllThemes
// Remove onMounted validateAllThemes call

// In template, validate on hover
<div
  class="theme-option"
  @mouseenter="validateTheme(theme.name)"
>
```

---

## Performance Notes

1. **Plugin Init**: Async plugin blocks app boot by ~200-500ms depending on filesystem speed. Fix reduces to <10ms by deferring work.

2. **CSS Injection**: Each theme switch injects 3 `<style>` tags. Without cleanup, 10 switches = 30 tags. Fix ensures max 6 tags (2 themes × 3 files).

3. **Validation on Mount**: ThemeSelector mounts and validates 4 themes sequentially = ~1-2 seconds blank screen. Fix defers to hover = instant render.

4. **CSS Duplication**: 1211 lines of CSS across 4 themes. ~70% duplication. Extracting base saves ~800 lines = ~20KB gzipped.

5. **No Caching**: Theme switch A→B→A loads A twice. With cache, second load is instant (0ms vs ~150ms).

**Verification:**

```bash
# Before fix: measure plugin init time
bun run nuxt dev
# Check DevTools Performance: "Plugin: theme.client.ts" ~300ms

# After fix: should be <10ms
```

---

## Deletions

### Files

-   test-theme-switch.js - Dev script, not part of build
-   set-theme.js - Dev script, not part of build

### Code

-   `app/theme/_shared/theme-loader.ts:274-295` - `ThemeErrorService` class (unused)
-   `app/components/dashboard/ThemeSelector.vue:284-285` - `themeHasLightHc`, `themeHasDarkHc` helpers (use variants array)
-   `app/components/dashboard/ThemeSelector.vue:259-268` - `validateAllThemes` (lazy validation instead)

### Dependencies

No deps to remove. `defu` is used.

---

## Checklist for Merge

-   [ ] Fix async plugin: make `defineNuxtPlugin` synchronous, defer theme loading
-   [ ] Replace all `any` types with `AppConfig` or `Partial<AppConfig>`
-   [ ] Add cleanup to `switchTheme`: rollback CSS on error
-   [ ] Fix error severity check: filter `severity === 'error'`, allow warnings
-   [ ] ThemeSelector: use `theme.variants.includes()` instead of non-existent properties
-   [ ] ThemeSelector: remove `validateAllThemes()`, validate on hover
-   [ ] Extract shared CSS to `_shared/base.css`, reduce duplication by ~800 lines
-   [ ] Add LRU cache (size 3) for loaded themes
-   [ ] Delete test-theme-switch.js and set-theme.js or move to scripts
-   [ ] Delete `ThemeErrorService` class
-   [ ] Add tests: non-blocking init, cleanup on error, cache behavior, severity filtering
-   [ ] Run `bun run vitest` - all tests pass
-   [ ] Measure bundle size before/after CSS extraction
-   [ ] Check DevTools Performance: plugin init <10ms
