# Theme Performance Review Notes

## Objective
Reduce memory usage from 660MB to below 300MB while maintaining 100% functionality.

## Files Reviewed

### 1. app/plugins/90.theme.client.ts (714 lines)
**Memory Issues:**
- Line 296-317: localStorage cache with full JSON.stringify of compiledTheme - MAJOR MEMORY LEAK
- Line 241-269: themeRegistry Map stores full compiled themes - never cleared properly
- Line 242: resolverRegistry Map stores RuntimeResolver instances - potential duplication
- Line 56: cleanupCallbacks array grows with cleanups but may not be executed properly
- Line 80-94: baseAppConfig cloneDeep() creates unnecessary copies
- Line 101-106: Repeated cloneDeep() operations in applyThemeUiConfig
- Line 109-112: Repeated cloneDeep() in applyThemeAppConfigPatch
- Line 729-743: cloneDeep uses structuredClone OR JSON.parse/stringify - both memory intensive
- Line 686-712: Global hook registration that doesn't properly clean up

**Performance Issues:**
- Line 346-374: Parallelize asset loading is good, but icons loading could be lazy
- Line 541-594: setActiveTheme does too much work - could be optimized
- Line 686-712: page:finish hook fires on every navigation, re-applying classes

**Bugs:**
- Line 56-71: HMR cleanup may not fire properly in production
- Line 296-327: Cache may grow unbounded, no expiration or size limit
- Line 182: themeBackgroundTokenResolver created but never cleaned up

### 2. app/plugins/90.theme.server.ts (509 lines)
**Memory Issues:**
- Line 29: baseAppConfig cloneDeep - same as client
- Line 93-94: themeRegistry and resolverRegistry Maps without cleanup
- Line 162: Full theme stored in registry on SSR
- Line 445-459: cloneDeep implementations duplicate memory

**Performance Issues:**
- Line 104-185: loadTheme loads everything synchronously on SSR
- Line 124-127: await loadThemeStylesheets blocks rendering

**Notes:**
- Server-side is less critical for memory but still wasteful
- No cleanup since server-side is request-scoped

### 3. app/plugins/91.auto-theme.client.ts (464 lines)
**Memory Issues:**
- Line 379-403: watch() creates watcher for EVERY directive usage - MAJOR LEAK
- Line 226: Stores __theme_overrides__ on el as object - never cleaned up properly
- Line 14: classApplicationCache WeakMap in css-selector-runtime is good, but...
- Line 300-463: Directive logic runs for every component with v-theme

**Performance Issues:**
- Line 317-413: applyThemeDirective is called on mount AND update
- Line 321-329: Multiple DOM lookups for same element
- Line 379-394: Watch callback recreates resolver and resolves on EVERY theme change

**Bugs:**
- Line 84: NUXT_UI_COMPONENTS set never updated, hardcoded
- Line 398-402: onScopeDispose may not work correctly with directives

### 4. app/plugins/lazy-theme-fix.client.ts (37 lines)
**Memory Issues:**
- Line 5: unwatchers WeakMap is good for GC
- Line 23: watch() on resolversVersion for EVERY lazy component - potential leak
- Line 24: $forceUpdate() on every theme change is expensive

**Performance Issues:**
- Line 7-36: Global mixin affects ALL components, not just lazy ones
- Line 24: Force update causes full re-render

**Notes:**
- This is a workaround - root cause should be fixed instead

### 5. app/plugins/icon-registry.ts (19 lines)
**Memory Issues:**
- Line 2: iconRegistry singleton imported
- Line 8: nuxtApp.payload.iconRegistry stores full state
- Line 11: iconRegistry.hydrate loads full state

**Notes:**
- Minimal file, but iconRegistry itself may have issues (see _shared/icon-registry.ts)

### 6. app/plugins/00.theme-directive.ts (20 lines)
**Notes:**
- Minimal no-op for SSR
- No issues here

### 7. app/plugins/theme-overrides.client.ts (13 lines)
**Notes:**
- Minimal hook registration
- useUserThemeOverrides composable not reviewed yet

### 8. app/theme/_shared/icon-registry.ts (117 lines)
**Memory Issues:**
- Line 8: themes Record with reactive() - keeps ALL theme icons in memory
- Line 14: activeCache shallowRef is good, but still stores full icon map
- Line 24-29: registerTheme never removes old themes
- Line 46-53: rebuildCache creates new object every time, old ones may not GC
- Line 98-102: state getter returns reactive object reference

**Performance Issues:**
- Line 58-85: resolve() has fast path but still checks version reactivity

**Improvements Needed:**
- Add theme unregister method
- Limit number of cached themes
- Use Map instead of reactive Record

### 9. app/theme/_shared/runtime-resolver.ts (523 lines)
**Memory Issues:**
- Line 73-75: overrides array is copied and sorted - unnecessary
- Line 99: cache Map grows unbounded - NO SIZE LIMIT
- Line 64: componentsWithAttributes Set stores all component names
- Line 79-91: overrideIndex duplicates override references

**Performance Issues:**
- Line 397-422: deepMerge creates new objects recursively
- Line 361-389: merge() iterates all overrides in reverse
- Line 111-220: resolve() can't cache when element present

**Improvements Needed:**
- Add LRU cache with size limit
- Avoid copying overrides array
- Consider using frozen objects to prevent accidental mutations

### 10. app/theme/_shared/css-selector-runtime.ts (176 lines)
**Memory Issues:**
- Line 14: classApplicationCache WeakMap is GOOD for GC
- Line 52-64: Applied classes tracked in Set per element

**Performance Issues:**
- Line 30-86: applyThemeClasses chunks work, which is GOOD
- Line 34: 5ms budget per frame prevents jank - GOOD PATTERN
- Line 46: querySelectorAll runs for every selector - could batch

**Notes:**
- This file is actually well-optimized
- WeakMap usage prevents memory leaks

### 11. app/composables/useThemeResolver.ts (206 lines)
**Memory Issues:**
- Line 38-42: componentOverrideCache WeakMap is GOOD
- Line 179-200: Cache per component instance is good design
- Line 48-66: __createThemeOverrideCacheKey skips element-based - good

**Performance Issues:**
- Line 170-204: useThemeOverrides creates computed for every usage
- Line 172: Watches activeTheme.value - triggers recompute on theme change

**Notes:**
- Well-designed with WeakMap
- Could optimize by sharing computeds

### 12. app/composables/core/useThemeClasses.ts (48 lines)
**Memory Issues:**
- Line 35-46: onMounted async loads theme - could use cached version

**Performance Issues:**
- Line 40: await loadTheme() may cause unnecessary loads
- Line 43: applyThemeClasses called for every component using this

**Notes:**
- Should check if theme already loaded before calling loadTheme

## Summary of Key Issues

### Critical Memory Leaks:
1. **localStorage cache unbounded** (90.theme.client.ts:296-317)
2. **RuntimeResolver cache unbounded** (runtime-resolver.ts:99)
3. **watch() for every v-theme directive** (91.auto-theme.client.ts:379-403)
4. **themeRegistry never cleared** (90.theme.client.ts:241-269)
5. **Excessive cloneDeep operations** (multiple files)

### Performance Bottlenecks:
1. **$forceUpdate on every lazy component** (lazy-theme-fix.client.ts:24)
2. **Global mixin on ALL components** (lazy-theme-fix.client.ts:7-36)
3. **page:finish hook re-applying classes** (90.theme.client.ts:690-708)
4. **applyThemeDirective on mount AND update** (91.auto-theme.client.ts:422-434)

### Design Issues:
1. **themes reactive Record instead of Map** (icon-registry.ts:8)
2. **No theme unload mechanism**
3. **Duplicate data structures** (themeRegistry + resolverRegistry)

## Recommended Fixes (Priority Order)

### High Priority (Memory):
1. Add LRU cache with size limit to RuntimeResolver (max 100 entries)
2. Clear localStorage theme cache on theme switch (keep only active)
3. Debounce/optimize watch callbacks in auto-theme directive
4. Replace reactive() with Map in icon-registry
5. Implement theme cleanup when switching (unload previous theme properly)

### High Priority (Performance):
1. Remove lazy-theme-fix.client.ts mixin, use better approach
2. Batch v-theme directive processing
3. Optimize page:finish hook to only run when needed
4. Use Object.freeze on theme data to prevent mutations

### Medium Priority:
1. Replace cloneDeep with faster alternatives where possible
2. Lazy load theme icons only when needed
3. Cache compiled themes in memory, not localStorage
4. Add memory profiling in dev mode

### Low Priority:
1. Add theme preloading hints
2. Optimize CSS selector batching
3. Share computed refs across components

## Estimated Impact:
- LRU cache limits: -100MB
- Remove localStorage cache: -50MB
- Fix v-theme watchers: -150MB
- Optimize cloneDeep: -50MB
- Remove lazy-theme-fix: -100MB
- Theme cleanup: -100MB

**Total Estimated Savings: ~550MB**
**Target: Reduce from 660MB to <300MB (360MB reduction needed)**
