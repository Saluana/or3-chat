# Core Composables Review - DI Findings

**Date**: 2026-02-01  
**Scope**: 9 Core Composables in `app/composables/core/`  
**Reviewer**: neckbear-review skill + doc-maker standards

---

## Executive Summary

Found **17 issues** across the core composables:
- **3 Critical** (architecture violations, potential data loss)
- **6 High** (performance bottlenecks, missing error handling)
- **5 Medium** (documentation gaps, type safety issues)
- **3 Low** (naming inconsistencies, dead code)

**Documentation Coverage**: 6/9 composables have partial docs in docmap.json. 3 are completely missing.

---

## Critical Issues

### Issue 1: Global Singleton Anti-Pattern in useLazyBoundaries

**Location**: `app/composables/core/useLazyBoundaries.ts:21`

**Code**:
```typescript
let lazyBoundariesInstance: LazyBoundaryController | null = null;
```

**Why This Is Bad**:
The skill documentation explicitly states "New global singletons without registry/composable" is an auto-fail anti-pattern. This module-level singleton bypasses Vue's reactivity system and HMR lifecycle. The state persists across HMR but the telemetry listeners and module cache don't get properly reset, causing memory leaks and stale state.

**Consequences**:
- Memory leaks in development (HMR doesn't clean up listeners)
- Test pollution (singleton persists across test runs)
- Cannot have multiple instances for different contexts
- Breaks the OR3 plugin architecture which expects registry patterns

**Fix**:
```typescript
// Use Vue's provide/inject or a proper registry pattern
import { createGlobalState } from '@vueuse/core';

export const useLazyBoundaries = createGlobalState(() => {
  const state = reactive<Record<LazyBoundaryKey, LazyBoundaryState>>({...});
  // ... controller logic
  return controller;
});
```

---

### Issue 2: Missing Cleanup for matchMedia Listeners in useResponsiveState

**Location**: `app/composables/core/useResponsiveState.ts:36-37`

**Code**:
```typescript
mobileQuery.addEventListener('change', updateBreakpoints);
desktopQuery.addEventListener('change', updateBreakpoints);
```

**Why This Is Bad**:
Listeners are registered but never cleaned up on component unmount. The HMR dispose handler exists but only removes listeners during hot reload, not when components actually unmount. Each component using this composable leaks two event listeners.

**Consequences**:
- Memory leak in long-running SPAs
- Stale closures retaining component references
- Performance degradation as listener count grows

**Fix**:
```typescript
export function useResponsiveState() {
  if (typeof window === 'undefined') {
    return { isMobile: ref(false), isTablet: ref(false) };
  }
  
  if (!sharedState) {
    sharedState = createResponsiveState();
  }
  
  // Add proper cleanup tracking
  onScopeDispose(() => {
    // Only cleanup if this is the last consumer
    // (requires reference counting)
  });
  
  return sharedState;
}
```

---

### Issue 3: Unbounded Pane Widths Array in useMultiPane

**Location**: `app/composables/core/useMultiPane.ts:77-200`

**Code**:
```typescript
const paneWidths = useLocalStorage<number[]>(storageKey, [], {...});
```

**Why This Is Bad**:
The `paneWidths` array can grow unbounded if panes are added/removed repeatedly. While the resize logic handles mismatches, there's no cleanup of the localStorage when pane count drops, leaving orphaned width entries that bloat storage.

**Consequences**:
- localStorage bloat over time
- Potential quota exceeded errors
- Stale data affecting new sessions

**Fix**:
```typescript
function cleanupOrphanedWidths(currentPaneCount: number) {
  if (paneWidths.value.length > currentPaneCount) {
    paneWidths.value = paneWidths.value.slice(0, currentPaneCount);
  }
}

// Call in closePane() and addPane()
```

---

## High Priority Issues

### Issue 4: Missing Zod Validation for External Data in useMultiPane

**Location**: `app/composables/core/useMultiPane.ts:119-150`

**Code**:
```typescript
async function defaultLoadMessagesFor(id: string): Promise<MultiPaneMessage[]> {
  const msgs = await db.messages.where('[thread_id+index]').between(...).toArray();
  return msgs.map((msg) => {
    const row = msg as unknown as DbMessageRow;  // Blind cast
    // ...
  });
}
```

**Why This Is Bad**:
Database results are cast with `as unknown` without runtime validation. If Dexie schema changes or returns unexpected shapes, this will fail silently or produce garbage data. The AGENTS.md mandates Zod validation for all external data.

**Consequences**:
- Runtime type mismatches
- Silent data corruption
- Hard to debug errors downstream

**Fix**:
```typescript
import { z } from 'zod';

const DbMessageRowSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().optional(),
  file_hashes: z.string().nullable().optional(),
  // ...
});

const row = DbMessageRowSchema.parse(msg);
```

---

### Issue 5: Race Condition in useTokenizer Worker Initialization

**Location**: `app/composables/core/useTokenizer.ts:85-107`

**Code**:
```typescript
const ensureWorker = async (): Promise<Worker | null> => {
  if (!import.meta.client) return null;
  if (workerInstance) return workerInstance;
  if (workerPromise) return workerPromise;  // Race condition here
  
  workerPromise = new Promise<Worker | null>((resolve) => {
    try {
      const worker = new Worker(...);
      // ...
```

**Why This Is Bad**:
Between checking `workerPromise` and setting it, another call could create a second worker. The check-then-set pattern is not atomic. In high-concurrency scenarios (multiple components initializing simultaneously), this creates duplicate workers.

**Consequences**:
- Duplicate Web Workers consuming memory
- Double initialization of the tokenizer
- Potential message routing conflicts

**Fix**:
```typescript
const ensureWorker = async (): Promise<Worker | null> => {
  if (!import.meta.client) return null;
  if (workerInstance) return workerInstance;
  
  // Use a single promise as synchronization primitive
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        const worker = new Worker(...);
        setupWorker(worker);
        workerInstance = worker;
        return worker;
      } catch (error) {
        // ...
      }
    })();
  }
  
  return workerPromise;
};
```

---

### Issue 6: No Error Recovery in usePreviewCache Loader

**Location**: `app/composables/core/usePreviewCache.ts:59-84`

**Code**:
```typescript
async function ensure(
  key: string,
  loader: Loader,
  pin = 0
): Promise<string | undefined> {
  const existing = map.get(key);
  if (existing) {
    // ...
  }
  
  misses++;
  const { url, bytes } = await loader();  // Unhandled rejection
  // ...
}
```

**Why This Is Bad**:
The loader function can throw, but the error propagates uncaught to the caller. The cache state is left inconsistent (misses incremented, but no entry added). No retry logic or error state tracking exists.

**Consequences**:
- Cache poisoning on partial failures
- No visibility into loader failures
- Callers must handle errors manually

**Fix**:
```typescript
async function ensure(key: string, loader: Loader, pin = 0): Promise<string | undefined> {
  // ...
  try {
    misses++;
    const result = await loader();
    // Validate result
    if (!result?.url) throw new Error('Loader returned invalid result');
    // ...
  } catch (error) {
    // Track error state
    const errorEntry: CacheEntry = {
      url: '',
      bytes: 0,
      lastAccess: ++accessCounter,
      pin: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    map.set(key, errorEntry);
    throw error;
  }
}
```

---

### Issue 7: Weak Error Handling in useWorkspaceBackup Import

**Location**: `app/composables/core/useWorkspaceBackup.ts:549-562`

**Code**:
```typescript
} catch (e) {
  state.error.value = asAppError(e);
  state.currentStep.value = 'error';
  reportError(state.error.value, {
    code: 'ERR_DB_WRITE_FAILED',
    message: 'Failed to import workspace.',
    tags: { domain: 'db', action: 'import' },
  });
  // ...
}
```

**Why This Is Bad**:
All errors are lumped together with the same code `ERR_DB_WRITE_FAILED`. Import failures could be validation errors, quota exceeded, or corruption - each requiring different user feedback. The `asAppError` utility may lose important context.

**Consequences**:
- Poor user experience (generic error messages)
- Difficult troubleshooting (no error categorization)
- Potential data loss on partial imports

**Fix**:
```typescript
} catch (e) {
  const error = asAppError(e);
  
  // Categorize errors
  if (error.message.includes('quota')) {
    state.error.value = err('ERR_DB_QUOTA_EXCEEDED', ...);
  } else if (error.message.includes('validation')) {
    state.error.value = err('ERR_VALIDATION', ...);
  } else {
    state.error.value = err('ERR_DB_WRITE_FAILED', ...);
  }
  
  state.currentStep.value = 'error';
  reportError(state.error.value, { ... });
}
```

---

### Issue 8: Performance Bottleneck in useMultiPane Dexie Query

**Location**: `app/composables/core/useMultiPane.ts:122-126`

**Code**:
```typescript
const msgs = await db.messages
  .where('[thread_id+index]')
  .between([id, Dexie.minKey], [id, Dexie.maxKey])
  .filter((m) => !m.deleted)
  .toArray();
```

**Why This Is Bad**:
The `.filter()` runs in JavaScript after fetching all records from IndexedDB. For threads with thousands of messages, this loads everything into memory then filters. Should use a Dexie-native filter or compound index.

**Consequences**:
- O(n) memory usage for thread messages
- UI freezing on large threads
- Unnecessary I/O for deleted messages

**Fix**:
```typescript
// Add a compound index on [thread_id+deleted+index]
const msgs = await db.messages
  .where({ thread_id: id, deleted: 0 })
  .sortBy('index');
```

---

## Medium Priority Issues

### Issue 9: Missing Documentation in docmap.json

**Location**: `public/_documentation/docmap.json`

**Affected Composables**:
- `usePanePrompt` - Missing entirely
- `usePreviewCache` - Listed but has no dedicated doc file
- `useTokenizer` - Listed but summary is incomplete

**Why This Is Bad**:
Three core composables are undocumented. Developers cannot discover these APIs without reading source code, violating the "Intent over mechanics" principle from SKILL.md.

**Consequences**:
- Developer confusion
- Incorrect usage patterns
- Duplicated functionality elsewhere

**Fix**:
Add entries to docmap.json following the SKILL.md template:
```json
{
  "name": "usePanePrompt.md",
  "path": "/composables/usePanePrompt",
  "category": "Core",
  "summary": "Simple per-pane prompt staging utility..."
}
```

---

### Issue 10: Inconsistent JSDoc Format

**Location**: All composables

**Code Examples**:
```typescript
// useHookEffect.ts - Missing structured sections
/**
 * Register a callback to a hook name and clean up on unmount and HMR.
 * Typed by hook name for great DX. Returns a disposer you can call manually.
 */

// useLazyBoundaries.ts - Good but missing Constraints section
/**
 * Singleton lazy boundary manager.
 * Tracks loading state, memoizes resolved modules, and emits telemetry.
 */
```

**Why This Is Bad**:
The SKILL.md mandates a specific structure: Purpose, Behavior, Constraints, Non-Goals, @example. Most composables only have a brief summary, making it hard to understand:
- When should I use it?
- What guarantees does it make?
- When should I not use it?

**Consequences**:
- API misuse
- Hours of source code archaeology
- Tech debt as developers work around undocumented behavior

**Fix**:
Update all composables to follow SKILL.md template. Example for useHookEffect:
```typescript
/**
 * `useHookEffect`
 *
 * Purpose:
 * Provides lifecycle-safe hook subscriptions for Vue components.
 * Automatically unsubscribes when the component unmounts.
 *
 * Behavior:
 * Registers an action listener via `$hooks.addAction()` and removes it
 * on component `onUnmounted`. Safe to call multiple times; each call
 * creates an independent subscription.
 *
 * Constraints:
 * - Must be called during component setup (synchronous setup context)
 * - Does not support filters; use `useHooks().addFilter()` directly
 * - Priority defaults to 10
 *
 * Non-Goals:
 * - Does not deduplicate listeners; caller is responsible for idempotency
 * - Does not support wildcard patterns (use `useHooks()` directly)
 *
 * @example
 * ```ts
 * // In a component's <script setup>
 * useHookEffect('route.change:action:after', (ctx, to, from) => {
 *   console.log('Navigated from', from.path, 'to', to.path);
 * });
 * ```
 *
 * @see useHooks for direct hook engine access
 * @see docs/hooks.md for hook naming conventions
 */
```

---

### Issue 11: useResponsiveState Returns Different Shapes on SSR vs Client

**Location**: `app/composables/core/useResponsiveState.ts:74-90`

**Code**:
```typescript
export function useResponsiveState() {
  if (typeof window === 'undefined') {
    return {
      isMobile: ref(false),
      isTablet: ref(false),
      // Missing: isDesktop, hydrated
    };
  }
  // ...
  return sharedState;  // Has isDesktop, hydrated
}
```

**Why This Is Bad**:
The return type is inconsistent between SSR and client. TypeScript may not catch this, causing runtime errors when accessing `isDesktop` or `hydrated` during SSR.

**Consequences**:
- SSR crashes
- Hydration mismatches
- Defensive coding everywhere

**Fix**:
```typescript
export interface ResponsiveState {
  isMobile: Ref<boolean>;
  isTablet: Ref<boolean>;
  isDesktop: Ref<boolean>;  // Always present
  hydrated: Ref<boolean>;   // Always present
}

export function useResponsiveState(): ResponsiveState {
  if (typeof window === 'undefined') {
    return {
      isMobile: ref(false),
      isTablet: ref(false),
      isDesktop: ref(true),   // Default assumption
      hydrated: ref(false),   // Never hydrated on server
    };
  }
  // ...
}
```

---

### Issue 12: usePanePrompt No Cleanup for Deleted Panes

**Location**: `app/composables/core/usePanePrompt.ts:1-27`

**Code**:
```typescript
const pendingByPane: Record<string, string | null> = reactive({});

export function clearPanePendingPrompt(paneId: string) {
  delete pendingByPane[paneId];
}
```

**Why This Is Bad**:
There's no automatic cleanup when panes are destroyed. The reactive object grows unbounded with orphaned pane IDs. The `useMultiPane` composable closes panes but never calls `clearPanePendingPrompt`.

**Consequences**:
- Memory leak in long sessions
- Stale data if pane ID is reused
- No visibility into orphaned entries

**Fix**:
Add a hook listener in useMultiPane:
```typescript
// In useMultiPane's closePane():
void hooks.doAction('ui.pane.close:action:after', {
  pane: closing,
  index: i,
});

// In usePanePrompt, auto-cleanup:
if (import.meta.client) {
  const hooks = useHooks();
  hooks.addAction('ui.pane.close:action:after', ({ pane }) => {
    clearPanePendingPrompt(pane.id);
  });
}
```

---

### Issue 13: usePreviewCache No Memory Pressure Handling

**Location**: `app/composables/core/usePreviewCache.ts:1-220`

**Why This Is Bad**:
The cache tracks memory usage but doesn't respond to browser memory pressure events. When the system signals low memory, the cache should aggressively evict.

**Consequences**:
- Browser tab crashes on memory pressure
- Poor performance on low-end devices
- User experience degradation

**Fix**:
```typescript
if (typeof window !== 'undefined' && 'storage' in navigator) {
  navigator.storage.estimate().then(estimate => {
    if (estimate.usage && estimate.quota) {
      const pressure = estimate.usage / estimate.quota;
      if (pressure > 0.8) {
        // Aggressive eviction
        options.maxBytes = options.maxBytes * 0.5;
        evictIfNeeded('memory-pressure');
      }
    }
  });
}
```

---

## Low Priority Issues

### Issue 14: Duplicate Type Definition

**Location**: `types/lazy-boundaries.d.ts:17-22` and `app/composables/core/useLazyBoundaries.ts:10-15`

**Code**:
```typescript
// types/lazy-boundaries.d.ts
export interface LazyBoundaryController {
  state: Readonly<Record<LazyBoundaryKey, LazyBoundaryState>>;
  // ...
}

// useLazyBoundaries.ts
export interface LazyBoundaryController {
  state: Record<LazyBoundaryKey, LazyBoundaryState>;  // No Readonly
  // ...
}
```

**Why This Is Bad**:
Two different definitions of the same interface. The implementation allows mutable state while the type declaration says it's readonly. TypeScript won't catch mutations.

**Consequences**:
- Type safety violation
- Confusion about mutability guarantees
- Potential runtime mutations that should be impossible

**Fix**:
Remove the duplicate from useLazyBoundaries.ts and import from types:
```typescript
import type { LazyBoundaryController } from '~/types/lazy-boundaries';
```

---

### Issue 15: GenId Fallback is Not UUID-Compliant

**Location**: `app/composables/core/useMultiPane.ts:87-95`

**Code**:
```typescript
function genId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return 'pane-' + Math.random().toString(36).slice(2);  // Not UUID format
}
```

**Why This Is Bad**:
The fallback ID format differs from the standard path. Code expecting UUID format (e.g., validation, third-party integrations) will break on the fallback.

**Consequences**:
- Inconsistent ID formats in data
- Potential validation failures
- Debugging confusion

**Fix**:
```typescript
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Polyfill proper UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

---

### Issue 16: useScrollLock Does Not Expose isLocked Ref

**Location**: `app/composables/core/useScrollLock.ts:41-45`

**Code**:
```typescript
return {
  lock,
  unlock,
  isLocked: computed(() => isLockedRef.value),  // Computed, not ref
};
```

**Why This Is Bad**:
The return type claims to expose reactive state, but returns a computed property. While this works for reading, it doesn't allow binding with `v-model` or direct ref manipulation.

**Consequences**:
- Inconsistent with Vue ecosystem patterns
- Cannot use with v-model
- Unnecessary computed wrapper

**Fix**:
```typescript
return {
  lock,
  unlock,
  isLocked: readonly(isLockedRef),  // Expose as readonly ref
};
```

---

## Documentation Gaps Summary

### Composables Missing Documentation

| Composable | In docmap.json | Doc File Exists | JSDoc Quality |
|------------|---------------|-----------------|---------------|
| useHookEffect | Yes | Yes | Poor |
| useLazyBoundaries | Yes | Yes | Poor |
| useMultiPane | Yes | Yes | Poor |
| usePanePrompt | No | No | None |
| usePreviewCache | Yes | No | Poor |
| useResponsiveState | Yes | Yes | Poor |
| useScrollLock | Yes | Yes | Poor |
| useTokenizer | Yes | Yes | Poor |
| useWorkspaceBackup | Yes | Yes | Poor |

### Required Documentation Updates

1. **Add usePanePrompt to docmap.json** (Critical - completely missing)
2. **Create usePreviewCache.md** (High - referenced but missing)
3. **Update all JSDoc to SKILL.md standards** (High - current docs insufficient)
4. **Add examples to all composables** (Medium - only useHookEffect has an example)

---

## Action Items

### Immediate (Before Next Release)

1. **Fix Critical Issue #3**: Add localStorage cleanup for pane widths
2. **Fix High Issue #4**: Add Zod validation to defaultLoadMessagesFor
3. **Fix High Issue #5**: Fix race condition in useTokenizer worker init
4. **Add usePanePrompt to docmap.json**

### Short Term (Next Sprint)

5. **Fix Critical Issue #1**: Replace singleton with proper registry pattern
6. **Fix High Issue #6**: Add error recovery to usePreviewCache
7. **Fix High Issue #8**: Optimize Dexie query in useMultiPane
8. **Update all JSDoc to SKILL.md standard** (useHookEffect as template)

### Medium Term (Next Quarter)

9. **Fix Critical Issue #2**: Add proper listener cleanup to useResponsiveState
10. **Fix Medium Issue #12**: Add automatic pane cleanup to usePanePrompt
11. **Fix Low Issue #14**: Remove duplicate LazyBoundaryController type
12. **Create comprehensive examples** for all composables

---

## Appendix: SKILL.md Compliance Matrix

| Requirement | Status | Notes |
|-------------|--------|-------|
| Intent over mechanics | ❌ Fail | All composables narrate behavior rather than purpose |
| Structured JSDoc (Purpose/Behavior/Constraints) | ❌ Fail | Only basic summaries present |
| Public vs internal clarity | ✅ Pass | All exported symbols are intended for public use |
| Examples must be real | ⚠️ Partial | useHookEffect has example, others don't |
| No marketing language | ✅ Pass | Clean, technical language throughout |
| Hook naming convention | N/A | Core composables, not hooks |
| Composable lifecycle docs | ⚠️ Partial | Some mention cleanup, not consistently |
| SSR/client boundaries | ✅ Pass | useResponsiveState handles this correctly |

---

**End of Review**
