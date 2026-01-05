# Continue Feature - Implementation Tasks

## Overview

Implementation checklist for adding the Continue feature to resume interrupted chat streams. Tasks are ordered by dependency.

---

## 1. Expose Error Field in UI Messages

> **Requirements**: 2.1, 2.2, 2.3

### 1.1 Update UiChatMessage Interface
- [ ] Add `error?: string | null` field to `UiChatMessage` interface in `app/utils/chat/uiMessages.ts` (line ~51)
- [ ] Add `error?: string | null` field to `RawMessageLike` interface in `app/utils/chat/uiMessages.ts` (line ~30)

### 1.2 Map Error in ensureUiMessage
- [ ] In `ensureUiMessage` function, extract error from `raw.error` or `raw.data?.error`
- [ ] Include `error` in the returned `UiChatMessage` object (around line 203)

### 1.3 Map Error in History Loading
- [ ] In `app/utils/chat/history.ts`, add `error: dbMsg.error ?? null` to the mapped message object (around line 38)

---

## 2. Persist Partial Assistant on Stream Error

> **Requirements**: 1.1, 1.2, 1.3, 1.4

### 2.1 Modify Stream Error Handler in useAi.ts
- [ ] Locate the catch block for non-abort stream errors (lines ~1321-1366)
- [ ] In the `else` branch (non-abort error handling, line ~1352):
  - [ ] Add condition: if `tailAssistant.value?.text` has content
  - [ ] Set `tailAssistant.value.error = 'stream_interrupted'`
  - [ ] Call `db.messages.update(tailAssistant.value.id, { error: 'stream_interrupted', updated_at: nowSec() })`
  - [ ] Keep `tailAssistant.value` (don't set to null) so message remains visible
- [ ] Ensure the existing behavior (delete empty assistant) remains for `text.length === 0`

### 2.2 Update UiChatMessage Type in useAi.ts
- [ ] Ensure `tailAssistant` ref can hold messages with `error` property
- [ ] Import `nowSec` from `~/db/util` if not already imported (it is at line 4)

---

## 3. Add Continue Button in ChatMessage.vue

> **Requirements**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### 3.1 Add Continue Event to Emit Definition
- [ ] Add `(e: 'continue', id: string): void` to the `defineEmits` type (around line 340)

### 3.2 Add showContinueButton Computed
- [ ] Create computed property that returns `true` when:
  - `props.message.role === 'assistant'`
  - `props.message.error` is truthy
  - `props.message.text?.length > 0`

### 3.3 Add continueButtonProps Computed
- [ ] Create button props using `useThemeOverrides` pattern (similar to `retryButtonProps`)
- [ ] Use icon: `useIcon('chat.message.continue').value` with fallback `'heroicons:play-20-solid'`
- [ ] Color: `'success'` to differentiate from retry

### 3.4 Add onContinue Handler
- [ ] Create `onContinue` function that calls `emit('continue', props.message.id)`

### 3.5 Add Continue Button to Template
- [ ] Add `<UTooltip>` with `<UButton>` after the Retry button in the action bar (around line 276)
- [ ] Use `v-if="showContinueButton"` to conditionally render
- [ ] Set tooltip text to "Continue"
- [ ] Wire `@click` to `onContinue`

---

## 4. Implement continueMessage in useAi.ts

> **Requirements**: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7

### 4.1 Create continueMessage Function Skeleton
- [ ] Add `async function continueMessage(messageId: string, modelOverride?: string)` after `retryMessage` (around line 1597)
- [ ] Add early return guards: `if (loading.value || !threadIdRef.value) return`

### 4.2 Load Target Assistant Message
- [ ] Fetch message from DB: `const target = await db.messages.get(messageId)`
- [ ] Validate: `target.role === 'assistant'` and `target.thread_id === threadIdRef.value`
- [ ] Extract existing text using `deriveMessageContent`

### 4.3 Build Message Context
- [ ] Load all messages up to and including target (by index)
- [ ] Convert to OpenRouter format using existing patterns from `sendMessage`
- [ ] Add transient continuation instruction:
  ```typescript
  orMessages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Please continue your previous response from where you left off.' }],
  });
  ```

### 4.4 Execute Streaming
- [ ] Set `loading.value = true`, reset `aborted.value`, create new `AbortController`
- [ ] Set up `tailAssistant.value` with existing message content and `pending: true`
- [ ] Call `openRouterStream` with the built context
- [ ] In stream loop, append new text to `current.text`

### 4.5 Handle Success
- [ ] Update DB: `db.messages.update(messageId, { data: {..., content: current.text}, error: null, updated_at: nowSec() })`
- [ ] Clear `current.error`

### 4.6 Handle Errors
- [ ] In catch block: preserve accumulated text, keep error flag set
- [ ] Update DB with partial content if text exists

### 4.7 Cleanup in Finally
- [ ] Set `loading.value = false`
- [ ] Clear `pending` flag on `tailAssistant`
- [ ] Nullify `abortController.value`

### 4.8 Export continueMessage
- [ ] Add `continueMessage` to the return object (around line 1670)

---

## 5. Wire Continue Event in ChatContainer.vue

> **Requirements**: 5.1, 5.2

### 5.1 Add Event Handler to Template
- [ ] Add `@continue="onContinue"` to `<LazyChatMessage>` component (around line 41)

### 5.2 Create onContinue Handler
- [ ] Add function after `onRetry` (around line 620):
  ```typescript
  function onContinue(messageId: string) {
      if (!chat.value || chat.value?.loading?.value) return;
      chat.value.continueMessage(messageId, model.value);
      nextTick(() => scroller.value?.refreshMeasurements?.());
  }
  ```

---

## 6. Update Tests

> **Requirements**: 6.1, 6.2, 6.3

### 6.1 Add Stream Error with Partial Text Test
- [ ] In `app/pages/_tests/use-ai.vue`, add new test case or modify existing `stream-error` test
- [ ] Mock a stream that sends partial text before failing
- [ ] Verify assistant message is persisted with `error` field set
- [ ] Verify message text is preserved

### 6.2 Update Existing stream-error Test Expectation
- [ ] The current test expects only user message (lines 711-718)
- [ ] If test sends no text before error, behavior unchanged
- [ ] Add variant that sends partial text to test new behavior

### 6.3 Add Continue Flow Test (Optional)
- [ ] Test that `continueMessage` appends new tokens
- [ ] Test that error is cleared on success
- [ ] Test that error persists on continuation failure

---

## 7. Add Icon Configuration (Optional)

### 7.1 Register Continue Icon
- [ ] Add `chat.message.continue` icon mapping in theme/icon configuration
- [ ] Fallback is `heroicons:play-20-solid`

---

## Summary

| Task Group | Files Modified | Est. Lines Changed |
|------------|----------------|-------------------|
| 1. UI Message Error Field | `uiMessages.ts`, `history.ts` | ~10 |
| 2. Stream Error Persistence | `useAi.ts` | ~15 |
| 3. Continue Button | `ChatMessage.vue` | ~40 |
| 4. continueMessage Function | `useAi.ts` | ~80 |
| 5. Wire ChatContainer | `ChatContainer.vue` | ~8 |
| 6. Tests | `use-ai.vue` | ~30 |
| **Total** | **5 files** | **~180 lines** |

---

## Verification Checklist

After implementation, verify:

- [ ] Partial text preserved on stream error
- [ ] Error flag visible in dev tools on failed message
- [ ] Continue button appears only on failed assistant messages with text
- [ ] Continue button does not appear on user messages
- [ ] Continue button does not appear on successful assistant messages
- [ ] Clicking Continue resumes generation and appends text
- [ ] After successful Continue, error flag is cleared
- [ ] Page reload preserves failed state and Continue option
- [ ] Retry still works as expected (unchanged behavior)
- [ ] Abort still works as expected (unchanged behavior)
