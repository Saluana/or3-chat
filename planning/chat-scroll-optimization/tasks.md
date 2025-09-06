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

[ ] 1.1 Install or verify VueUse dependency - Run `bun add @vueuse/core` if not present. - Update package.json if needed. - Requirements: 5.1 (Code Reduction).

[ ] 1.2 Review and backup current implementation - Read and document current useAutoScroll.ts and ChatContainer.vue scroll logic. - Create a branch for the refactor (e.g., `git checkout -b chat-scroll-opt`). - Requirements: 6.1 (Bug-Free).

[ ] 1.3 Update tsconfig paths if adding new types (e.g., scroll.ts) - Add import aliases if needed for new files. - Requirements: 7 (Maintainability).

## 2. Remove and Refactor Custom Scroll Logic

Requirements: 5.1-5.3 (Performance and Code Reduction), 4.1-4.4 (Virtualization Integration).

[ ] 2.1 Eliminate useAutoScroll.ts composable - 2.1.1 Remove all watchers, computed properties, and RAF batching from useAutoScroll.ts. - 2.1.2 Delete the file after migrating logic. - 2.1.3 Update imports in ChatContainer.vue to remove reference. - Requirements: 5.2, 5.3; Map to Req 1, 2.

[ ] 2.2 Remove useRafBatch.ts if redundant - 2.2.1 Replace custom batching with VueUse's useRafFn in VirtualMessageList. - 2.2.2 Test for equivalent behavior in batched updates. - 2.2.3 Delete useRafBatch.ts. - Requirements: 5.2; Map to Req 3 (User-Initiated Scrolling).

[ ] 2.3 Centralize scroll state in VirtualMessageList.vue - 2.3.1 Add ref for container element. - 2.3.2 Implement useScroll from VueUse to track ScrollState (isAtBottom, etc.). - 2.3.3 Add useResizeObserver to detect height changes from messages/streaming. - Requirements: 4.1, 4.2; Map to Req 2 (Streaming).

## 3. Implement Optimized Scroll Behaviors

Requirements: 1.1-1.4 (Auto-Scroll), 2.1-2.4 (Streaming), 3.1-3.4 (User-Initiated).

[ ] 3.1 Add auto-scroll to bottom logic - 3.1.1 Create computed `shouldAutoScroll` based on isAtBottom and new message additions. - 3.1.2 Use useRafFn to schedule smooth scrollTo({ top: scrollHeight, behavior: 'smooth' }) when shouldAutoScroll is true. - 3.1.3 Handle threshold (100px) for "near bottom" detection. - Requirements: 1.1, 1.2; Map to Req 1.

[ ] 3.2 Integrate streaming scroll maintenance - 3.2.1 Watch isStreaming prop and message content changes via watchEffect. - 3.2.2 If at bottom during streaming, auto-scroll incrementally after nextTick for DOM settles. - 3.2.3 If not at bottom, ignore height changes from streaming. - Requirements: 2.1, 2.2, 2.4; Map to Req 2.

[ ] 3.3 Handle manual scrolling and editing - 3.3.1 Add passive 'scroll' event listener via useScroll to detect user scrolls (delta > threshold disables auto). - 3.3.2 Integrate with useMessageEditing: Pause auto-scroll during edits unless adding new content. - 3.3.3 Re-enable auto-scroll when user returns to bottom. - Requirements: 3.1, 3.2, 3.4; Map to Req 3.

[ ] 3.4 Enhance virtualization with scroll - 3.4.1 Update virtual scroller props to use dynamic estimatedItemSize based on ResizeObserver. - 3.4.2 Preserve scroll position on virtual item changes (e.g., using scrollToIndex if library supports). - 3.4.3 Ensure passive listeners to avoid blocking. - Requirements: 4.1-4.3; Map to Req 4.

## 4. Add Error Handling and Logging

Requirements: 6.4 (Error Handling), 7 (Non-Functional).

[ ] 4.1 Implement ServiceResult pattern for scroll operations - 4.1.1 Wrap performScroll in try-catch with logger from @core/engine/logger.ts. - 4.1.2 Handle errors like ref null or ResizeObserver failure (fallback to watch on messages). - Requirements: 6.4; Map to all.

[ ] 4.2 Add logging for scroll events - 4.2.1 Log warnings for jank-prone scenarios (e.g., frequent RAF calls). - 4.2.2 Use standardized logger for errors. - Requirements: 7 (Maintainability).

## 5. Update ChatContainer.vue

Requirements: 1.3, 4.4 (Integration).

[ ] 5.1 Simplify ChatContainer scroll refs - 5.1.1 Remove direct scroll handling; pass messages, isStreaming as props to VirtualMessageList. - 5.1.2 Add onScrollStateChange emit from child if needed for UI (e.g., "scroll to bottom" button). - 5.1.3 Update template to use VirtualMessageList without inline styles for scroll. - Requirements: 4.4; Map to Req 1, 3.

[ ] 5.2 Integrate with other components - 5.2.1 Ensure ReasoningAccordion expansion doesn't trigger unwanted scrolls (use ResizeObserver on container only). - 5.2.2 Test with MessageEditor: No scroll during edits. - Requirements: 3.3, 6.3; Map to Req 3.

## 6. Testing and Validation

Requirements: 5.4 (Performance Metrics), 6.1-6.5 (Bug-Free and Jank Elimination).

[ ] 6.1 Update existing unit tests - 6.1.1 Modify AutoScrollBehavior.test.ts and VirtualMessageList.test.ts to use new VueUse logic. - 6.1.2 Add assertions for isAtBottom and scrollToBottom calls. - Requirements: 6.5; Map to Req 1, 4.

[ ] 6.2 Add integration tests for streaming and jank - 6.2.1 Update ChatContainer.streamingJank.test.ts: Simulate rapid streaming, assert no position jumps. - 6.2.2 Test virtualization with ChatContainer.virtualization.test.ts: Verify position preservation. - 6.2.3 Use vi.spyOn(useRafFn) to mock and test batching. - Requirements: 6.1, 5.4; Map to Req 2.

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
