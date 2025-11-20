# Theme System Code Review

**Verdict**: `High`

**Executive Summary**

-   **Over-engineered**: The system reinvents CSS cascading in JavaScript with custom specificity calculations, a DSL, and runtime compilation. This is heavy and fragile.
-   **Duplication**: Logic is duplicated between build-time (`scripts/theme-compiler.ts`) and runtime (`app/theme/_shared/runtime-compile.ts`) compilers.
-   **Performance Risk**: Runtime class application (`applyThemeClasses`) relies on `requestAnimationFrame` loops and `querySelectorAll`, indicating a heavy main-thread cost.
-   **Maintenance Burden**: The custom DSL and validation logic add significant code weight and cognitive load compared to standard CSS/Tailwind solutions.

## Findings

### 1. Duplicate Compiler Logic

-   **Severity**: `High`
-   **Evidence**: `scripts/theme-compiler.ts` vs `app/theme/_shared/runtime-compile.ts`
-   **Why**: Violates "One way to do it". Any change to selector syntax or specificity rules must be applied in two places.
-   **Fix**: Extract the core compilation logic (parsing, specificity, normalization) into a shared module used by both the build script and the runtime.

### 2. Expensive Runtime DOM Manipulation

-   **Severity**: `High`
-   **Evidence**: `app/theme/_shared/css-selector-runtime.ts` lines 22-80 (`applyThemeClasses`)
-   **Why**: The function uses `document.querySelectorAll` and iterates through elements in `requestAnimationFrame` chunks. This suggests the operation is too heavy for a single frame, which is a red flag for UI responsiveness.
-   **Fix**:
    -   Prefer CSS variables for styling where possible.
    -   If class injection is needed, scope it more tightly or use a `MutationObserver` only on relevant subtrees rather than global queries.
    -   Consider removing `cssSelectors` feature in favor of standard global CSS files if performance is an issue.

### 3. Complex Custom DSL

-   **Severity**: `Medium`
-   **Evidence**: `app/theme/_shared/types.ts` (`ThemeDefinition`, `OverrideProps`)
-   **Why**: The DSL adds a layer of abstraction over CSS/Tailwind that requires learning and maintenance. It forces runtime resolution of things that could be static CSS.
-   **Fix**: Evaluate if the `overrides` system can be replaced by standard CSS modules or Tailwind `@apply` layers. If dynamic overrides are needed, simplify the selector syntax to avoid full CSS parsing.

### 4. Recursive Config Merging

-   **Severity**: `Medium`
-   **Evidence**: `app/plugins/90.theme.client.ts` (`recursiveUpdate`)
-   **Why**: Deep merging large config objects at runtime can be slow and cause garbage collection pressure.
-   **Fix**: Use a shallow merge where possible or use a specialized library like `defu` (standard in Nuxt) instead of a custom recursive implementation.

### 5. WeakMap Cache Key Generation

-   **Severity**: `Low`
-   **Evidence**: `app/composables/useThemeResolver.ts` (`__createThemeOverrideCacheKey`)
-   **Why**: The cache key is a string join. If params contain complex objects or unexpected values, this might be inefficient or collide.
-   **Fix**: Ensure params are strictly typed and validated before key generation.

## Diffs and Examples

### Refactor: Shared Compiler Logic

Create `app/theme/_shared/compiler-core.ts`:

```typescript
import type { ParsedSelector, AttributeMatcher } from './types';

// Move parseSelector, normalizeSelector, calculateSpecificity here
export function parseSelector(selector: string): ParsedSelector {
    // ... implementation from runtime-compile.ts
}

export function calculateSpecificity(parsed: ParsedSelector): number {
    // ... implementation
}
```

Update `scripts/theme-compiler.ts` and `app/theme/_shared/runtime-compile.ts` to import from `compiler-core.ts`.

### Refactor: Use `defu` for Config Merging

In `app/plugins/90.theme.client.ts`:

```typescript
import { defu } from 'defu';

// Replace recursiveUpdate with defu
const mergedConfig = defu(theme.ui, appConfig.ui);
```

## Deletions

-   **Delete**: `app/theme/_shared/runtime-compile.ts` (after extracting shared logic).
-   **Delete**: Custom `recursiveUpdate` function in `90.theme.client.ts` (use `defu`).

## Checklist for Merge

-   [ ] Extract shared compiler logic to `app/theme/_shared/compiler-core.ts`.
-   [ ] Refactor `scripts/theme-compiler.ts` to use shared logic.
-   [ ] Refactor `app/theme/_shared/runtime-compile.ts` to use shared logic (or delete if fully redundant).
-   [ ] Replace `recursiveUpdate` with `defu`.
-   [ ] Profile `applyThemeClasses` with a large DOM to verify performance impact.
