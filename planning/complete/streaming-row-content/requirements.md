# Requirements

## Introduction

Remove conversation-sized array copies from streaming display updates in `ChatContainer.vue`. Change the chat/scroller contract together so the visible message continues updating with a stable list reference. This is a small rendering optimization with explicit regression checks.

## Context

The app uses Nuxt 4, Vue 3, Bun, Vitest, and the published `or3-scroll@0.1.1` package. `ChatContainer.vue` already caches stable history and identity lookup, but copies history when replacing the streaming tail. The scroller's `visibleItems` computed caches a slice by array identity and viewport indexes; its structural watcher separately maintains keys and measurements. Source is available in the sibling `or3-vsc` repository. Existing chat tests mock the scroller; the scroll browser canary uses the real package but its streaming fixture also copies the list. Reviewed docmap entries: `useChat`, `uiMessages`, and `useMessageMediaPrefetch`.

## Assumptions

- Prefer one optional scroller prop over introducing a keyed message store.
- Optimize updates where the stable projection and tail key are unchanged. Existing history/workflow projection replacements may still rebuild the list.
- Implement and validate the scroller contract before enabling it in chat; chat consumes built package exports, not sibling source automatically.
- This task produces planning documents only.

## Out of Scope

Auth, persistence, sync, stream transport, batching cadence, overscan tuning, and a general message-state refactor. No package publication or application implementation is performed by this plan.

## Requirements

### R1: Bounded content updates

**User Story:** As a user with a long conversation, I want streaming display work to avoid copying my message history.

**Acceptance Criteria:**
- R1.AC1: WHEN the stable projection and tail key are unchanged THEN chat SHALL retain the combined array reference and stable row references while replacing only the tail object.
- R1.AC2: WHEN that update is signaled THEN the scroller SHALL refresh current mounted slot content without a full-list scan, keyed reconciliation, or measurement reset; list projection work SHALL be O(1) in chat and O(W) in the scroller, where W is the current render window.

### R2: Correct rows and transitions

**User Story:** As a chat user, I want each response and its status to remain current throughout streaming and navigation.

**Acceptance Criteria:**
- R2.AC1: WHEN a same-key tail changes THEN its mounted row SHALL show the latest text, reasoning, pending state, tool calls, and attachments after the normal Vue render flush, without remounting the keyed row.
- R2.AC2: WHEN the tail is absent, added, replaced with a different key, finalized, aborted, or deduplicated against stable history by id or stream_id THEN displayed rows SHALL match the existing projection rules without duplicates or stale content.
- R2.AC3: WHEN history changes, older history is prepended, a stable message is edited, workflow state changes, or the thread/tab changes THEN the existing list replacement and content-epoch behavior SHALL remain effective; an offscreen updated row SHALL show its latest content when mounted.

### R3: Scroll and consumer compatibility

**User Story:** As a user of chat and other virtualized lists, I want content updates to preserve navigation behavior.

**Acceptance Criteria:**
- R3.AC1: WHEN streaming grows a row while following the bottom THEN existing measurement handling SHALL keep bottom distance within the configured 5px threshold after settling; WHILE browsing or editing, updates SHALL preserve the visible anchor within the existing canary tolerance.
- R3.AC2: WHEN callers omit the optional revision prop THEN existing items-array behavior SHALL continue working in both mutation modes; WHEN content changes THEN stable keys, media rendering/prefetch, and content-key resets SHALL retain their existing semantics.
- R3.AC3: WHEN chat adopts the new contract THEN its resolved package artifact and exported types SHALL include the prop, verified with real-scroller rendering coverage.
