# HIGH: Core Hooks System Type Safety Review

**Severity: HIGH (Architecture Foundation)**

**Total occurrences: 50+ across hooks system**

## Executive Summary

The hooks system is a foundational plugin architecture that currently has extensive `any` usage. This is **HIGH severity** because:

1. **Type erasure by design**: The system intentionally erases types to enable dynamic plugins
2. **Framework-wide impact**: All plugins and extensions rely on this system
3. **Type safety possible**: Can use generics and conditional types instead of `any`
4. **Breaking changes hidden**: Plugin API changes won't be caught at compile time

---

## Architectural Context

The hooks system provides WordPress-style filters and actions:
- **Filters**: Transform values through a pipeline
- **Actions**: Execute side effects in sequence
- **Type-safe wrapper**: `typed-hooks.ts` attempts to add types but falls back to `any`

**Current approach**: Use `any` for flexibility
**Better approach**: Use generics and mapped types to preserve type safety while keeping flexibility

---

## Findings by File

### BLOCKER: hooks.ts - Core Engine

**File:** `app/core/hooks/hooks.ts`

**Lines:** 11, 59-60, 74-75, 242, 244, 294, 296, 419, 464

#### Issue 1: Function Signature Erasure

```typescript
// Line 11
type AnyFn = (...args: any[]) => any;
```

**Why:**
- All callbacks lose parameter and return type information
- Can't verify callback matches hook signature
- Runtime errors when callback receives unexpected args

**Fix:**
```typescript
// Use generic type parameter instead
type HookCallback<TArgs extends unknown[] = unknown[], TReturn = void> = 
    (...args: TArgs) => TReturn;

// Or leverage existing hook type map
type HookCallbackFor<K extends keyof HookPayloadMap> = 
    (payload: HookPayloadFor<K>, ...args: TailArgs<K>) => 
        K extends FilterHook ? HookPayloadFor<K> : void;
```

**Tests:**
```typescript
describe('hook callback types', () => {
    it('should enforce correct callback signature for filters', () => {
        const hooks = createHooks();
        
        // This should compile
        hooks.addFilter('text:transform', (text: string) => text.toUpperCase());
        
        // This should NOT compile (if properly typed)
        // hooks.addFilter('text:transform', (num: number) => num);
    });
});
```

---

#### Issue 2: Filter Application Without Types

```typescript
// Line 59-60
applyFilters: <T>(name: string, value: T, ...args: any[]) => Promise<T>;
applyFiltersSync: <T>(name: string, value: T, ...args: any[]) => T;
```

**Why:**
- Generic `T` not connected to hook name
- `args` array completely untyped
- Return type assumes no filter changes the type (may not be true)

**Fix:**
```typescript
interface FilterHooks<M extends HookPayloadMap> {
    applyFilters<K extends keyof M & FilterHook>(
        name: K,
        value: HookPayloadFor<K>,
        ...args: TailArgs<K>
    ): Promise<HookPayloadFor<K>>;
    
    applyFiltersSync<K extends keyof M & FilterHook>(
        name: K,
        value: HookPayloadFor<K>,
        ...args: TailArgs<K>
    ): HookPayloadFor<K>;
}
```

---

#### Issue 3: Action Execution Without Types

```typescript
// Line 74-75
doAction: (name: string, ...args: any[]) => Promise<void>;
doActionSync: (name: string, ...args: any[]) => void;
```

**Why:**
- Action name not validated
- Arguments not checked against action signature
- Can pass wrong number or type of args

**Fix:**
```typescript
interface ActionHooks<M extends HookPayloadMap> {
    doAction<K extends keyof M & ActionHook>(
        name: K,
        ...args: M[K]
    ): Promise<void>;
    
    doActionSync<K extends keyof M & ActionHook>(
        name: K,
        ...args: M[K]
    ): void;
}
```

---

#### Issue 4: Internal Filter/Action Processing

```typescript
// Line 242, 244, 294, 296
async function runFilterPipeline(
    callbacks: CallbackEntry[],
    name: string,
    args: any[],
    priority: number,
    initialValue?: any
): Promise<any> {
    // ...
}

function runFilterPipelineSync(
    callbacks: CallbackEntry[],
    name: string,
    args: any[],
    priority: number,
    initialValue?: any
): any {
    // ...
}
```

**Why:**
- Internal function mirrors external API weakness
- `args` array and return value untyped
- Can't verify pipeline consistency

**Fix:**
```typescript
type FilterPipeline<T> = (
    callbacks: CallbackEntry[],
    name: string,
    value: T,
    args: unknown[]
) => Promise<T>;

async function runFilterPipeline<T>(
    callbacks: CallbackEntry[],
    name: string,
    args: unknown[],
    priority: number,
    initialValue: T
): Promise<T> {
    let result = initialValue;
    
    for (const { callback, priority: cbPriority } of callbacks) {
        if (cbPriority <= priority) {
            // Runtime validation if needed
            result = await callback(result, ...args);
        }
    }
    
    return result;
}
```

---

#### Issue 5: Callback Wrapper

```typescript
// Line 419
const wrapper = (...args: any[]) => {
    // ...
};
```

**Why:**
- Wrapper function loses argument types
- Used in priority-based execution
- No way to verify wrapped callback matches hook

**Fix:**
```typescript
function createCallbackWrapper<TArgs extends unknown[]>(
    callback: (...args: TArgs) => unknown,
    priority: number
): (...args: TArgs) => unknown {
    return (...args: TArgs) => {
        // Wrapper logic with types preserved
        return callback(...args);
    };
}
```

---

#### Issue 6: Global Hooks Access

```typescript
// Line 464
const g = globalThis as any;
```

**Why:**
- Bypasses type checking for global object
- Pattern repeated throughout codebase

**Fix:**
```typescript
declare global {
    var __or3Hooks: HooksEngine | undefined;
}

const g = globalThis;
if (!g.__or3Hooks) {
    g.__or3Hooks = createHooks();
}
```

---

### HIGH: hook-types.ts - Type Definitions

**File:** `app/core/hooks/hook-types.ts`

**Lines:** 230, 242, 291, 488, 540, 545-546, 559, 562, 571-572, 593, 601, 623, 650, 653, 694

#### Issue 1: Generic Event Data

```typescript
// Line 230, 242, 291
interface HookEvent {
    value: any;
}

interface ActionPayload {
    data: any;
}

interface FilterPayload {
    data: any;
}
```

**Why:**
- Core event types use `any` for payload
- Every hook using these types loses safety
- Should use generics or union types

**Fix:**
```typescript
interface HookEvent<T = unknown> {
    value: T;
    metadata?: {
        timestamp: number;
        source?: string;
    };
}

interface ActionPayload<T = unknown> {
    data: T;
}

interface FilterPayload<T = unknown> {
    data: T;
    original?: T; // For comparison
}
```

---

#### Issue 2: Hook Payload Fallbacks

```typescript
// Line 488
'ai.chat.messages:filter:input': [any[]];

// Line 540, 545-546
? [{ query?: any }]
: [any]
: [any];

// Line 593
: any[];

// Line 601, 623, 650
: any
```

**Why:**
- Conditional types fall back to `any` when hook not defined
- Should use `unknown` or `never` for undefined hooks
- `any` spreads through type system

**Fix:**
```typescript
// For messages filter
'ai.chat.messages:filter:input': [ChatMessage[]];

// For query objects
type QueryParam<T> = T extends DatabaseTable 
    ? [{ query?: QueryFor<T> }]
    : [never]; // Or a specific type, not any

// Default fallback
type HookPayloadFor<K extends string> = 
    K extends keyof HookPayloadMap 
        ? HookPayloadMap[K][0]
        : never; // Use never, not any
```

---

#### Issue 3: Tail Type Utility

```typescript
// Line 653
export type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : [];
```

**Why:**
- Uses `any` in type constraint
- Works but should use `unknown`

**Fix:**
```typescript
export type Tail<T extends unknown[]> = 
    T extends [unknown, ...infer Rest] ? Rest : [];
```

---

#### Issue 4: Function Type Check

```typescript
// Line 694
: T extends (...args: any[]) => any
```

**Why:**
- Function signature check uses `any`
- Should use `unknown` for parameters

**Fix:**
```typescript
type IsFunction<T> = T extends (...args: unknown[]) => unknown
    ? true
    : false;
```

---

### HIGH: typed-hooks.ts - Type Bridge

**File:** `app/core/hooks/typed-hooks.ts`

**Lines:** 15, 152, 154, 156, 158, 162, 164, 167-176, 183, 187, 190-191

#### Issue: Mass Type Casting

```typescript
// Line 152-176 (pattern repeated)
engine.addAction(name as any, callback as any, priority),
engine.removeAction(name as any, callback as any, priority),
engine.doAction(name as any, ...(args as any)),
engine.doActionSync(name as any, ...(args as any)),
engine.addFilter(name as any, callback as any, priority),
engine.removeFilter(name as any, callback as any, priority),
(
    engine.applyFilters(
        name as any,
        value as any,
        ...(args as any)
    ) as any
),
```

**Why:**
- **This is the type safety bridge that fails**
- Every operation casts types away to call untyped engine
- Defeats purpose of having typed wrapper
- Suggests underlying engine needs better typing

**Fix:**

The real solution is to fix the underlying engine types, then remove these casts:

```typescript
// After fixing hooks.ts types, typed-hooks.ts should become:

export function createTypedHooks<M extends HookPayloadMap>(
    engine: HooksEngine<M>
) {
    return {
        addAction<K extends keyof M & ActionHook>(
            name: K,
            callback: ActionCallback<M[K]>,
            priority?: number
        ) {
            // No cast needed if engine is properly typed
            return engine.addAction(name, callback, priority);
        },
        
        doAction<K extends keyof M & ActionHook>(
            name: K,
            ...args: M[K]
        ) {
            // No cast needed
            return engine.doAction(name, ...args);
        },
        
        addFilter<K extends keyof M & FilterHook>(
            name: K,
            callback: FilterCallback<M[K]>,
            priority?: number
        ) {
            // No cast needed
            return engine.addFilter(name, callback, priority);
        },
        
        applyFilters<K extends keyof M & FilterHook>(
            name: K,
            value: HookPayloadFor<K>,
            ...args: TailArgs<K>
        ) {
            // No cast needed
            return engine.applyFilters(name, value, ...args);
        },
        
        // ... etc
    };
}
```

**Tests:**
```typescript
describe('typed hooks bridge', () => {
    it('should enforce hook name type', () => {
        const hooks = createTypedHooks(engine);
        
        // Should compile
        hooks.addAction('app:ready', () => {});
        
        // Should NOT compile
        // hooks.addAction('invalid:hook', () => {});
    });
    
    it('should enforce callback signature', () => {
        const hooks = createTypedHooks(engine);
        
        // Should compile
        hooks.addFilter('text:transform', (text: string) => text.toUpperCase());
        
        // Should NOT compile (wrong params)
        // hooks.addFilter('text:transform', (num: number) => num.toString());
    });
});
```

---

### MEDIUM: hook-keys.ts - Hook Definitions

**File:** `app/core/hooks/hook-keys.ts`

**Lines:** 102, 117

```typescript
// Line 102
'ai.chat.messages:filter:input': [any[]];

// Line 117
return hooks.on(key, fn as any, opts);
```

**Why:**
- Message filter hook uses `any[]` instead of `ChatMessage[]`
- Type cast in `on` method defeats type checking

**Fix:**
```typescript
import type { ChatMessage } from '~/utils/chat/types';

// In HookPayloadMap
'ai.chat.messages:filter:input': [ChatMessage[]];

// Remove cast
export function on<K extends keyof HookPayloadMap>(
    key: K,
    fn: HookCallbackFor<K>,
    opts?: HookOptions
) {
    return hooks.on(key, fn, opts); // No cast
}
```

---

## Summary Statistics

| File | Any Count | Primary Issue |
|------|-----------|---------------|
| hooks.ts | 15+ | Core engine untyped |
| hook-types.ts | 20+ | Fallbacks to any |
| typed-hooks.ts | 19+ | Mass type casting |
| hook-keys.ts | 2 | Incorrect hook types |

**Total:** 56+ type holes in hooks system

---

## Recommended Action Plan

### Phase 1: Type System Redesign (Week 1)

1. **Define Generic Hook Engine**:
   ```typescript
   // types/hooks.d.ts
   interface HooksEngine<M extends HookPayloadMap> {
       addAction<K extends ActionHookKey<M>>(...): void;
       addFilter<K extends FilterHookKey<M>>(...): void;
       // ... fully typed API
   }
   ```

2. **Fix Core Types**:
   - Replace `AnyFn` with generic `HookCallback<TArgs, TReturn>`
   - Replace `any[]` args with proper parameter types
   - Replace `any` returns with proper return types

### Phase 2: Fix Implementations (Week 2)

1. **hooks.ts**:
   - Make `runFilterPipeline` generic
   - Type callback wrappers properly
   - Remove global `any` cast

2. **hook-types.ts**:
   - Replace all `any` fallbacks with `never` or `unknown`
   - Define specific types for common hooks (messages, queries, etc.)
   - Make event/payload interfaces generic

### Phase 3: Remove Type Bridge Casts (Week 3)

1. **typed-hooks.ts**:
   - Remove all `as any` casts
   - If casts are still needed, engine types are wrong - go back to Phase 1

2. **hook-keys.ts**:
   - Type all hook definitions precisely
   - Remove function casts

### Phase 4: Add Runtime Validation (Week 4)

1. Create Zod schemas for critical hooks
2. Add opt-in runtime validation for development
3. Generate types from schemas to ensure sync

---

## Impact if Not Fixed

### Type Safety Impact
- **No compile-time checks**: Hook callbacks can have wrong signatures
- **Plugin breaks**: Plugin authors have no guidance on API contracts
- **Refactoring risk**: Renaming hooks or changing signatures breaks silently

### Performance Impact
- **No optimization**: TypeScript can't optimize untyped code paths
- **Runtime checks needed**: Must validate at runtime what types should catch

### Maintenance Impact
- **Documentation burden**: Must maintain separate docs for hook signatures
- **Testing burden**: Need integration tests to catch type mismatches
- **Plugin ecosystem**: Third-party plugins are fragile

---

## Technical Debt Assessment

**Current State**: Type system exists but bypassed with `any`

**Root Cause**: Original engine wasn't generic, typed wrapper bolted on later

**Solution**: Redesign engine to be generic from the start, or create new typed engine and deprecate old one

**Migration Path**:
1. Create new `createTypedHooksEngine<M>()` function
2. Implement fully typed version alongside old one
3. Migrate internal usage
4. Provide adapter for existing plugins
5. Deprecate old engine

---

## Files to Create/Modify

### New Files
1. `types/hooks-engine.d.ts` - Core engine type definitions
2. `app/core/hooks/engine-v2.ts` - New typed engine implementation
3. `app/core/hooks/__tests__/type-safety.test.ts` - Type tests
4. `app/core/hooks/validation.ts` - Optional runtime validation

### Modified Files
1. `app/core/hooks/hooks.ts` - Make generic
2. `app/core/hooks/hook-types.ts` - Remove any fallbacks
3. `app/core/hooks/typed-hooks.ts` - Remove casts
4. `app/core/hooks/hook-keys.ts` - Type hook definitions
5. `docs/hooks-api.md` - Update documentation

### Delete (if creating v2)
- Old implementations after migration complete
