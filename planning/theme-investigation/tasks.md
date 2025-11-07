# Theme System Investigation - Implementation Tasks

## Task Overview

This document outlines actionable tasks for addressing the three theme system concerns:
1. Fixing data attribute application to non-Nuxt elements
2. Implementing CSS selector targeting in theme.ts
3. Optimizing performance and memory usage

## Task List

### Phase 1: Investigation & Documentation (Immediate)

- [x] 1. Analyze current theme system architecture
  - [x] 1.1 Review RuntimeResolver implementation
  - [x] 1.2 Review useThemeOverrides composable
  - [x] 1.3 Review theme plugin initialization
  - [x] 1.4 Document current data flow

**Requirements:** Background research

---

- [x] 2. Create comprehensive documentation
  - [x] 2.1 Document findings about data attribute application
  - [x] 2.2 Document CSS selector targeting feasibility
  - [x] 2.3 Document performance analysis
  - [x] 2.4 Create example code snippets

**Requirements:** 1.1-1.4  
**Location:** `planning/theme-investigation/findings/`

---

### Phase 2: Type System Fixes (Sprint 1 - Week 1)

- [ ] 3. Fix TypeScript types for data attributes
  - [ ] 3.1 Update `ResolvedOverride` interface to include optional data attributes
    ```typescript
    export interface ResolvedOverride {
        props: Record<string, unknown> & {
            'data-theme-target'?: string;
            'data-theme-matches'?: string;
        };
    }
    ```
  - [ ] 3.2 Update `useThemeOverrides` return type
  - [ ] 3.3 Remove `as any` casts from component files
  - [ ] 3.4 Add JSDoc comments explaining dev-only nature

**Requirements:** 2.1  
**Files:**
- `app/theme/_shared/runtime-resolver.ts`
- `app/composables/useThemeResolver.ts`
- `app/components/chat/ChatMessage.vue`
- `app/components/chat/ChatInputDropper.vue`

---

- [ ] 4. Verify development mode detection
  - [ ] 4.1 Add logging to confirm `import.meta.dev` value
  - [ ] 4.2 Test data attributes appear in dev mode
  - [ ] 4.3 Test data attributes are absent in production build
  - [ ] 4.4 Document how to enable/disable in nuxt.config.ts

**Requirements:** 3.1-3.4

---

### Phase 3: Performance Optimization (Sprint 1 - Week 2)

- [ ] 5. Implement override indexing
  - [ ] 5.1 Add `overrideIndex` Map to RuntimeResolver
    ```typescript
    private overrideIndex: Map<string, CompiledOverride[]>;
    ```
  - [ ] 5.2 Build index in constructor
  - [ ] 5.3 Update resolve() to use indexed lookup
  - [ ] 5.4 Measure performance improvement

**Requirements:** 2.3  
**Files:**
- `app/theme/_shared/runtime-resolver.ts`

---

- [ ] 6. Add performance benchmarks
  - [ ] 6.1 Create test file `runtime-resolver.perf.test.ts`
  - [ ] 6.2 Add override resolution benchmark (target < 1ms)
  - [ ] 6.3 Add theme switch benchmark (target < 50ms)
  - [ ] 6.4 Add memory leak detection test
  - [ ] 6.5 Run benchmarks and document baseline

**Requirements:** 5.1-5.4  
**Files:**
- `app/theme/_shared/__tests__/runtime-resolver.perf.test.ts` (new)

---

- [ ] 7. Implement resolution caching
  - [ ] 7.1 Add WeakMap cache to useThemeOverrides
  - [ ] 7.2 Generate cache keys from params
  - [ ] 7.3 Clear cache on theme switch
  - [ ] 7.4 Measure cache hit rate and performance gain

**Requirements:** 6.1-6.5  
**Files:**
- `app/composables/useThemeResolver.ts`

---

### Phase 4: CSS Selector Support (Sprint 2 - Week 1)

- [ ] 8. Extend theme definition types
  - [ ] 8.1 Add `cssSelectors` field to ThemeDefinition
    ```typescript
    interface CSSSelectorConfig {
        style?: CSSProperties;
        class?: string; // Tailwind classes via @apply
    }
    
    interface ThemeDefinition {
        // ... existing fields
        cssSelectors?: Record<string, CSSSelectorConfig | CSSProperties>;
    }
    ```
  - [ ] 8.2 Add CSSProperties type with common CSS properties
  - [ ] 8.3 Update theme compiler to validate CSS selectors
  - [ ] 8.4 Add example to retro theme with both style and class

**Requirements:** 2.2  
**Files:**
- `app/theme/_shared/types.ts`
- `scripts/theme-compiler.ts`
- `app/theme/retro/theme.ts`

---

- [ ] 9. Implement build-time CSS generation with class support
  - [ ] 9.1 Create `scripts/build-theme-css.ts` script
  - [ ] 9.2 Generate scoped CSS with `[data-theme="name"]` prefix
  - [ ] 9.3 Support `style` properties (direct CSS)
  - [ ] 9.4 Support `class` properties (via @apply directive)
  - [ ] 9.5 Integrate PostCSS/Tailwind processing
  - [ ] 9.6 Output CSS files to `public/themes/` directory
  - [ ] 9.7 Generate manifest.json mapping theme names to CSS files
  - [ ] 9.8 Integrate into Vite build process via theme compiler plugin
  - [ ] 9.9 Add CSS linting (max 2 combinators, validate selectors)

**Requirements:** 8.1-8.4  
**Files:**
- `scripts/build-theme-css.ts` (new)
- `plugins/vite-theme-compiler.ts`
- `public/themes/` (generated)
- `package.json` (add postcss dependency)

---

- [ ] 10. Implement runtime CSS loading
  - [ ] 10.1 Create `composables/useThemeCSS.ts` for CSS file loading
  - [ ] 10.2 Fetch manifest.json at app initialization
  - [ ] 10.3 Load CSS file when theme is activated (if not cached)
  - [ ] 10.4 Set `data-theme` attribute on document root
  - [ ] 10.5 Add prefetch links for inactive themes
  - [ ] 10.6 Integrate into `plugins/01.theme.client.ts`

**Requirements:** 9.1-9.9  
**Files:**
- `app/composables/useThemeCSS.ts` (new)
- `app/plugins/01.theme.client.ts`

---

- [ ] 11. Add CSS targeting documentation
  - [ ] 11.1 Document cssSelectors syntax (both style and class)
  - [ ] 11.2 Explain build-time generation and @apply processing
  - [ ] 11.3 Document data-theme scoping
  - [ ] 11.4 Provide examples of common use cases (Tailwind utilities)
  - [ ] 11.5 Document performance characteristics (zero runtime overhead)
  - [ ] 11.6 Explain @apply limitations and workarounds
  - [ ] 11.7 Add troubleshooting guide for selector specificity

**Requirements:** 10.1-10.6  
**Files:**
- `app/theme/README.md`
- `planning/theme-investigation/findings/hybrid-class-solution.md`

---

### Phase 5: Advanced Optimizations (Sprint 2 - Week 2)

- [ ] 11. Optimize data attribute generation
  - [ ] 11.1 Convert data attributes to lazy getters
  - [ ] 11.2 Measure memory reduction
  - [ ] 11.3 Verify DevTools can still access attributes
  - [ ] 11.4 Document memory savings

**Requirements:** 6.4, 7.4  
**Files:**
- `app/theme/_shared/runtime-resolver.ts`

---

- [ ] 12. Add deep merge memoization
  - [ ] 12.1 Create memoization utility for UI object merging
  - [ ] 12.2 Use weak caching for merge results
  - [ ] 12.3 Benchmark performance improvement
  - [ ] 12.4 Document when memoization helps vs hurts

**Requirements:** 6.1-6.5  
**Files:**
- `app/theme/_shared/runtime-resolver.ts`

---

### Phase 6: Testing & Validation (Sprint 3)

- [ ] 13. Add unit tests for new features
  - [ ] 13.1 Test data attribute typing
  - [ ] 13.2 Test override indexing
  - [ ] 13.3 Test CSS selector injection
  - [ ] 13.4 Test caching behavior
  - [ ] 13.5 Achieve > 90% code coverage

**Requirements:** 5.1-5.4, 8.1-8.4, 9.1-9.5  
**Files:**
- `app/theme/_shared/__tests__/runtime-resolver.test.ts`
- `app/composables/__tests__/useThemeResolver.test.ts`

---

- [ ] 14. Add integration tests
  - [ ] 14.1 Test data attributes appear in DOM
  - [ ] 14.2 Test CSS selectors apply styles
  - [ ] 14.3 Test theme switching updates styles
  - [ ] 14.4 Test performance benchmarks pass

**Requirements:** 13.1-13.5  
**Files:**
- `tests/theme-integration.spec.ts` (new)

---

- [ ] 15. Manual testing
  - [ ] 15.1 Test in development mode with DevTools
  - [ ] 15.2 Test production build excludes data attributes
  - [ ] 15.3 Test theme switching is smooth
  - [ ] 15.4 Test memory doesn't grow over time
  - [ ] 15.5 Test on different browsers

**Requirements:** 14.1-14.4

---

### Phase 7: Documentation & Cleanup (Sprint 3)

- [ ] 16. Update developer documentation
  - [ ] 16.1 Update theme system README
  - [ ] 16.2 Add performance optimization guide
  - [ ] 16.3 Document best practices for theme authors
  - [ ] 16.4 Add troubleshooting section

**Requirements:** All previous tasks  
**Files:**
- `app/theme/README.md`
- `docs/theme-system.md`
- `docs/performance.md`

---

- [ ] 17. Code cleanup
  - [ ] 17.1 Remove unused code
  - [ ] 17.2 Standardize code style
  - [ ] 17.3 Add/update comments
  - [ ] 17.4 Run linter and fix issues

**Requirements:** 16.1-16.4

---

- [ ] 18. Performance monitoring
  - [ ] 18.1 Add performance marks for key operations
  - [ ] 18.2 Create dashboard for monitoring metrics
  - [ ] 18.3 Set up alerts for performance regressions
  - [ ] 18.4 Document monitoring setup

**Requirements:** 6.1-6.5  
**Files:**
- `app/theme/_shared/runtime-resolver.ts`
- `app/plugins/01.theme.client.ts`

---

## Priority Summary

### Critical (Do First)
1. Task 3: Fix TypeScript types for data attributes
2. Task 4: Verify development mode detection
3. Task 2: Create comprehensive documentation

### High Priority (Sprint 1)
4. Task 5: Implement override indexing
5. Task 6: Add performance benchmarks
6. Task 7: Implement resolution caching

### Medium Priority (Sprint 2)
7. Task 8: Extend theme definition types
8. Task 9: Implement CSS injection system
9. Task 10: Add CSS targeting documentation

### Low Priority (Sprint 3+)
10. Task 11: Optimize data attribute generation
11. Task 12: Add deep merge memoization
12. Task 13-18: Testing, documentation, cleanup

## Estimated Timeline

- **Phase 1 (Investigation):** Complete ✓
- **Phase 2 (Type Fixes):** 2-3 days
- **Phase 3 (Performance):** 3-5 days
- **Phase 4 (CSS Selectors):** 5-7 days
- **Phase 5 (Advanced):** 3-5 days
- **Phase 6 (Testing):** 3-5 days
- **Phase 7 (Documentation):** 2-3 days

**Total Estimated Time:** 3-4 weeks for full implementation

## Success Criteria

- [ ] Data attributes appear correctly on non-Nuxt elements in dev mode
- [ ] TypeScript errors are resolved, no `as any` casts needed
- [ ] Theme authors can target elements by CSS selector in theme.ts
- [ ] Override resolution averages < 0.5ms (50% improvement)
- [ ] Theme switching completes in < 30ms (40% improvement)
- [ ] Memory usage doesn't grow over time in dev mode
- [ ] All tests pass with > 90% coverage
- [ ] Documentation is comprehensive and up-to-date

## Notes

- Focus on backward compatibility - no breaking changes
- Prioritize developer experience improvements
- Measure everything - before and after metrics
- Document trade-offs and design decisions
- Consider future extensibility in design choices
