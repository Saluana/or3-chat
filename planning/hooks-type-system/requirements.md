# Hook & Plugin Type System Enhancement — Requirements

## Introduction

The current hook and plugin system provides a powerful, flexible event-driven architecture for extending the application. However, it lacks comprehensive TypeScript type support, leading to poor developer experience with no autocomplete, no compile-time safety, and manual type casting. This enhancement will transform the hook system into a fully type-safe, developer-friendly API while maintaining 100% backward compatibility with existing code.

## Requirements

### 1. Full Type Inference for Hook Registration

**User Story**: As a plugin developer, I want TypeScript to automatically infer the correct callback signature when I register a hook, so that I get autocomplete and compile-time errors for incorrect parameters.

**Acceptance Criteria**:

-   WHEN I call `hooks.on('ai.chat.send:action:before', callback)` THEN TypeScript SHALL infer that `callback` must accept `(ctx: AiSendBefore) => void | Promise<void>`
-   WHEN I call `hooks.applyFilters('ui.chat.message:filter:outgoing', value)` THEN TypeScript SHALL infer that `value` must be `string` and the return type SHALL be `Promise<string>`
-   WHEN I provide a callback with wrong parameters THEN TypeScript SHALL show a compile-time error
-   WHEN I use `useHookEffect` with a known hook name THEN the callback parameters SHALL be automatically typed

### 2. Autocomplete for Hook Names

**User Story**: As a plugin developer, I want my IDE to suggest available hook names when I start typing, so that I can discover hooks without reading documentation.

**Acceptance Criteria**:

-   WHEN I type `hooks.on('` THEN my IDE SHALL show autocomplete suggestions for all known hook names
-   WHEN I type `hooks.on('ai.chat.` THEN my IDE SHALL filter suggestions to hooks starting with `ai.chat.`
-   WHEN I type `hooks.on('db.messages.` THEN my IDE SHALL show all message-related DB hooks
-   WHEN I hover over a hook name THEN I SHALL see JSDoc documentation describing the hook's purpose and payload

### 3. Filter vs Action Type Distinction

**User Story**: As a plugin developer, I want the type system to enforce that filters return values and actions return void, so that I cannot accidentally misuse hooks.

**Acceptance Criteria**:

-   WHEN I register a filter hook THEN TypeScript SHALL require the callback to return the filtered value type
-   WHEN I register an action hook THEN TypeScript SHALL allow the callback to return `void` or `Promise<void>`
-   WHEN I try to return a value from an action hook THEN TypeScript SHALL show a warning (but not error, for flexibility)
-   WHEN I forget to return a value from a filter THEN TypeScript SHALL show an error

### 4. Comprehensive Payload Type Definitions

**User Story**: As a plugin developer, I want all hooks to have well-defined payload types, so that I know exactly what data I'm working with.

**Acceptance Criteria**:

-   WHEN I use any known hook THEN it SHALL have a corresponding payload type definition
-   WHEN I use a DB hook (e.g., `db.messages.create:action:before`) THEN the payload type SHALL match the entity schema
-   WHEN I use a UI hook THEN the payload SHALL include all relevant context (pane, thread, message data)
-   WHEN a hook payload changes THEN TypeScript SHALL catch all affected code at compile time

### 5. Wildcard Hook Type Support

**User Story**: As a plugin developer, I want to use wildcard hooks with partial type safety, so that I can listen to patterns while still getting some type information.

**Acceptance Criteria**:

-   WHEN I register a wildcard hook like `ui.pane.*:action` THEN TypeScript SHALL provide a union type of all matching hook payloads
-   WHEN I register `db.*:action:after` THEN TypeScript SHALL infer a generic entity payload type
-   WHEN no specific type can be inferred THEN TypeScript SHALL fall back to a safe generic type
-   WHEN I use a completely unknown hook pattern THEN TypeScript SHALL allow it but with minimal type safety

### 6. Backward Compatibility

**User Story**: As a maintainer, I want the new type system to be fully backward compatible, so that existing plugins continue to work without modification.

**Acceptance Criteria**:

-   WHEN existing code uses `hooks.addAction()` or `hooks.addFilter()` THEN it SHALL continue to work unchanged
-   WHEN existing code uses `useHookEffect()` without types THEN it SHALL continue to function
-   WHEN I migrate to typed hooks THEN I SHALL be able to do so incrementally, file by file
-   WHEN I use the old `typedOn()` helper THEN it SHALL still work but be marked as deprecated

### 7. Enhanced Composables with Type Inference (Typed by default)

**User Story**: As a Vue component developer, I want composables that provide full type safety, so that I get the best DX when using hooks in components.

**Acceptance Criteria**:

-   WHEN I use `useHooks()` THEN I SHALL get a fully typed hooks interface (no new composables required)
-   WHEN I use `useHookEffect(hookName, callback)` THEN the callback SHALL be automatically typed based on `hookName`
-   WHEN I use these composables THEN they SHALL handle cleanup automatically like before
-   WHEN I use them in HMR scenarios THEN they SHALL properly dispose and re-register (unchanged behavior)

### 8. Type Utilities for Advanced Use Cases

**User Story**: As an advanced plugin developer, I want type utilities to extract hook signatures, so that I can build higher-level abstractions.

**Acceptance Criteria**:

-   WHEN I use `InferHookCallback<'ai.chat.send:action:before'>` THEN I SHALL get the exact callback type
-   WHEN I use `InferFilterReturn<'ui.chat.message:filter:outgoing'>` THEN I SHALL get the filter's return type
-   WHEN I use `IsAction<K>` or `IsFilter<K>` THEN I SHALL get a boolean type for conditional logic
-   WHEN I use `ExtractHookPayload<K>` THEN I SHALL get the payload type for a hook

### 9. Improved Error Messages

**User Story**: As a plugin developer, I want clear, actionable TypeScript error messages when I misuse hooks, so that I can quickly fix issues.

**Acceptance Criteria**:

-   WHEN I provide wrong callback parameters THEN the error message SHALL clearly state the expected signature
-   WHEN I use a non-existent hook name THEN TypeScript SHALL suggest similar hook names
-   WHEN I return the wrong type from a filter THEN the error SHALL show both expected and actual types
-   WHEN I make a common mistake THEN the error SHALL include a hint about the correct usage

### 10. Documentation and Migration Guide

**User Story**: As a plugin developer, I want comprehensive documentation and examples, so that I can learn the new type system quickly.

**Acceptance Criteria**:

-   WHEN I read the documentation THEN I SHALL find examples of all common hook patterns with types
-   WHEN I need to migrate existing code THEN I SHALL have a step-by-step migration guide
-   WHEN I want to add a new hook THEN I SHALL have clear instructions on how to add types
-   WHEN I encounter edge cases THEN the docs SHALL cover advanced patterns and workarounds

### 11. Performance and Bundle Size

**User Story**: As a maintainer, I want the type system to have zero runtime overhead, so that it doesn't impact application performance or bundle size.

**Acceptance Criteria**:

-   WHEN the typed system is used THEN it SHALL add zero bytes to the production bundle
-   WHEN types are compiled THEN they SHALL be completely erased at runtime
-   WHEN the engine executes hooks THEN performance SHALL be identical to the current implementation
-   WHEN type checking occurs THEN it SHALL not significantly slow down the TypeScript compiler

### 12. Extensibility for Custom Hooks

**User Story**: As a plugin developer, I want to easily add types for my custom hooks, so that my plugin provides the same great DX as core hooks.

**Acceptance Criteria**:

-   WHEN I define a custom hook THEN I SHALL be able to augment the type system via module augmentation
-   WHEN I register custom hook types THEN they SHALL integrate seamlessly with the typed composables
-   WHEN I share my plugin THEN other developers SHALL get full type support for my hooks
-   WHEN I use TypeScript's declaration merging THEN it SHALL work correctly with the hook system
