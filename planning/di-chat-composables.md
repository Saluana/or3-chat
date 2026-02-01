# Chat Composables Code Review

**Date:** 2026-02-01  
**Scope:** All chat composables in `app/composables/chat/` and related files  
**Reviewer:** Neckbeard Skill + Doc-Maker Guidelines  

---

## Executive Summary

The chat composables suffer from **critical documentation debt**. Only 1 of 11 composables has acceptable documentation, and the largest file (`useAi.ts` with 3489+ lines) is a maintainability nightmare waiting to happen. Multiple architecture violations and technical debt issues identified.

**Overall Grade: D-**

---

## Issue: Zero Documentation on Critical Mention Indexing

**Location:** `app/plugins/ChatMentions/useChatMentions.ts:1-432`

**Code:**
```typescript
// Line 1 - literally nothing
import { createDb, buildIndex, searchWithIndex } from '~/core/search/orama';

// 432 lines of completely undocumented code
```

**Why This Is Bad:**
This is the mentions indexing system. It handles document/thread search for the @mention feature. Without documentation:
- No developer knows the indexing lifecycle
- No one knows the search algorithm or its limitations  
- No one knows how to extend it for new mention sources
- The `any` types scattered throughout hide critical type information

**Consequences If Unfixed:**
- Future developers will break mentions functionality by accident
- Debugging search issues becomes archaeology
- No one will dare refactor it (it is already a black box)

**Fix:**
Add full doc-maker compliant documentation including:
- @module header with Purpose/Responsibilities/Non-responsibilities
- JSDoc for all exported functions
- Document the Orama schema constraints

**Priority: CRITICAL**

---

## Issue: The 3489-Line Monster File

**Location:** `app/composables/chat/useAi.ts:1-3489+`

**Why This Is Bad:**
This file violates every principle of maintainable code:
1. **Single Responsibility Violation**: Handles streaming, background jobs, tool execution, message persistence, limits enforcement, workflow integration
2. **No Module Documentation**: A 3489-line file with zero @module documentation
3. **Dead Code Risk**: 624 lines of types and helpers before the main export - impossible to tell what is used
4. **Testing Nightmare**: Cannot test individual concerns in isolation

**Consequences If Unfixed:**
- Any change risks breaking 10 other things
- Code review becomes impossible (too large to reason about)
- Refactoring requires weeks of regression testing
- New developers will copy this pattern (making it worse)

**Fix:**
Extract into focused modules:
- `useChatStreaming.ts` - streaming and accumulator logic
- `useChatBackgroundJobs.ts` - background job tracking
- `useChatTools.ts` - tool execution
- `useChatCore.ts` - main orchestration (max 300 lines)

**Priority: CRITICAL**

---

## Issue: Any Types Everywhere

**Location:** `app/plugins/ChatMentions/useChatMentions.ts:68, 72, 76, 82, 114, 263, 289, 326, 338, 386, 399`

**Code:**
```typescript
.and((p: any) => !p.deleted)
.filter((t: any) => !t.deleted)
...docs.map((d: any) => ({
...threads.map((t: any) => ({
(hit: any)
(m: any)
(doc: any)
(thread: any)
(payload: any)
```

**Why This Is Bad:**
Using `any` defeats TypeScript's purpose. These are database records with known schemas. The `any` types hide:
- Missing properties
- Wrong property access
- Potential null/undefined issues

**Consequences If Unfixed:**
- Runtime errors that TypeScript could have caught
- Refactoring becomes Russian roulette
- New developers have no IDE assistance

**Fix:**
Replace all `any` with proper types from `~/db/schema` or create local interfaces.

**Priority: HIGH**

---

## Issue: Missing Module Documentation on All Composables

**Files:**
- `useActivePrompt.ts`
- `useDefaultPrompt.ts`
- `useMessageEditing.ts`
- `useMessageActions.ts`
- `useModelStore.ts`

**Code Pattern:**
```typescript
import { ref, readonly } from 'vue';
// No @module documentation

export function useActivePrompt() {
  // No JSDoc
}
```

**Why This Is Bad:**
Per doc-maker skill guidelines, every module needs:
- Purpose
- Responsibilities
- Non-responsibilities
- Architecture notes

Without this, developers cannot understand:
- When to use the composable
- What guarantees it makes
- What state it manages

**Consequences If Unfixed:**
- Developers guess at usage (incorrectly)
- State management becomes inconsistent
- Bugs from misuse proliferate

**Fix:**
Add doc-maker compliant @module headers to all files.

**Priority: HIGH**

---

## Issue: Inconsistent State Management Pattern

**Location:** Multiple composables

**Code:**
```typescript
// useActivePrompt.ts
const _activePromptId = ref<string | null>(null);  // module singleton

// useAiSettings.ts  
const _settings = ref<AiSettingsV1>({ ... });  // module singleton with _loaded flag

// useModelStore.ts
const favoriteModels = ref<OpenRouterModel[]>([]);  // module singleton

// useDefaultPrompt.ts
const _defaultPromptId = ref<string | null>(null);  // module singleton
```

**Why This Is Bad:**
Every composable uses module-scoped refs for state, but with inconsistent patterns:
- Some use underscore prefix, some do not
- Some have `_loaded` guards, others do not
- No documentation explaining why module scope vs function scope
- No explanation of the singleton pattern rationale

**Consequences If Unfixed:**
- Developers will create duplicate state accidentally
- Race conditions between components
- Memory leaks from uncleared state

**Fix:**
Document the singleton pattern in each composable. Explain:
- Why module scope is necessary
- When state is cleared
- Thread safety considerations

**Priority: MEDIUM**

---

## Issue: Error Swallowing Anti-Pattern

**Location:** `useChatMentions.ts`, `useModelStore.ts`

**Code:**
```typescript
} catch (e) {
  console.warn('[mentions] Failed to index document:', e);
}

} catch (e) {
  console.warn('[models-cache] Dexie load failed', e);
  return null;
}
```

**Why This Is Bad:**
Errors are logged and swallowed. The caller has no idea the operation failed. This violates the principle that errors should be propagated to the appropriate handler.

**Consequences If Unfixed:**
- Silent failures in production
- Users see broken UI with no error feedback
- Debugging requires console inspection

**Fix:**
Return error results or throw to callers. Let the UI layer decide how to handle failures.

**Priority: MEDIUM**

---

## Issue: No Cleanup Documentation for Reactive State

**Location:** `useChatInputBridge.ts`

**Code:**
```typescript
const registry = ref<RegisteredPaneInput[]>([]);

export function registerPaneInput(paneId: string, api: ChatInputImperativeApi) {
  // No cleanup documentation
}
```

**Why This Is Bad:**
The registry is module-scoped but never cleaned up. For HMR or pane lifecycle, stale entries accumulate. There is no documentation on:
- When to call unregisterPaneInput
- What happens to the registry on HMR
- Memory leak risks

**Consequences If Unfixed:**
- Memory leaks in long-running sessions
- Stale references to destroyed components
- Ghost pane IDs causing weird behavior

**Fix:**
Add documentation about cleanup requirements. Consider automatic cleanup via WeakRef.

**Priority: MEDIUM**

---

## Issue: Workflow Stream Accumulator Lacks Architecture Docs

**Location:** `app/composables/chat/useWorkflowStreamAccumulator.ts:1-1274`

**Code:**
```typescript
/**
 * Reactive state interface for workflow execution streaming.
 * This state is exposed to UI components for real-time rendering.
 */
```

**Why This Is Bad:**
This 1274-line file has one comment block at the top. It lacks:
- @module documentation explaining overall architecture
- Why subflows are nested
- How RAF batching works
- Performance characteristics
- Error handling strategy

**Consequences If Unfixed:**
- Future developers will break workflow rendering
- Performance regressions from misuse
- Subflow bugs from misunderstanding nesting

**Fix:**
Add comprehensive @module documentation per doc-maker guidelines.

**Priority: HIGH**

---

## Issue: Unused Type Export

**Location:** `useStreamAccumulator.ts:198`

**Code:**
```typescript
export type { StreamingState as UnifiedStreamingState };
```

**Why This Is Bad:**
This alias was added for "future usage" per the comment on line 193. It has been sitting there unused. Dead code increases bundle size and confusion.

**Consequences If Unfixed:**
- Bundle bloat
- Future developers wonder if they should use it
- Creates naming confusion (which name is canonical?)

**Fix:**
Remove the unused alias or document when to use it.

**Priority: LOW**

---

## Issue: Missing Error Handling Documentation

**Location:** `useMessageEditing.ts`

**Code:**
```typescript
async function saveEdit() {
  try {
    saving.value = true;
    const existing: Message | undefined = await db.messages.get(id);
    if (!existing) throw new Error('Message not found');
    // ...
  } finally {
    saving.value = false;
  }
}
```

**Why This Is Bad:**
The error is thrown but never caught in the composable. It is unclear:
- Who catches this error
- What the UI should show
- How to recover from failures

**Consequences If Unfixed:**
- Unhandled promise rejections in production
- UI left in broken state
- No user feedback on save failure

**Fix:**
Document error handling contract. Add proper error propagation or handling.

**Priority: MEDIUM**

---

## Issue: No JSDoc for Public API

**Location:** All composables

**Example:**
```typescript
export function useModelStore() {
  function isFresh(ts: number | undefined, ttl: number) {
    // No JSDoc
  }
  
  async function fetchModels(opts?: { force?: boolean; ttlMs?: number }) {
    // No JSDoc
  }
  // ... 330 lines of undocumented functions
}
```

**Why This Is Bad:**
Per doc-maker guidelines, public APIs need:
- Purpose section
- Behavior section  
- Constraints section
- Non-goals section
- Examples

Without these, developers cannot use the API correctly.

**Consequences If Unfixed:**
- API misuse
- Support burden from confused developers
- Inconsistent patterns across codebase

**Fix:**
Add JSDoc per doc-maker skill specification to all exported functions.

**Priority: HIGH**

---

## Priority Task List

### CRITICAL (Do First)

- [ ] **DOC-001**: Add @module documentation to `useChatMentions.ts` with Purpose, Responsibilities, and Architecture sections
- [ ] **ARCH-001**: Create refactoring plan for `useAi.ts` (3489 lines) - split into focused composables
- [ ] **TYPE-001**: Replace all `any` types in `useChatMentions.ts` with proper types from schema

### HIGH (Do Soon)

- [ ] **DOC-002**: Add @module documentation to `useActivePrompt.ts`
- [ ] **DOC-003**: Add @module documentation to `useDefaultPrompt.ts`
- [ ] **DOC-004**: Add @module documentation to `useMessageEditing.ts`
- [ ] **DOC-005**: Add @module documentation to `useMessageActions.ts`
- [ ] **DOC-006**: Add @module documentation to `useModelStore.ts`
- [ ] **DOC-007**: Add comprehensive @module documentation to `useWorkflowStreamAccumulator.ts` (1274 lines)
- [ ] **DOC-008**: Add JSDoc to all exported functions in `useAiSettings.ts`
- [ ] **DOC-009**: Add JSDoc to all exported functions in `useModelStore.ts`

### MEDIUM (Do When Convenient)

- [ ] **DOC-010**: Document singleton state pattern in all composables (explain why module scope is used)
- [ ] **DOC-011**: Add cleanup documentation to `useChatInputBridge.ts` (explain when to call unregister)
- [ ] **DOC-012**: Document error handling contract in `useMessageEditing.ts`
- [ ] **ERR-001**: Fix error swallowing in `useChatMentions.ts` and `useModelStore.ts` - propagate errors instead of just logging

### LOW (Nice to Have)

- [ ] **CLEAN-001**: Remove unused `UnifiedStreamingState` type alias or document its purpose
- [ ] **CLEAN-002**: Standardize naming convention for module-scoped refs (underscore prefix or not)
- [ ] **CLEAN-003**: Review `useAi.ts` for dead code in the 624 lines of types/helpers before main export

---

## Statistics

| Metric | Count |
|--------|-------|
| Total Files Reviewed | 11 |
| Files with Zero Documentation | 5 |
| Lines of Code Reviewed | ~6,800 |
| Documentation Issues Found | 14 |
| Architecture Issues Found | 2 |
| Type Safety Issues Found | 1 |
| Code Quality Issues Found | 3 |

---

## Notes for Future Maintenance

1. **Testing Gap**: None of the composables have documented testing strategies. Consider adding testing documentation per doc-maker guidelines.

2. **Hook Integration**: Several composables use hooks but don't document which hooks they emit or listen to. Cross-reference with `docs/core-hook-map.md`.

3. **SSR Boundaries**: Not all composables document their SSR compatibility. Some use `import.meta.client` checks but don't explain why.

4. **Performance Considerations**: Only `useStreamAccumulator.ts` documents performance characteristics (RAF batching). Others should document their performance implications.

5. **Deprecation Strategy**: The doc-maker skill mentions using `@deprecated` tags with migration paths. None of the composables currently document deprecated APIs.

---

*Generated by neckbeard-code-review skill + doc-maker guidelines*  
*Review date: 2026-02-01*