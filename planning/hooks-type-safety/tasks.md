# Implementation Tasks: Fix All `any` Types in Hooks System

This document provides a step-by-step implementation plan to systematically eliminate all `any` types from the hooks system. Tasks are organized by phase, with each phase building on the previous one. Dependencies are clearly marked to ensure work proceeds in the correct order.

---

## Task Overview

- **Total Tasks**: 45
- **Estimated Duration**: 2-3 weeks
- **Priority**: HIGH (Architecture Foundation)
- **Files Affected**: 4 core files + tests

---

## Phase 1: Foundation - Core Engine Types (Week 1)

**Goal**: Fix the foundational types in `hooks.ts` to enable type safety throughout the system.

**Requirements**: 1.1, 1.2, 1.3, 5.1, 5.2

### 1. Replace Generic Function Type

- [ ] 1.1 Replace `AnyFn` type with generic `HookCallback<TArgs, TReturn>`
  - Location: `app/core/hooks/hooks.ts:11`
  - Replace: `type AnyFn = (...args: any[]) => any;`
  - With: Generic version using `unknown` constraints
  - Requirements: 1.1

### 2. Update Internal Types

- [ ] 1.2 Make `CallbackEntry` interface generic
  - Location: `app/core/hooks/hooks.ts:22`
  - Add type parameters: `<TArgs extends unknown[], TReturn>`
  - Update `fn` field to use `HookCallback<TArgs, TReturn>`
  - Requirements: 1.1

- [ ] 1.3 Update callback storage maps to use generic entries
  - Location: `app/core/hooks/hooks.ts:102-113`
  - Keep `Map<string, CallbackEntry[]>` but entry types become generic
  - Note: Storage remains flexible, generics constrain at call sites
  - Requirements: 1.1

### 3. Fix Internal Pipeline Functions

- [ ] 1.4 Update `callAsync` function signature
  - Location: `app/core/hooks/hooks.ts:239-289`
  - Add generic type parameter: `<TValue = unknown>`
  - Change `args: any[]` to `args: unknown[]`
  - Change `initialValue?: any` to `initialValue?: TValue`
  - Change return type to `Promise<TValue | void>`
  - Requirements: 1.2

- [ ] 1.5 Update `callAsync` implementation
  - Location: `app/core/hooks/hooks.ts:239-289`
  - Update `value` variable type to `TValue | unknown`
  - Keep try-catch error handling unchanged
  - Ensure timing and diagnostics remain unchanged
  - Requirements: 1.2

- [ ] 1.6 Update `callSync` function signature
  - Location: `app/core/hooks/hooks.ts:291-340`
  - Add generic type parameter: `<TValue = unknown>`
  - Change `args: any[]` to `args: unknown[]`
  - Change `initialValue?: any` to `initialValue?: TValue`
  - Change return type to `TValue | void`
  - Requirements: 1.2

- [ ] 1.7 Update `callSync` implementation
  - Location: `app/core/hooks/hooks.ts:291-340`
  - Update `value` variable type to `TValue | unknown`
  - Keep try-catch error handling unchanged
  - Ensure timing and diagnostics remain unchanged
  - Requirements: 1.2

### 4. Update Engine Interface - Filters

- [ ] 1.8 Update `addFilter` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:48-53`
  - Add generic parameters: `<TArgs extends unknown[] = unknown[], TReturn = unknown>`
  - Change `fn: F` to `fn: HookCallback<TArgs, TReturn>`
  - Keep `acceptedArgs` parameter for backward compatibility
  - Requirements: 1.2

- [ ] 1.9 Update `removeFilter` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:54-58`
  - Add generic parameters: `<TArgs extends unknown[] = unknown[], TReturn = unknown>`
  - Change `fn: F` to `fn: HookCallback<TArgs, TReturn>`
  - Requirements: 1.2

- [ ] 1.10 Update `applyFilters` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:59`
  - Change `...args: any[]` to `...args: unknown[]`
  - Keep generic `<T>` for value type
  - Requirements: 1.2

- [ ] 1.11 Update `applyFiltersSync` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:60`
  - Change `...args: any[]` to `...args: unknown[]`
  - Keep generic `<T>` for value type
  - Requirements: 1.2

### 5. Update Engine Interface - Actions

- [ ] 1.12 Update `addAction` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:63-68`
  - Add generic parameters: `<TArgs extends unknown[] = unknown[]>`
  - Change `fn: F` to `fn: HookCallback<TArgs, void>`
  - Keep `acceptedArgs` parameter for backward compatibility
  - Requirements: 1.3

- [ ] 1.13 Update `removeAction` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:69-73`
  - Add generic parameters: `<TArgs extends unknown[] = unknown[]>`
  - Change `fn: F` to `fn: HookCallback<TArgs, void>`
  - Requirements: 1.3

- [ ] 1.14 Update `doAction` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:74`
  - Change `...args: any[]` to `...args: unknown[]`
  - Requirements: 1.3

- [ ] 1.15 Update `doActionSync` signature in `HookEngine` interface
  - Location: `app/core/hooks/hooks.ts:75`
  - Change `...args: any[]` to `...args: unknown[]`
  - Requirements: 1.3

### 6. Update Helper Functions

- [ ] 1.16 Update `onceAction` wrapper function
  - Location: `app/core/hooks/hooks.ts:418-428`
  - Change `fn: AnyFn` to accept generic callback
  - Change `wrapper = (...args: any[])` to `(...args: unknown[])`
  - Requirements: 1.3

- [ ] 1.17 Update `on` method signature
  - Location: `app/core/hooks/hooks.ts:429-438`
  - Change `fn: AnyFn` to accept generic callback
  - Keep implementation using `kind` detection
  - Requirements: 1.3

- [ ] 1.18 Update `has` helper functions
  - Location: `app/core/hooks/hooks.ts:180-208`
  - Change `fn?: AnyFn` to `fn?: (...args: unknown[]) => unknown`
  - Keep return type as `boolean | number`
  - Requirements: 1.1

### 7. Fix Global Type Declaration

- [ ] 1.19 Add global type augmentation for `__NUXT_HOOKS__`
  - Location: Before `app/core/hooks/hooks.ts:464`
  - Add: `declare global { var __NUXT_HOOKS__: HookEngine | undefined; }`
  - Requirements: 5.1

- [ ] 1.20 Remove global `as any` cast
  - Location: `app/core/hooks/hooks.ts:464`
  - Replace: `const g = globalThis as any;`
  - With: `const g = globalThis;`
  - Requirements: 5.1

### 8. Update Type Export

- [ ] 1.21 Update exported type alias
  - Location: `app/core/hooks/hooks.ts:473`
  - Replace: `export type { AnyFn as HookFn };`
  - With: `export type { HookCallback as HookFn };`
  - Requirements: 1.1

### 9. Phase 1 Testing

- [ ] 1.22 Run existing tests to verify no runtime breakage
  - Command: `npm test app/core/hooks`
  - Verify: All tests pass
  - Requirements: 6.2

- [ ] 1.23 Run TypeScript type check
  - Command: `npx tsc --noEmit`
  - Verify: No new type errors introduced
  - Requirements: 5.2

- [ ] 1.24 Commit Phase 1 changes
  - Message: `refactor(hooks): replace any with generic types in core engine`
  - Requirements: 5.1

---

## Phase 2: Type Definitions (Week 1-2)

**Goal**: Fix all type definitions in `hook-types.ts` to provide proper type inference.

**Requirements**: 2.1, 2.2, 2.3, 5.3

### 10. Make Event Interfaces Generic

- [ ] 2.1 Update `HookEvent` interface (if exists at line 230)
  - Location: `app/core/hooks/hook-types.ts` (check for existence)
  - Add generic parameter: `<TValue = unknown>`
  - Replace `value: any` with `value: TValue`
  - Requirements: 2.1

- [ ] 2.2 Update `ActionPayload` interface (if exists at line 242)
  - Location: `app/core/hooks/hook-types.ts` (check for existence)
  - Add generic parameter: `<TData = unknown>`
  - Replace `data: any` with `data: TData`
  - Requirements: 2.1

- [ ] 2.3 Update `FilterPayload` interface (if exists at line 291)
  - Location: `app/core/hooks/hook-types.ts` (check for existence)
  - Add generic parameter: `<TData = unknown>`
  - Replace `data: any` with `data: TData`
  - Requirements: 2.1

### 11. Import Specific Types

- [ ] 2.4 Add import for ChatMessage type
  - Location: Top of `app/core/hooks/hook-types.ts`
  - Add: `import type { ChatMessage, ToolCall } from '~/utils/chat/types';`
  - Requirements: 2.2, 4.1

### 12. Fix Specific Hook Payloads

- [ ] 2.5 Fix chat messages filter hook payload
  - Location: `app/core/hooks/hook-types.ts:488`
  - Replace: `'ai.chat.messages:filter:input': [any[]];`
  - With: `'ai.chat.messages:filter:input': [ChatMessage[]];`
  - Requirements: 2.2, 4.1

### 13. Fix Conditional Type Fallbacks

- [ ] 2.6 Fix query payload fallbacks
  - Location: `app/core/hooks/hook-types.ts:540, 545-546, 559`
  - Replace: `[{ query?: any }]` with `[{ query?: string }]` or `[never]`
  - Replace: `[any]` with `[never]` for impossible cases
  - Requirements: 2.2

- [ ] 2.7 Fix array fallbacks
  - Location: `app/core/hooks/hook-types.ts:593`
  - Replace: `: any[]` with `: never[]` or specific type
  - Requirements: 2.2

- [ ] 2.8 Fix scalar fallbacks
  - Location: `app/core/hooks/hook-types.ts:601, 623, 650`
  - Replace: `: any` with `: never` for impossible cases
  - Replace: `: any` with `: unknown` for truly dynamic cases
  - Requirements: 2.2

### 14. Fix Type Utilities

- [ ] 2.9 Fix `Tail` type utility
  - Location: `app/core/hooks/hook-types.ts:653`
  - Replace: `export type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : [];`
  - With: `export type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];`
  - Requirements: 2.3

- [ ] 2.10 Fix function type check
  - Location: `app/core/hooks/hook-types.ts:694`
  - Replace: `: T extends (...args: any[]) => any`
  - With: `: T extends (...args: unknown[]) => unknown`
  - Requirements: 2.3

### 15. Update DbActionPayloadFor Type

- [ ] 2.11 Fix DbActionPayloadFor conditional type fallbacks
  - Location: `app/core/hooks/hook-types.ts` (around lines mentioned)
  - Replace all `[any]` fallbacks with appropriate types:
    - Use `[never]` for unhandled operations
    - Use specific entity types for known operations
    - Use `[unknown]` only for truly dynamic data
  - Requirements: 2.2

### 16. Update DbFilterPayloadFor Type

- [ ] 2.12 Fix DbFilterPayloadFor conditional type fallbacks
  - Location: `app/core/hooks/hook-types.ts` (around lines mentioned)
  - Replace all `[any]` fallbacks with appropriate types:
    - Use `[never]` for unhandled operations
    - Use specific entity types for known operations
    - Use `[unknown]` only for truly dynamic data
  - Requirements: 2.2

### 17. Improve InferHookParams Type

- [ ] 2.13 Update InferHookParams fallback
  - Location: `app/core/hooks/hook-types.ts:591-593`
  - Replace: `? HookPayloadMap[K] : any[];`
  - With: `? HookPayloadMap[K] : never[];`
  - Requirements: 2.2

### 18. Improve InferHookReturn Type

- [ ] 2.14 Update InferHookReturn fallback
  - Location: `app/core/hooks/hook-types.ts:597-602`
  - Replace: `: any` fallback with `: never`
  - Keep `: void` for action hooks
  - Requirements: 2.2

### 19. Phase 2 Testing

- [ ] 2.15 Create type-level tests
  - File: `app/core/hooks/__tests__/types.test-d.ts` (create if not exists)
  - Test: Hook name validation
  - Test: Payload type inference
  - Test: Return type inference
  - Requirements: 6.1

- [ ] 2.16 Run type tests
  - Command: `npx vitest typecheck`
  - Verify: All type tests pass
  - Requirements: 6.1

- [ ] 2.17 Run TypeScript type check
  - Command: `npx tsc --noEmit`
  - Verify: No type errors in hooks system
  - Requirements: 5.2

- [ ] 2.18 Commit Phase 2 changes
  - Message: `refactor(hooks): replace any with proper types in type definitions`
  - Requirements: 5.1

---

## Phase 3: Remove Type Bridge Casts (Week 2)

**Goal**: Remove all type casts from `typed-hooks.ts` and `hook-keys.ts`.

**Requirements**: 3.1, 3.2, 4.1, 4.2, 5.1

### 20. Update TypedHookEngine Interface

- [ ] 3.1 Review TypedHookEngine interface in typed-hooks.ts
  - Location: `app/core/hooks/typed-hooks.ts:21-142`
  - Verify: All methods use proper generic constraints
  - Verify: No `any` types in interface
  - Requirements: 3.1

### 21. Remove Casts - Action Methods

- [ ] 3.2 Remove casts in `addAction` implementation
  - Location: `app/core/hooks/typed-hooks.ts:152`
  - Remove: `name as any, callback as any`
  - Verify types align naturally
  - Requirements: 3.1, 3.2

- [ ] 3.3 Remove casts in `removeAction` implementation
  - Location: `app/core/hooks/typed-hooks.ts:154`
  - Remove: `name as any, callback as any`
  - Verify types align naturally
  - Requirements: 3.1, 3.2

- [ ] 3.4 Remove casts in `doAction` implementation
  - Location: `app/core/hooks/typed-hooks.ts:156`
  - Remove: `name as any, ...(args as any)`
  - Verify types align naturally
  - Requirements: 3.1, 3.2

- [ ] 3.5 Remove casts in `doActionSync` implementation
  - Location: `app/core/hooks/typed-hooks.ts:158`
  - Remove: `name as any, ...(args as any)`
  - Verify types align naturally
  - Requirements: 3.1, 3.2

### 22. Remove Casts - Filter Methods

- [ ] 3.6 Remove casts in `addFilter` implementation
  - Location: `app/core/hooks/typed-hooks.ts:162`
  - Remove: `name as any, callback as any`
  - Verify types align naturally
  - Requirements: 3.1, 3.2

- [ ] 3.7 Remove casts in `removeFilter` implementation
  - Location: `app/core/hooks/typed-hooks.ts:164`
  - Remove: `name as any, callback as any`
  - Verify types align naturally
  - Requirements: 3.1, 3.2

- [ ] 3.8 Remove casts in `applyFilters` implementation
  - Location: `app/core/hooks/typed-hooks.ts:167-171`
  - Remove: All `as any` casts in call and return
  - Verify types align naturally
  - Requirements: 3.1, 3.2

- [ ] 3.9 Remove casts in `applyFiltersSync` implementation
  - Location: `app/core/hooks/typed-hooks.ts:172-176`
  - Remove: All `as any` casts in call and return
  - Verify types align naturally
  - Requirements: 3.1, 3.2

### 23. Remove Casts - Utility Methods

- [ ] 3.10 Remove casts in `on` implementation
  - Location: `app/core/hooks/typed-hooks.ts:179-184`
  - Remove: `name as any, callback as any`
  - Keep kind detection logic
  - Requirements: 3.1, 3.2

- [ ] 3.11 Remove casts in `onceAction` implementation
  - Location: `app/core/hooks/typed-hooks.ts:187`
  - Remove: `name as any, callback as any`
  - Requirements: 3.1, 3.2

- [ ] 3.12 Remove casts in `hasAction` implementation
  - Location: `app/core/hooks/typed-hooks.ts:190`
  - Remove: `name as any, fn as any`
  - Requirements: 3.1

- [ ] 3.13 Remove casts in `hasFilter` implementation
  - Location: `app/core/hooks/typed-hooks.ts:191`
  - Remove: `name as any, fn as any`
  - Requirements: 3.1

### 24. Handle Cast Removal Failures

- [ ] 3.14 If casts can't be removed, diagnose root cause
  - Check: Are Phase 1 and 2 types correct?
  - Check: Does `HookEngine` interface match usage?
  - Check: Are generic constraints too strict?
  - Action: Fix underlying types, don't add casts
  - Requirements: 3.2

### 25. Fix hook-keys.ts

- [ ] 3.15 Update ChatMessage filter payload in HookPayloads
  - Location: `app/core/hooks/hook-keys.ts:102`
  - Replace: `'ai.chat.messages:filter:input': [any[]];`
  - With: `'ai.chat.messages:filter:input': [ChatMessage[]];`
  - Add import: `import type { ChatMessage } from '~/utils/chat/types';`
  - Requirements: 4.1

- [ ] 3.16 Remove cast in typedOn helper
  - Location: `app/core/hooks/hook-keys.ts:117`
  - Remove: `fn as any` cast
  - Verify: Types align after previous fixes
  - Requirements: 4.2

### 26. Phase 3 Testing

- [ ] 3.17 Test typed hooks with real usage
  - Create: `app/core/hooks/__tests__/typed-hooks.test.ts`
  - Test: addFilter with ChatMessage[]
  - Test: applyFilters returns correct type
  - Test: doAction with typed payloads
  - Requirements: 6.2

- [ ] 3.18 Run all hook tests
  - Command: `npm test app/core/hooks`
  - Verify: All tests pass
  - Verify: No runtime behavior changes
  - Requirements: 6.2

- [ ] 3.19 Run TypeScript type check on entire codebase
  - Command: `npx tsc --noEmit`
  - Verify: No new type errors anywhere
  - Requirements: 5.2

- [ ] 3.20 Commit Phase 3 changes
  - Message: `refactor(hooks): remove all type casts from typed bridge`
  - Requirements: 5.1

---

## Phase 4: Testing & Validation (Week 2-3)

**Goal**: Comprehensive testing and validation of type safety improvements.

**Requirements**: 6.1, 6.2, 5.2, 5.3, 5.4

### 27. Comprehensive Type Tests

- [ ] 4.1 Create type test for hook name validation
  - File: `app/core/hooks/__tests__/types.test-d.ts`
  - Test: Valid hook names compile
  - Test: Invalid hook names show errors
  - Test: Error messages suggest similar hooks
  - Requirements: 6.1, 5.3

- [ ] 4.2 Create type test for filter callbacks
  - Test: Correct callback signature compiles
  - Test: Wrong parameter types show error
  - Test: Wrong return type shows error
  - Requirements: 6.1

- [ ] 4.3 Create type test for action callbacks
  - Test: Correct callback signature compiles
  - Test: Wrong parameter types show error
  - Test: Returning non-void shows error
  - Requirements: 6.1

- [ ] 4.4 Create type test for applyFilters
  - Test: Correct value type compiles
  - Test: Wrong value type shows error
  - Test: Return type matches expected type
  - Requirements: 6.1

- [ ] 4.5 Create type test for doAction
  - Test: Correct arguments compile
  - Test: Wrong arguments show error
  - Test: Missing arguments show error
  - Requirements: 6.1

### 28. Runtime Behavior Tests

- [ ] 4.6 Test filter pipeline with typed callbacks
  - File: `app/core/hooks/__tests__/hooks.test.ts`
  - Test: Filters transform values correctly
  - Test: Multiple filters chain correctly
  - Test: Async filters work
  - Requirements: 6.2

- [ ] 4.7 Test action execution with typed callbacks
  - Test: Actions execute in priority order
  - Test: Multiple actions run correctly
  - Test: Async actions work
  - Requirements: 6.2

- [ ] 4.8 Test error handling
  - Test: Callback errors are caught
  - Test: Errors don't break pipeline
  - Test: Diagnostics record errors
  - Requirements: 6.2

- [ ] 4.9 Test wildcard patterns
  - Test: Wildcard registration works
  - Test: Wildcard matching works
  - Test: Types still enforced
  - Requirements: 6.2

### 29. Integration Tests

- [ ] 4.10 Test with real chat message hook
  - File: `app/core/hooks/__tests__/integration.test.ts`
  - Test: ChatMessage[] filter works
  - Test: Type inference provides autocomplete
  - Test: Invalid types caught at compile time
  - Requirements: 6.2

- [ ] 4.11 Test with real UI hooks
  - Test: Pane action hooks work
  - Test: Payload types are correct
  - Test: Type inference works
  - Requirements: 6.2

- [ ] 4.12 Test with real DB hooks
  - Test: DB entity hooks work
  - Test: Entity types are correct
  - Test: Filter input/output types match
  - Requirements: 6.2

### 30. Performance Validation

- [ ] 4.13 Measure TypeScript compilation time
  - Command: `time npx tsc --noEmit`
  - Verify: Completes in < 2 seconds
  - If slow: Optimize conditional types
  - Requirements: 5.2

- [ ] 4.14 Test IDE responsiveness
  - Open: `app/core/hooks/typed-hooks.ts`
  - Test: Autocomplete appears within 500ms
  - Test: Hover types show quickly
  - Test: Go to definition works
  - Requirements: 5.2

- [ ] 4.15 Test with large codebase
  - Run: Full type check on entire codebase
  - Verify: No significant slowdown
  - If issues: Profile and optimize
  - Requirements: 5.2

### 31. Error Message Quality

- [ ] 4.16 Test invalid hook name error
  - Code: `hooks.addAction('invalid.hook')`
  - Verify: Error suggests similar valid names
  - Verify: Error message is clear
  - Requirements: 5.3

- [ ] 4.17 Test callback signature mismatch error
  - Code: `hooks.addFilter('hook', (wrong: number) => wrong)`
  - Verify: Error shows expected vs actual
  - Verify: Error highlights wrong parameter
  - Requirements: 5.3

- [ ] 4.18 Test missing argument error
  - Code: `hooks.doAction('hook.name')`
  - Verify: Error lists required arguments
  - Verify: Error is actionable
  - Requirements: 5.3

### 32. Documentation

- [ ] 4.19 Update hooks README (if exists)
  - Add: TypeScript usage examples
  - Add: Type inference examples
  - Add: Common type errors and fixes
  - Requirements: 5.4

- [ ] 4.20 Create migration guide (if needed)
  - Document: Breaking changes (should be none)
  - Document: How to fix type errors
  - Document: New type patterns
  - Requirements: 5.4

- [ ] 4.21 Add JSDoc examples with types
  - File: `app/core/hooks/typed-hooks.ts`
  - Add: TypeScript examples in comments
  - Add: Common usage patterns
  - Requirements: 5.4

### 33. Final Validation

- [ ] 4.22 Run full test suite
  - Command: `npm test`
  - Verify: All tests pass
  - Verify: No regressions
  - Requirements: 6.2

- [ ] 4.23 Run TypeScript strict mode check
  - Command: `npx tsc --noEmit --strict`
  - Verify: No errors in hooks system
  - Requirements: 5.2

- [ ] 4.24 Verify no `any` types remain
  - Command: `grep -n "any" app/core/hooks/*.ts`
  - Verify: Only intentional `any` in comments/docs
  - Requirements: All

- [ ] 4.25 Verify no type casts remain
  - Command: `grep -n "as any" app/core/hooks/*.ts`
  - Verify: Zero occurrences
  - Requirements: 3.1

---

## Phase 5: Finalization (Week 3)

**Goal**: Final checks, documentation, and deployment preparation.

**Requirements**: All

### 34. Code Review Preparation

- [ ] 5.1 Clean up temporary code/comments
  - Remove: Debug logs
  - Remove: TODO comments
  - Remove: Commented-out code
  - Requirements: 5.1

- [ ] 5.2 Ensure consistent formatting
  - Command: `npm run format`
  - Verify: All files formatted
  - Requirements: 5.1

- [ ] 5.3 Run linter
  - Command: `npm run lint`
  - Fix: Any linting errors
  - Requirements: 5.1

### 35. Generate Type Coverage Report

- [ ] 5.4 Check type coverage
  - Tool: `type-coverage` or manual audit
  - Target: 100% for hooks system files
  - Requirements: All

### 36. Create Pull Request

- [ ] 5.5 Write comprehensive PR description
  - Include: Changes summary
  - Include: Before/after examples
  - Include: Testing performed
  - Include: Breaking changes (should be none)
  - Requirements: 5.4

- [ ] 5.6 Add PR labels
  - Add: `refactor`
  - Add: `type-safety`
  - Add: `hooks`
  - Requirements: 5.4

### 37. Stakeholder Communication

- [ ] 5.7 Notify team of changes
  - Explain: What changed
  - Explain: Why it matters
  - Explain: How to use new types
  - Requirements: 5.4

- [ ] 5.8 Update plugin documentation
  - Update: Hook type examples
  - Update: How to create typed plugins
  - Requirements: 5.4

---

## Verification Checklist

After completing all tasks, verify:

- [ ] ✅ Zero `any` types in all 4 hook files (except comments)
- [ ] ✅ Zero `as any` casts in `typed-hooks.ts`
- [ ] ✅ All 56+ previous `any` usages are replaced
- [ ] ✅ All tests pass (runtime behavior unchanged)
- [ ] ✅ Type checking completes in < 2 seconds
- [ ] ✅ IDE autocomplete works for all hooks
- [ ] ✅ Type errors show clear messages
- [ ] ✅ Documentation is updated
- [ ] ✅ No breaking changes for consumers
- [ ] ✅ Team is notified and trained

---

## Rollback Procedure

If critical issues arise:

1. **Identify Problem Phase**: Which phase introduced the issue?
2. **Revert Specific Commits**: Revert only problematic phase commits
3. **Diagnose Root Cause**: Why did types not align?
4. **Fix and Retry**: Fix underlying issue and retry phase
5. **Emergency Rollback**: If urgent, revert all phases and investigate offline

---

## Success Criteria

Project is complete when:

1. ✅ All 45 tasks are checked off
2. ✅ All requirements are met
3. ✅ All tests pass
4. ✅ Type coverage is 100% for hooks system
5. ✅ Code review is approved
6. ✅ Documentation is updated
7. ✅ Team is trained and ready

---

## Task Dependencies

```
Phase 1 (Foundation)
  ├─> Task 1.1-1.21: Core engine types
  └─> Task 1.22-1.24: Phase 1 testing
        │
        ├─> Phase 2 (Type Definitions)
        │     ├─> Task 2.1-2.14: Fix type definitions
        │     └─> Task 2.15-2.18: Phase 2 testing
        │           │
        │           └─> Phase 3 (Remove Casts)
        │                 ├─> Task 3.1-3.16: Remove all casts
        │                 └─> Task 3.17-3.20: Phase 3 testing
        │                       │
        │                       └─> Phase 4 (Validation)
        │                             ├─> Task 4.1-4.18: Comprehensive tests
        │                             └─> Task 4.19-4.25: Documentation & final validation
        │                                   │
        │                                   └─> Phase 5 (Finalization)
        │                                         └─> Task 5.1-5.8: PR and deployment
```

---

## Time Estimates

- **Phase 1**: 2-3 days (foundation is critical, take time to get it right)
- **Phase 2**: 2-3 days (many conditional types to update carefully)
- **Phase 3**: 1-2 days (should be straightforward if Phase 1-2 are correct)
- **Phase 4**: 3-4 days (comprehensive testing takes time)
- **Phase 5**: 1 day (finalization and documentation)

**Total**: 9-13 days (approximately 2-3 weeks)

---

## Notes

- **Don't Skip Testing**: Each phase must be tested before moving to the next
- **Commit Often**: Commit after each phase for easy rollback
- **Ask for Help**: If types don't align, don't force casts - ask for review
- **Document Decisions**: If you deviate from plan, document why
- **Keep It Simple**: The best solution is the simplest that works

---

## References

- Requirements: `planning/hooks-type-safety/requirements.md`
- Design: `planning/hooks-type-safety/design.md`
- Planning Doc: `planning/type-safety-review/03-HIGH-core-hooks-system.md`
