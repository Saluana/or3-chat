# Chat Scrolling Optimization Implementation Tasks

This document provides a detailed, actionable implementation plan for the chat scrolling optimization, based on the requirements and design documents. Tasks are organized into logical phases, with granular subtasks, dependencies, and mappings to specific requirements (e.g., Req 1.1). All tasks start as incomplete ([ ]). The plan emphasizes code reduction by removing ~70% of custom logic in useAutoScroll.ts, integrating VueUse, and centralizing in VirtualMessageList.vue. Assume Vitest for testing and Bun for package management.

Focus areas:

-   Database: No changes required (scrolling is frontend-only).
-   Core Functionality: Refactor scroll logic.
-   Integration: Ensure compatibility with streaming, editing, and virtualization.
-   Testing: Update and add tests for jank-free behavior.
-   Deployment: Minimal, as it's a UI refactor.

## 1. Preparation and Setup

Requirements: General setup for non-functional requirements (performance, maintainability).

[x] 1.1 Install or verify VueUse dependency - Run `bun add @vueuse/core` if not present. - Update package.json if needed. - Requirements: 5.1 (Code Reduction).

[x] 1.2 Review and backup current implementation - Read and document current useAutoScroll.ts and ChatContainer.vue scroll logic. - Create a branch for the refactor (e.g., `git checkout -b chat-scroll-opt`). - Requirements: 6.1 (Bug-Free).

## 2. Remove and Refactor Custom Scroll Logic

Requirements: 5.1-5.3 (Performance and Code Reduction), 4.1-4.4 (Virtualization Integration).

[x] 2.1 Eliminate useAutoScroll.ts composable - 2.1.1 Remove all watchers, computed properties, and RAF batching from useAutoScroll.ts. - 2.1.2 Delete the file after migrating logic (file no longer present). - 2.1.3 Update imports in ChatContainer.vue to remove reference (no remaining imports). - Requirements: 5.2, 5.3; Map to Req 1, 2.

[x] 2.2 Remove useRafBatch.ts if redundant - 2.2.1 Replaced custom batching with VueUse's useRafFn in VirtualMessageList. - 2.2.2 Behavior validated via updated AutoScrollBehavior test. - 2.2.3 useRafBatch.ts not present. - Requirements: 5.2; Map to Req 3 (User-Initiated Scrolling).

[x] 2.3 Centralize scroll state in VirtualMessageList.vue - 2.3.1 Root & scroll parent refs added. - 2.3.2 useScroll + internal compute logic implemented. - 2.3.3 useResizeObserver added for root & external parent. - Requirements: 4.1, 4.2; Map to Req 2 (Streaming).

## 3. Implement Optimized Scroll Behaviors

Requirements: 1.1-1.4 (Auto-Scroll), 2.1-2.4 (Streaming), 3.1-3.4 (User-Initiated).

[x] 3.1 Add auto-scroll to bottom logic - Implemented `shouldAutoScroll` (stick && atBottom && !editingActive). useRafFn batches smooth scroll for new appended messages; threshold configurable via `autoScrollThreshold` (default 100). - Requirements: 1.1, 1.2; Map to Req 1.

[x] 3.2 Integrate streaming scroll maintenance - watchEffect on isStreaming triggers nextTick scrollToBottom (non-smooth) only when shouldAutoScroll true; ignored when user disengaged or editing. - Requirements: 2.1, 2.2, 2.4; Map to Req 2.

[x] 3.3 Handle manual scrolling and editing - Passive scroll, wheel, touch listeners disengage sticky on upward delta; `editingActive` prop suppresses auto-scroll; returning to bottom + next content growth re-sticks. - Requirements: 3.1, 3.2, 3.4; Map to Req 3.

[x] 3.4 Enhance virtualization with scroll - Added dynamic average item size estimation (moving average) feeding `effectiveItemSize`; passive listeners maintained; range emission unchanged. Scroll position preserved by conditional snapping only when sticky. - Requirements: 4.1-4.3; Map to Req 4.

## 4. Add Error Handling and Logging

Requirements: 6.4 (Error Handling), 7 (Non-Functional).

[x] 4.1 Implement ServiceResult pattern for scroll operations - 4.1.1 Wrap performScroll in try-catch with logger from @core/engine/logger.ts. - 4.1.2 Handle errors like ref null or ResizeObserver failure (fallback to watch on messages). - Requirements: 6.4; Map to all.

[x] 4.2 Add logging for scroll events - 4.2.1 Log warnings for jank-prone scenarios (e.g., frequent RAF calls). - 4.2.2 Use standardized logger for errors. - Requirements: 7 (Maintainability).

## 5. Update ChatContainer.vue

Requirements: 1.3, 4.4 (Integration).

[x] 5.1 Simplify ChatContainer scroll refs - VirtualMessageList now receives :is-streaming and emits scroll-state; ChatContainer no longer performs custom scroll logic beyond padding. - Requirements: 4.4; Map to Req 1, 3.

[x] 5.2 Integrate with other components - Editing lifecycle events (begin/cancel/save) tracked; auto-scroll suppressed while any message editing. ReasoningAccordion expansion handled by existing ResizeObserver in VirtualMessageList (no jumps observed in tests). - Requirements: 3.3, 6.3; Map to Req 3.

## 6. Testing and Validation

Requirements: 5.4 (Performance Metrics), 6.1-6.5 (Bug-Free and Jank Elimination).

[x] 6.1 Update existing unit tests - 6.1.1 AutoScrollBehavior.test.ts updated & passing with new logic. - 6.1.2 (Partial) Assertions cover scroll retention & snapping; add explicit isAtBottom/scrollToBottom spy in follow-up. - Requirements: 6.5; Map to Req 1, 4.

[x] 6.2 Add integration tests for streaming and jank - 6.2.1 ChatContainer.streamingJank.test.ts updated (rapid streaming pinned bottom, disengaged stability, re-engage, batching). - 6.2.2 ChatContainer.virtualization.test.ts expanded (split correctness, mid-list stability, bottom auto-scroll, boundary shift). - 6.2.3 Batching verified via deferred rAF (single scrollTo invocation on burst). - Requirements: 6.1, 5.4; Map to Req 2.

[ ] 6.3 Add new tests for edge cases - 6.3.1 Test empty chat, manual scroll disable, editing without scroll. - 6.3.2 Performance test: Benchmark FPS during 100-message load using Vitest performance. - 6.3.3 Browser compatibility: Test in Chrome/Safari mocks if possible. - Requirements: 6.2, 5.5; Map to Req 3, 7.

[ ] 6.4 Run full test suite - 6.4.1 Execute `bunx vitest run` to ensure all tests pass. - 6.4.2 Fix any failures by adjusting implementations (do not skip or modify tests). - Requirements: 6.5.

[ ] 6.5 Performance benchmarking - 6.5.1 Use browser dev tools to measure layout thrashing before/after. - 6.5.2 Verify <16ms per frame during streaming. - Requirements: 5.4, 7 (Performance).

## 7. Code Review and Cleanup

Requirements: 5.1 (Code Reduction), 7 (Maintainability, Scalability).

[ ] 7.1 Verify code reduction - 7.1.1 Count lines removed (target: 70% from useAutoScroll and related). - 7.1.2 Remove dead code (e.g., unused watchers). - Requirements: 5.1.

[ ] 7.2 Ensure scalability and accessibility - 7.2.1 Test with 10k messages: No degradation. - 7.2.2 Add ARIA attributes for scroll announcements if needed. - Requirements: 7 (Scalability, Accessibility).

[ ] 7.3 Documentation updates - 7.3.1 Update docs/streaming-core.md with new scroll architecture. - 7.3.2 Add comments in VirtualMessageList.vue for VueUse usage. - Requirements: 7 (Maintainability).

## 8. Final Review and Merge

[ ] 8.1 Comprehensive review - 8.1.1 Cross-check against requirements: All acceptance criteria met? - 8.1.2 Test manually: Load chat, stream, scroll up/down, edit message. - Requirements: 4 (Review overall plan).

[ ] 8.2 Merge and deploy - 8.2.1 Commit changes with descriptive messages. - 8.2.2 Push to main and test in development server. - Requirements: General.
