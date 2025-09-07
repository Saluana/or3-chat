# Chat Scrolling Optimization Requirements

## Introduction

This document outlines the requirements for optimizing the scrolling behavior in the chat application, specifically targeting the ChatContainer.vue component and the useAutoScroll.ts composable. The current implementation suffers from performance issues, jank during streaming and message updates, and excessive code complexity due to multiple watchers, RAF batches, and duplicated logic with virtualization. The optimization aims to make scrolling more performant by reducing code volume, eliminating jank, ensuring bug-free behavior, and leveraging VueUse utilities where beneficial, while preserving all existing functionality (auto-scroll to bottom, maintain position during edits/streaming if not at bottom, smooth virtualization).

The scope includes:

-   Functional requirements for scrolling behaviors in chat interactions.
-   Non-functional requirements for performance, reliability, and maintainability.
-   Coverage of edge cases like rapid message additions, streaming updates, and user-initiated scrolling.

## Requirements

### 1. Auto-Scroll to Bottom on New Messages

As a chat user, I want the chat view to automatically scroll to the bottom when a new message is added, so that I can immediately see the latest content without manual intervention.

Acceptance Criteria:

-   WHEN a new message is appended to the message list AND the user is currently scrolled to the bottom (within a 100px threshold), THEN the view SHALL smoothly scroll to the bottom of the VirtualMessageList.
-   WHEN a new message is appended AND the user is not at the bottom, THEN the view SHALL NOT alter the current scroll position.
-   WHEN multiple messages are added rapidly (e.g., during initial load), THEN the scroll SHALL batch updates using requestAnimationFrame to avoid jank and ensure smooth positioning.
-   IF the VirtualMessageList height changes due to new messages, THEN the scroll SHALL adjust dynamically without causing layout thrashing.

### 2. Maintain Scroll Position During Streaming

As a chat user, I want the scroll position to remain stable during message streaming updates, so that ongoing content generation does not disrupt my view.

Acceptance Criteria:

-   WHEN a message is actively streaming (content accumulating) AND the user is at the bottom, THEN the view SHALL continuously scroll to keep the latest streamed content visible without jank.
-   WHEN streaming updates occur AND the user is not at the bottom, THEN the scroll position SHALL remain unchanged, preserving the user's focus on earlier content.
-   WHEN streaming completes, THEN the final scroll adjustment SHALL be smooth and batched to prevent flickering or jumps.
-   IF streaming involves markdown rendering or attachments, THEN scroll updates SHALL only trigger after DOM mutations settle (using nextTick or ResizeObserver).

### 3. Handle User-Initiated Scrolling and Editing

As a chat user, I want manual scrolling and message editing to not interfere with auto-scroll, so that I can review history without unwanted jumps.

Acceptance Criteria:

-   WHEN the user manually scrolls up (beyond the bottom threshold), THEN subsequent auto-scroll SHALL be disabled until the user scrolls back to the bottom.
-   WHEN editing an existing message (e.g., via MessageEditor), THEN the scroll position SHALL be maintained, and no auto-scroll SHALL occur unless the edit adds new content at the bottom.
-   WHEN the user scrolls back to the bottom after manual scrolling, THEN auto-scroll SHALL re-enable for future updates.
-   IF virtualization is active, THEN scroll handling SHALL account for virtual item heights without recalculating all items unnecessarily.

### 4. Virtualization Integration

As a developer, I want scrolling to integrate seamlessly with VirtualMessageList, so that performance remains high even with thousands of messages.

Acceptance Criteria:

-   WHEN using VirtualMessageList, THEN scroll events SHALL be handled passively to avoid blocking the main thread.
-   WHEN the estimated height of the virtual list changes, THEN scroll position SHALL be preserved or adjusted based on content delta without full re-renders.
-   IF the user scrolls near the top or bottom, THEN pre-fetching or buffer adjustments SHALL not cause jank.
-   THEN all scrolling logic SHALL be centralized in VirtualMessageList or a single composable, eliminating duplication from useAutoScroll.

### 5. Performance and Code Reduction

As a developer, I want the scrolling implementation to be lightweight and efficient, so that it doesn't contribute to high CPU usage or bundle size.

Acceptance Criteria:

-   WHEN messages update, THEN the number of scroll-related watchers and computed properties SHALL be reduced by at least 50% compared to the current implementation.
-   WHEN using VueUse utilities (e.g., useResizeObserver, useRafFn), THEN custom RAF batching in useRafBatch SHALL be removable or simplified.
-   IF custom useAutoScroll logic can be replaced with VueUse's useScroll or useVirtualScroll, THEN the composable SHALL be eliminated to reduce code by at least 70%.
-   THEN performance metrics SHALL show reduced layout thrashing (measurable via browser dev tools) during streaming and batch updates.
-   WHEN running in low-end devices, THEN scroll animations SHALL remain smooth (60fps) without jank.

### 6. Bug-Free and Jank Elimination

As a chat user, I want scrolling to be reliable and smooth, free from visual glitches or unexpected behaviors.

Acceptance Criteria:

-   WHEN rapid streaming occurs (e.g., high token rate), THEN no horizontal or vertical jank SHALL occur, verified by existing tests like ChatContainer.streamingJank.test.ts.
-   IF edge cases like empty chat, single message, or attachment-heavy messages are tested, THEN scroll SHALL behave correctly without errors or infinite loops.
-   WHEN integrating with other components (e.g., ReasoningAccordion expansion), THEN scroll SHALL not jump unexpectedly.
-   THEN all changes SHALL pass existing tests for virtualization and auto-scroll behavior, with additional tests for jank-free streaming.
-   IF browser compatibility issues arise (e.g., Safari vs. Chrome), THEN polyfills or fallbacks SHALL ensure consistent behavior.

### 7. Non-Functional Requirements

-   **Performance**: Scrolling operations SHALL complete in under 16ms per frame to maintain 60fps.
-   **Maintainability**: Code SHALL be reduced by consolidating into fewer functions/composables, with clear comments on VueUse integrations.
-   **Scalability**: Handle up to 10,000 messages without performance degradation, leveraging virtualization.
-   **Accessibility**: Scroll actions SHALL respect keyboard navigation and screen reader announcements without conflicts.
-   **Error Handling**: Any scroll failures (e.g., due to DOM not ready) SHALL log errors via the standardized logger and fallback to manual positioning.
