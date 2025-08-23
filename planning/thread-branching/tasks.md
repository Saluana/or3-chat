---
artifact_id: e6e1e063-049a-4b61-a13b-0ce717a672a6
name: Conversation Branching Implementation Tasks
---

# Task Checklist

## 1. Branch Core Module

-   [x] 1.1 Create `app/db/branching.ts` exporting `createBranch`, `retryAsBranch`, `getAnchorMetaFast`, `parseAnchorMeta`. (Requirements: 1,2,5,7,10,11,13,14)
-   [x] 1.2 Implement fork option validation + hook `db.threads.fork:filter:options` (hook point stubbed via applyFilters usage). (Requirements: 14)
-   [x] 1.3 Add duplicate empty fork detection (anchor + parent + mode). (Requirements: 5)
-   [x] 1.4 Add performance marks around branch creation. (Requirements: 9,16,17)

## 2. Light Fork Metadata

-   [x] 2.1 Implement title prefix encoding & parsing utilities. (Requirements: 11)
-   [x] 2.2 Caching layer Map for anchor meta retrieval. (Requirements: 11,17)
-   [x] 2.3 Invalidation logic on thread title update (exported `invalidateAnchorCache`; fork creation triggers). (Requirements: 11)

## 3. Full Copy Fork Logic

-   [x] 3.1 Query ancestor messages <= anchor.index sorted. (Requirements: 1)
-   [x] 3.2 Copy with new ids & same indexes inside transaction. (Requirements: 1,10,13)
-   [x] 3.3 Normalize indexes if collision (call `normalizeThreadIndexes`). (Requirements: 10)

## 4. Light Fork Context Assembly

-   [x] 4.1 Implement `assembleContext(threadId)` producing ordered messages array for AI. (Requirements: 2,6)
-   [x] 4.2 Token budget heuristic + truncation earliest-first. (Requirements: 6)
-   [x] 4.3 Hook integration `ai.context.branch:filter:messages`. (Requirements: 6,14)

## 5. Retry-As-Branch

-   [x] 5.1 Implement `retryAsBranch(assistantMessageId, mode='full'|'light')`. (Requirements: 7)
-   [x] 5.2 Delete nothing in source; route resend through new fork (returns new thread for navigation). (Requirements: 7)
-   [ ] 5.3 UI toast success + navigation to new fork. (Requirements: 7,8)

## 6. UI: Message Actions

-   [ ] 6.1 Extend message action menu to include Branch from here + Retry as Branch. (Requirements: 1,7,8,15)
-   [ ] 6.2 Implement keyboard shortcut Cmd+B on focused message -> open branch modal. (Requirements: 15)
-   [ ] 6.3 Modal with: mode selector (Full Copy / Light), title input, create button. (Requirements: 1,2,11,15)

## 7. UI: Branch Explorer

-   [ ] 7.1 Create `BranchExplorer.vue` tree component. (Requirements: 4,3)
-   [ ] 7.2 Lazy load children on expand except when project threads < threshold. (Requirements: 4,9)
-   [ ] 7.3 Breadcrumb component with overflow collapse >6 depth. (Requirements: 3)
-   [ ] 7.4 Branch count badge + icon on nodes with children. (Requirements: 3,8)

## 8. UI: Thread View Enhancements

-   [ ] 8.1 Ancestor divider & rendering for light forks (read-only styling). (Requirements: 2,8)
-   [ ] 8.2 Hover label "(from parent)" on copied messages. (Requirements: 8)
-   [ ] 8.3 Virtualization if ancestor+local messages >300 (use existing virtualization lib or simple window). (Requirements: 9)

## 9. Duplicate Prevention

-   [ ] 9.1 Pre-create check for existing empty fork with same anchor (mode-specific). (Requirements: 5)
-   [ ] 9.2 Prompt user to reuse existing; implement UI confirm dialog. (Requirements: 5)

## 10. Deletion & Pruning

-   [ ] 10.1 Update thread deletion flow: if deleting thread with children, prompt re-parent or cascade. (Requirements: 12)
-   [ ] 10.2 Implement re-parent logic (child.parent_thread_id = deleted.parent_thread_id). (Requirements: 12)
-   [ ] 10.3 Orphan badge for child whose parent deleted. (Requirements: 12,8)

## 11. Accessibility & Keyboard

-   [ ] 11.1 Add ARIA roles to Branch Explorer tree items (role=tree, treeitem). (Requirements: 15,17)
-   [ ] 11.2 Arrow key navigation & Enter to open thread. (Requirements: 15)

## 12. Hooks & Extensibility

-   [ ] 12.1 Register new hooks in hooks system with docs. (Requirements: 14)
-   [ ] 12.2 Add examples in docs for hooking into branch context assembly. (Requirements: 14,16)

## 13. Performance & Metrics

-   [ ] 13.1 Add performance marks prefix `branch:` for creation and context assembly. (Requirements: 9,16,17)
-   [ ] 13.2 Log copy count & ms duration dev-only. (Requirements: 9,16)

## 14. Testing / QA

-   [ ] 14.1 Script: create thread, branch full copy, assert message counts. (Requirements: 16)
-   [ ] 14.2 Script: light fork context assembly merges ancestor + local. (Requirements: 2,6,16)
-   [ ] 14.3 Script: retry-as-branch creates fork and leaves original unchanged. (Requirements: 7,16)
-   [ ] 14.4 Script: duplicate prevention finds existing fork. (Requirements: 5,16)
-   [ ] 14.5 Performance measure copying 200 messages < 50ms. (Requirements: 9,16)

## 15. Documentation

-   [ ] 15.1 Add `planning/thread-branching/README` summary or update main README section. (Requirements: 16,17)
-   [ ] 15.2 JSDoc for public branching APIs. (Requirements: 17)

## 16. Non-Functional

-   [ ] 16.1 Ensure all new code typed, no `any` leaks (lint). (Requirements: 17)
-   [ ] 16.2 Avoid blocking loops > 250 iterations without `await Promise.resolve()`. (Requirements: 17)
-   [ ] 16.3 Cache anchor meta lookups; measure hits vs misses (dev log). (Requirements: 17)

# Mapping Summary

-   Requirements coverage: Each task notes its linked requirement IDs.
-   Deferred: Dedicated thread_meta table (future), graph visualization, merge branches (not in this phase).
