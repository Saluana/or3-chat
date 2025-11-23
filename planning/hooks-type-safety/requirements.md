# Requirements: Fix All `any` Types in Hooks System

## Introduction

The hooks system is a foundational plugin architecture in the OR3 Chat application that currently has extensive use of `any` types (50+ occurrences across 4 files). This creates a significant type safety gap where:

1. **Type erasure by design**: The system intentionally erases types to enable dynamic plugins, but this can be solved with generics
2. **Framework-wide impact**: All plugins and extensions rely on this system, so type errors propagate
3. **Breaking changes hidden**: Plugin API changes won't be caught at compile time
4. **Runtime errors**: Callbacks can receive unexpected arguments leading to runtime failures

This document defines the requirements for systematically eliminating all `any` types in the hooks system files while maintaining backward compatibility and existing functionality.

## Scope

### Files to Fix
1. `app/core/hooks/hooks.ts` - 15+ `any` usages (core engine)
2. `app/core/hooks/hook-types.ts` - 20+ `any` usages (type definitions)
3. `app/core/hooks/typed-hooks.ts` - 19+ `any` usages (type bridge with mass casting)
4. `app/core/hooks/hook-keys.ts` - 2 `any` usages (hook definitions)

### Out of Scope
- Changes to hook consumers/users (unless required for type compatibility)
- New feature additions beyond type safety improvements
- Performance optimizations (unless directly related to type inference)

---

## Requirements

### 1. Core Type System Requirements

#### 1.1 Generic Function Types
**User Story**: As a developer, I want hook callbacks to preserve their type signatures, so that I can catch type errors at compile time instead of runtime.

**Acceptance Criteria**:
- WHEN I define a hook callback THEN the parameter types SHALL be inferred from the hook name
- WHEN I register a callback with wrong signature THEN TypeScript SHALL show a compile error
- WHEN I use generics instead of `any` THEN the type information SHALL flow through the entire system
- IF the hook name is not recognized THEN TypeScript SHALL suggest similar valid hook names

**Priority**: CRITICAL
**Files**: `hooks.ts` (line 11)

---

#### 1.2 Filter Application Type Safety
**User Story**: As a developer applying filters, I want the value type and additional arguments to be type-checked, so that I don't pass incorrect data to filter callbacks.

**Acceptance Criteria**:
- WHEN I call `applyFilters` with a hook name THEN the value parameter type SHALL match the hook's payload type
- WHEN I pass additional arguments THEN they SHALL match the hook's expected argument types
- WHEN a filter returns a value THEN it SHALL match the expected return type for that hook
- IF I use the wrong value type THEN TypeScript SHALL show a compile error at the call site

**Priority**: CRITICAL
**Files**: `hooks.ts` (lines 59-60, 242, 244, 294, 296)

---

#### 1.3 Action Execution Type Safety
**User Story**: As a developer executing actions, I want the action arguments to be type-checked against the action signature, so that I don't trigger actions with invalid data.

**Acceptance Criteria**:
- WHEN I call `doAction` with a hook name THEN all arguments SHALL be type-checked against the hook signature
- WHEN I register an action callback THEN its parameters SHALL match the action's payload types
- WHEN the action completes THEN it SHALL return `void` or `Promise<void>`
- IF I pass wrong arguments THEN TypeScript SHALL show a compile error

**Priority**: CRITICAL  
**Files**: `hooks.ts` (lines 74-75, 294, 296)

---

### 2. Hook Type Definition Requirements

#### 2.1 Event Payload Generics
**User Story**: As a developer defining hook payloads, I want to use generic types instead of `any`, so that type information is preserved through the event system.

**Acceptance Criteria**:
- WHEN I define an event interface THEN it SHALL use generic type parameters instead of `any`
- WHEN an event payload is used THEN the generic type SHALL be specified or inferred
- WHEN no type is provided THEN it SHALL default to `unknown` instead of `any`
- IF the payload structure changes THEN TypeScript SHALL catch all affected usage sites

**Priority**: HIGH
**Files**: `hook-types.ts` (lines 230, 242, 291)

---

#### 2.2 Fallback Type Improvements
**User Story**: As a developer using conditional types, I want fallbacks to use `unknown` or `never` instead of `any`, so that I'm forced to handle edge cases explicitly.

**Acceptance Criteria**:
- WHEN a hook name is not in the payload map THEN the type SHALL fall back to `never` instead of `any`
- WHEN a conditional type can't determine the payload THEN it SHALL use `unknown` instead of `any`
- WHEN I try to use an undefined hook THEN TypeScript SHALL show an error
- IF a hook is added to the system THEN its types SHALL be automatically inferred

**Priority**: HIGH
**Files**: `hook-types.ts` (lines 488, 540, 545-546, 559, 562, 571-572, 593, 601, 623, 650)

---

#### 2.3 Type Utility Constraints
**User Story**: As a developer using type utilities, I want constraints to use `unknown` instead of `any`, so that the utilities remain type-safe.

**Acceptance Criteria**:
- WHEN I use the `Tail` type utility THEN it SHALL constrain with `unknown[]` instead of `any[]`
- WHEN I use function type checks THEN they SHALL use `unknown` for parameters instead of `any`
- WHEN type inference occurs THEN it SHALL preserve as much type information as possible
- IF the constraint is too loose THEN TypeScript SHALL emit a warning

**Priority**: MEDIUM
**Files**: `hook-types.ts` (lines 653, 694)

---

### 3. Typed Hook Bridge Requirements

#### 3.1 Remove Type Casting
**User Story**: As a developer using the typed hooks wrapper, I want it to provide actual type safety without casting, so that type errors are caught at compile time.

**Acceptance Criteria**:
- WHEN I use `addAction` THEN no type casting SHALL occur in the implementation
- WHEN I use `addFilter` THEN no type casting SHALL occur in the implementation
- WHEN I use `applyFilters` THEN no type casting SHALL occur in the implementation
- WHEN I use `doAction` THEN no type casting SHALL occur in the implementation
- IF the underlying engine types are correct THEN no casts SHALL be necessary

**Priority**: CRITICAL
**Files**: `typed-hooks.ts` (lines 152-176)

---

#### 3.2 Type Bridge Validation
**User Story**: As a developer, I want the typed hooks bridge to validate that the underlying engine supports the typed operations, so that type safety is guaranteed end-to-end.

**Acceptance Criteria**:
- WHEN the typed wrapper calls the engine THEN types SHALL align without casting
- WHEN a hook is registered THEN the callback signature SHALL be verified
- WHEN a hook is executed THEN arguments SHALL be type-checked
- IF types don't align THEN the implementation SHALL fail to compile, not cast types away

**Priority**: CRITICAL
**Files**: `typed-hooks.ts` (all casting lines)

---

### 4. Hook Definition Requirements

#### 4.1 Specific Hook Payloads
**User Story**: As a developer using the chat message filter hook, I want it to use the correct `ChatMessage[]` type instead of `any[]`, so that I can safely access message properties.

**Acceptance Criteria**:
- WHEN I use `ai.chat.messages:filter:input` hook THEN the payload type SHALL be `ChatMessage[]`
- WHEN I import `ChatMessage` type THEN it SHALL be from `~/utils/chat/types`
- WHEN I access message properties THEN TypeScript SHALL provide autocomplete
- IF the message structure changes THEN all hook usages SHALL show compile errors

**Priority**: HIGH
**Files**: `hook-keys.ts` (line 102)

---

#### 4.2 Remove Unnecessary Casts
**User Story**: As a developer registering hooks, I want the `on` method to accept typed callbacks without casting, so that type checking works correctly.

**Acceptance Criteria**:
- WHEN I call the `on` method THEN no `as any` cast SHALL be required
- WHEN I pass a callback THEN its type SHALL be inferred from the hook name
- WHEN types are correct THEN the function SHALL compile without casts
- IF types don't match THEN TypeScript SHALL show an error at the call site

**Priority**: HIGH
**Files**: `hook-keys.ts` (line 117)

---

### 5. Non-Functional Requirements

#### 5.1 Backward Compatibility
**User Story**: As a developer with existing hook usage, I want the type fixes to be backward compatible, so that my code continues to work without changes.

**Acceptance Criteria**:
- WHEN type fixes are applied THEN existing valid hook usage SHALL continue to compile
- WHEN runtime behavior occurs THEN it SHALL remain unchanged
- WHEN hooks are registered or executed THEN the same code paths SHALL be used
- IF code was using incorrect types THEN it SHALL fail to compile (by design)

**Priority**: CRITICAL

---

#### 5.2 Type Inference Performance
**User Story**: As a developer, I want type checking to remain fast, so that my IDE stays responsive.

**Acceptance Criteria**:
- WHEN TypeScript checks the hooks system THEN type inference SHALL complete in < 2 seconds
- WHEN I use hooks in my code THEN autocomplete SHALL appear within 500ms
- WHEN complex conditional types are used THEN they SHALL be optimized for performance
- IF type checking is slow THEN the types SHALL be simplified or cached

**Priority**: MEDIUM

---

#### 5.3 Error Message Quality
**User Story**: As a developer who makes a type error, I want clear error messages, so that I can quickly understand and fix the problem.

**Acceptance Criteria**:
- WHEN I use an invalid hook name THEN TypeScript SHALL suggest similar valid names
- WHEN I pass wrong types THEN the error SHALL show expected vs actual types
- WHEN a callback signature is wrong THEN the error SHALL highlight the mismatched parameters
- IF the error is complex THEN helper types SHALL simplify the diagnostic message

**Priority**: MEDIUM

---

#### 5.4 Documentation Updates
**User Story**: As a developer learning the hooks system, I want updated documentation that reflects the type safety improvements, so that I can use hooks correctly from the start.

**Acceptance Criteria**:
- WHEN type fixes are complete THEN hook documentation SHALL be updated with type examples
- WHEN a developer reads docs THEN they SHALL see TypeScript examples with proper types
- WHEN breaking changes exist THEN migration guides SHALL be provided
- IF new type patterns are introduced THEN they SHALL be documented with examples

**Priority**: LOW

---

### 6. Testing Requirements

#### 6.1 Type Tests
**User Story**: As a developer maintaining the hooks system, I want type tests that verify type safety, so that regressions are caught automatically.

**Acceptance Criteria**:
- WHEN type fixes are implemented THEN type tests SHALL verify correct behavior
- WHEN invalid types are used THEN type tests SHALL fail at compile time
- WHEN hook signatures change THEN type tests SHALL detect breaking changes
- IF a type regression occurs THEN CI SHALL fail the build

**Priority**: HIGH

---

#### 6.2 Runtime Tests
**User Story**: As a developer, I want runtime tests to verify that type fixes don't break functionality, so that the system remains stable.

**Acceptance Criteria**:
- WHEN type fixes are applied THEN all existing tests SHALL continue to pass
- WHEN hooks are registered and executed THEN behavior SHALL match pre-fix behavior
- WHEN edge cases occur THEN they SHALL be handled correctly
- IF a runtime regression occurs THEN tests SHALL catch it before deployment

**Priority**: CRITICAL

---

## Success Criteria

The requirements are met when:

1. ✅ All 50+ `any` usages are replaced with proper types (`unknown`, `never`, or specific types)
2. ✅ The typed hooks bridge requires zero type casts in its implementation
3. ✅ Existing hook usage compiles without changes (backward compatible)
4. ✅ TypeScript provides autocomplete and error checking for all hook operations
5. ✅ All tests pass with no runtime behavior changes
6. ✅ Type checking performance remains acceptable (< 2s for full type check)
7. ✅ Hook consumers get clear, actionable error messages for type mistakes

---

## Constraints

1. **No Breaking Changes**: Runtime behavior must remain identical
2. **Minimal Changes**: Make the smallest possible changes to achieve type safety
3. **Reuse Existing Types**: Leverage types like `ChatMessage`, `ToolCall` from `utils/chat/types.ts`
4. **Follow TypeScript Best Practices**: Use `unknown` over `any`, `never` for impossible cases
5. **Maintain Performance**: Type inference should not significantly slow down IDE or builds

---

## Dependencies

- TypeScript 4.5+ (for template literal types and advanced conditional types)
- Existing type definitions in `utils/chat/types.ts`
- Existing hook system runtime implementation
- Planning document: `planning/type-safety-review/03-HIGH-core-hooks-system.md`

---

## References

- Planning Document: `/home/runner/work/or3-chat/or3-chat/planning/type-safety-review/03-HIGH-core-hooks-system.md`
- Chat Types: `app/utils/chat/types.ts`
- TypeScript Documentation: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html
