# Hook & Plugin Type System Enhancement — Tasks

## Implementation Checklist

### 1. Core Type System Foundation

**Requirements**: 1, 2, 4, 8

-   [x] 1.1 Create `app/utils/hook-types.ts` with comprehensive type definitions
    -   [x] Define all payload interfaces (AI, Chat, Pane, DB, etc.)
    -   [x] Create `ActionHookName` and `FilterHookName` unions
    -   [x] Define `HookPayloadMap` interface mapping names to parameter tuples
    -   [x] Add DB hook template literal types (`DbActionHookName`, `DbFilterHookName`)
    -   [x] Export `HookName` as union of all hook types
-   [x] 1.2 Implement type utility functions

    -   [x] `InferHookParams<K>` - Extract callback parameters from hook name
    -   [x] `InferHookReturn<K>` - Extract return type (void for actions, value for filters)
    -   [x] `InferHookCallback<K>` - Full callback signature inference
    -   [x] `IsAction<K>` and `IsFilter<K>` - Type guards
    -   [x] `ExtractHookPayload<K>` - Get payload type
    -   [x] `MatchingHooks<Pattern>` - Wildcard pattern matching
    -   [x] `InferDbEntity<K>` - DB entity type inference

-   [x] 1.3 Add entity type definitions for DB hooks
    -   [x] `MessageEntity` interface
    -   [x] `ThreadEntity` interface
    -   [x] `DocumentEntity` interface
    -   [x] `FileEntity` interface
    -   [x] `ProjectEntity` interface
    -   [x] `PostEntity` interface
    -   [x] `PromptEntity` interface
    -   [x] Generic `DbCreatePayload<T>`, `DbUpdatePayload<T>`, `DbDeletePayload<T>`

### 2. Typed Hook Engine Wrapper

**Requirements**: 1, 3, 5

-   [x] 2.1 Create `app/utils/typed-hooks.ts`

    -   [x] Define `TypedHookEngine` interface with generic methods
    -   [x] Implement `addAction<K>` with type inference
    -   [x] Implement `addFilter<K>` with type inference
    -   [x] Implement `doAction<K>` with parameter type checking
    -   [x] Implement `doActionSync<K>` with parameter type checking
    -   [x] Implement `applyFilters<K>` with value and return type inference
    -   [x] Implement `applyFiltersSync<K>` with value and return type inference
    -   [x] Implement `on<K>` with unified action/filter support
    -   [x] Add utility methods (`hasAction`, `hasFilter`, etc.)

-   [x] 2.2 Implement `createTypedHookEngine()` factory

    -   [x] Create zero-cost wrapper around `HookEngine`
    -   [x] Proxy all methods with type casts
    -   [x] Expose `_engine` and `_diagnostics` for advanced use
    -   [x] Ensure no runtime overhead

-   [x] 2.3 Add helper types
    -   [x] `Tail<T>` utility for extracting rest parameters
    -   [x] Conditional types for action vs filter distinction
    -   [x] Support for optional parameters in hook payloads

### 3. Typed Composables (typed-by-default)

**Requirements**: 7, 6

-   [x] 3.3 Update existing composables for compatibility
    -   [x] Keep `useHooks()` API name, but return a typed wrapper (non-breaking)
    -   [x] Keep `useHookEffect()` API name, but add generics for typed callbacks (non-breaking)
    -   [x] No duplicate composables required; typed is now the default

### 4. Enhanced Hook Payload Definitions

**Requirements**: 4

-   [x] 4.1 Complete all AI/Chat hook payloads

    -   [x] `AiSendBeforePayload` with all fields
    -   [x] `AiSendAfterPayload` with timings
    -   [x] `AiStreamDeltaPayload` with context
    -   [x] `AiStreamReasoningPayload`
    -   [x] `AiStreamCompletePayload`
    -   [x] `AiStreamErrorPayload`
    -   [x] `AiRetryBeforePayload` and `AiRetryAfterPayload`

-   [x] 4.2 Complete all Pane hook payloads

    -   [x] `PaneState` interface
    -   [x] `UiPaneActivePayload`
    -   [x] `UiPaneBlurPayload`
    -   [x] `UiPaneSwitchPayload`
    -   [x] `UiPaneThreadChangedPayload`
    -   [x] `UiPaneDocChangedPayload`
    -   [x] `UiPaneMsgSentPayload`
    -   [x] `UiPaneMsgReceivedPayload`

-   [x] 4.3 Complete all UI hook payloads

    -   [x] `UiSidebarSelectPayload`
    -   [x] `UiChatNewPayload`
    -   [x] `AppInitPayload`
    -   [x] `FilesAttachPayload`

-   [x] 4.4 Add DB hook payload mappings
    -   [x] Map all `db.messages.*` hooks to payloads
    -   [x] Map all `db.threads.*` hooks to payloads
    -   [x] Map all `db.documents.*` hooks to payloads
    -   [x] Map all `db.files.*` hooks to payloads
    -   [x] Map all `db.projects.*` hooks to payloads
    -   [x] Map all `db.posts.*` hooks to payloads
    -   [x] Map all `db.prompts.*` hooks to payloads
    -   [x] Map all `db.attachments.*` hooks to payloads
    -   [x] Map all `db.kv.*` hooks to payloads

### 5. Wildcard and Pattern Support

**Requirements**: 5

-   [ ] 5.1 Implement wildcard type inference

    -   [ ] Create `WildcardHookPayload<Pattern>` type
    -   [ ] Support `ui.pane.*` patterns with union types
    -   [ ] Support `db.*` patterns with generic entity types
    -   [ ] Support `*.action:*` and `*.filter:*` patterns
    -   [ ] Fallback to safe generic types for unknown patterns

-   [ ] 5.2 Add pattern matching utilities
    -   [ ] `MatchingHooks<Pattern>` to get all matching hook names
    -   [ ] `InferWildcardCallback<Pattern>` for callback inference
    -   [ ] Documentation for wildcard usage with types

### 6. Migration and Compatibility

**Requirements**: 6

-   [x] 6.1 Ensure backward compatibility

    -   [ ] All existing untyped code continues to work
    -   [ ] No breaking changes to `HookEngine` interface
    -   [ ] Legacy `typedOn()` helper still works
    -   [ ] Gradual migration path documented

-   [x] 6.2 Create migration utilities

    -   [ ] `app/utils/hook-migration.ts` with helper functions
    -   [ ] `isValidHookName()` for runtime validation
    -   [ ] `suggestHookNames()` for typo suggestions
    -   [ ] `deprecatedTypedOn()` with warning

-   [x] 6.3 Add development-only validation
    -   [ ] Runtime hook name validation in dev mode
    -   [ ] Helpful error messages for common mistakes
    -   [ ] Suggestions for misspelled hook names
    -   [ ] Tree-shake validation code in production

### 7. Error Messages and DX

**Requirements**: 9

-   [x] 7.1 Improve TypeScript error messages

    -   [x] Custom error types with helpful messages
    -   [x] `ValidateHookName<K>` with suggestions
    -   [x] `SuggestSimilar<K>` for typo detection
    -   [x] Clear messages for wrong callback signatures

-   [x] 7.2 Add JSDoc documentation

    -   [x] Document all hook names with descriptions
    -   [x] Add `@example` tags for common patterns
    -   [x] Document payload structures
    -   [x] Add `@see` links to related hooks

-   [~] 7.3 Create type-aware linting
    -   [~] Warn on untyped hook usage in new code (skipped: no ESLint)
    -   [~] Suggest migration to typed APIs (skipped: no ESLint)

### 8. Testing

**Requirements**: 11

-   [ ] 8.1 Create type-level tests

    -   [ ] `app/utils/__tests__/hook-types.test-d.ts` with type assertions
    -   [ ] Test `InferHookCallback` for all hook types
    -   [ ] Test `InferHookReturn` for actions and filters
    -   [ ] Test DB hook type inference
    -   [ ] Test wildcard pattern matching
    -   [ ] Use `expectTypeOf` from Vitest

-   [ ] 8.2 Create integration tests

    -   [ ] `app/composables/__tests__/useTypedHooks.test.ts`
    -   [ ] Test typed hook registration and execution
    -   [ ] Test filter return type enforcement
    -   [ ] Test action void return
    -   [ ] Test cleanup on unmount
    -   [ ] Test HMR disposal

-   [ ] 8.3 Create runtime tests

    -   [ ] Test that typed wrapper has zero overhead
    -   [ ] Benchmark typed vs untyped performance
    -   [ ] Verify no bundle size increase
    -   [ ] Test SSR compatibility

-   [ ] 8.4 Add example tests
    -   [ ] Test all examples from documentation
    -   [ ] Ensure examples compile without errors
    -   [ ] Verify examples demonstrate best practices

### 9. Documentation

**Requirements**: 10

-   [ ] 9.1 Create new documentation files

    -   [ ] `docs/hooks-type-system.md` - Comprehensive type system guide
        -   [ ] Overview and benefits
        -   [ ] Getting started
        -   [ ] Type inference examples
        -   [ ] Custom hook registration
        -   [ ] Advanced patterns
        -   [ ] Troubleshooting
    -   [ ] `docs/hooks-migration.md` - Migration guide
        -   [ ] Why migrate
        -   [ ] Step-by-step process
        -   [ ] Before/after examples
        -   [ ] Common patterns
        -   [ ] FAQ
    -   [ ] `docs/hooks-api-reference.md` - Complete API reference
        -   [ ] All hook names with types
        -   [ ] Payload interfaces
        -   [ ] Type utilities
        -   [ ] Composables API

-   [ ] 9.2 Update existing documentation

    -   [ ] Update `docs/hooks.md` with typed examples
    -   [ ] Add "Type System" section to main hooks doc
    -   [ ] Update all code examples to use typed hooks
    -   [ ] Add TypeScript tips and best practices
    -   [ ] Update `docs/core-hook-map.md` with type information

-   [ ] 9.3 Create example plugins

    -   [ ] `app/plugins/examples/typed-hooks-example.client.ts`
    -   [ ] Example using `useTypedHooks()`
    -   [ ] Example using `useTypedHookEffect()`
    -   [ ] Example with custom hook types
    -   [ ] Example with wildcard patterns
    -   [ ] Example with DB hooks

-   [ ] 9.4 Add inline documentation
    -   [ ] JSDoc for all exported types
    -   [ ] JSDoc for all composables
    -   [ ] Code examples in JSDoc
    -   [ ] Links to full documentation

### 10. Module Augmentation Support

**Requirements**: 12

-   [ ] 10.1 Document module augmentation pattern

    -   [ ] Create guide for adding custom hook types
    -   [ ] Example of extending `HookPayloadMap`
    -   [ ] Example of extending `ActionHookName` / `FilterHookName`
    -   [ ] Best practices for plugin authors

-   [ ] 10.2 Create augmentation template

    -   [ ] Template file for custom hooks
    -   [ ] Type-safe pattern for plugins
    -   [ ] Example plugin with custom types

-   [ ] 10.3 Test module augmentation
    -   [ ] Verify augmentation works correctly
    -   [ ] Test that augmented types are inferred
    -   [ ] Ensure no conflicts with core types

### 11. Performance Optimization

**Requirements**: 11

-   [ ] 11.1 Optimize type inference

    -   [ ] Use type aliases to cache complex types
    -   [ ] Limit conditional type recursion depth
    -   [ ] Optimize template literal types
    -   [ ] Profile TypeScript compilation time

-   [ ] 11.2 Ensure zero runtime overhead

    -   [ ] Verify typed wrapper is inlined
    -   [ ] Check bundle size (should be identical)
    -   [ ] Benchmark execution performance
    -   [ ] Tree-shake dev-only code

-   [ ] 11.3 Optimize developer experience
    -   [ ] Fast IDE autocomplete (< 100ms)
    -   [ ] Quick error feedback
    -   [ ] Minimal type checking time

### 12. Deprecation and Migration Path

**Requirements**: 6

-   [ ] 12.1 Soft deprecate old APIs

    -   [ ] Add `@deprecated` JSDoc to `typedOn()`
    -   [ ] Add migration hints in deprecation messages
    -   [ ] Keep old APIs functional

-   [ ] 12.2 Create migration tooling

    -   [ ] Script to find untyped hook usage
    -   [ ] Codemod for automatic migration (optional)
    -   [ ] Migration progress tracker

-   [ ] 12.3 Update plugin examples
    -   [ ] Migrate all example plugins to typed hooks
    -   [ ] Update plugin templates
    -   [ ] Add "new" badges to typed examples

### 13. Final Integration and Polish

**Requirements**: All

-   [ ] 13.1 Integration testing

    -   [ ] Test with all existing plugins
    -   [ ] Verify no regressions
    -   [ ] Test SSR and client-side rendering
    -   [ ] Test HMR scenarios

-   [ ] 13.2 Code review and refinement

    -   [ ] Review all type definitions
    -   [ ] Ensure consistent naming
    -   [ ] Optimize type complexity
    -   [ ] Add missing edge cases

-   [ ] 13.3 Documentation review

    -   [ ] Proofread all docs
    -   [ ] Verify all examples work
    -   [ ] Check for broken links
    -   [ ] Ensure completeness

-   [ ] 13.4 Release preparation
    -   [ ] Update CHANGELOG
    -   [ ] Create migration announcement
    -   [ ] Prepare blog post / guide
    -   [ ] Plan gradual rollout

## Implementation Order

### Phase 1: Foundation (Week 1)

1. Tasks 1.1 - 1.3: Core type system
2. Tasks 2.1 - 2.2: Typed engine wrapper
3. Tasks 3.1 - 3.2: Typed composables
4. Tasks 8.1: Basic type tests

### Phase 2: Completeness (Week 2)

5. Tasks 4.1 - 4.4: All payload definitions
6. Tasks 5.1 - 5.2: Wildcard support
7. Tasks 6.1 - 6.3: Migration utilities
8. Tasks 8.2 - 8.3: Integration and runtime tests

### Phase 3: Polish (Week 3)

9. Tasks 7.1 - 7.3: Error messages and DX
10. Tasks 9.1 - 9.4: Documentation
11. Tasks 10.1 - 10.3: Module augmentation
12. Tasks 11.1 - 11.3: Performance optimization

### Phase 4: Release (Week 4)

13. Tasks 12.1 - 12.3: Deprecation and migration
14. Tasks 13.1 - 13.4: Final integration and release

## Success Criteria

-   ✅ All hook names have type definitions
-   ✅ Full type inference works in IDE
-   ✅ Zero runtime overhead confirmed
-   ✅ 100% backward compatibility maintained
-   ✅ All tests passing (type, unit, integration)
-   ✅ Documentation complete and accurate
-   ✅ Migration guide available
-   ✅ Example plugins updated
-   ✅ Performance benchmarks meet targets
-   ✅ Developer feedback is positive

## Notes

-   Prioritize developer experience over type complexity
-   Keep types simple and understandable
-   Provide escape hatches for edge cases
-   Document limitations clearly
-   Gather feedback early and iterate
