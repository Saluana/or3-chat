# Continue Feature for Interrupted Chat Responses

## Introduction

When a chat stream fails mid-generation (e.g., network drop, API timeout), the current behavior deletes any partial assistant content, leaving users with no way to recover what was already generated. This feature adds a **Continue** option that:

1. Preserves partial assistant text when a stream error occurs
2. Marks the message as failed (using existing `Message.error` field)
3. Shows a "Continue" button to resume generation seamlessly in the same bubble
4. Appends new tokens to the existing assistant message without creating a new user message

## Requirements

### 1. Persist Partial Assistant on Stream Error

**User Story**: As a user, I want my partial assistant response to be saved when a network error interrupts generation, so that I don't lose valuable content.

**Acceptance Criteria**:
- WHEN a non-abort stream error occurs AND the assistant message has `text.length > 0` THEN the assistant message SHALL be preserved in the database
- WHEN a non-abort stream error occurs AND the assistant message has `text.length > 0` THEN `Message.error` SHALL be set to a truthy value (e.g., "stream_interrupted")
- WHEN a non-abort stream error occurs AND the assistant message has `text.length === 0` THEN the assistant message SHALL be deleted (current behavior)
- WHEN the user aborts the stream THEN the current abort behavior SHALL be preserved unchanged

### 2. Expose Error Flag in UI Messages

**User Story**: As a developer, I want the error state to be available in `UiChatMessage`, so that UI components can render appropriate actions.

**Acceptance Criteria**:
- WHEN a raw message has an `error` field THEN `UiChatMessage.error` SHALL contain that value
- WHEN loading messages from history THEN the `error` field SHALL be properly mapped from the database record
- WHEN `error` is present THEN it SHALL be a string (matching schema: `z.string().nullable().optional()`)

### 3. Continue Button in Chat Message Action Bar

**User Story**: As a user, I want to see a Continue button on failed assistant messages, so that I can resume generation from where it stopped.

**Acceptance Criteria**:
- WHEN an assistant message has `error` truthy AND `text.length > 0` THEN a Continue button SHALL be displayed
- WHEN a user message has an error THEN the Continue button SHALL NOT be displayed
- WHEN an assistant message has no error THEN the Continue button SHALL NOT be displayed
- WHEN the Continue button is clicked THEN a `continue` event SHALL be emitted with the message ID
- The Continue button SHALL be visually distinct from the Retry button
- The Continue button tooltip SHALL read "Continue"

### 4. Continue Message Flow

**User Story**: As a user, I want Continue to resume generation seamlessly, appending new text to my partial response without creating extra messages.

**Acceptance Criteria**:
- WHEN `continueMessage(messageId)` is called THEN the existing assistant message SHALL be reused (same ID)
- WHEN continuing THEN new tokens SHALL be appended to the existing `text` content
- WHEN continuing THEN NO new user message SHALL be created in the database
- WHEN continuing THEN a transient continuation instruction (e.g., "Please continue your previous response.") SHALL be passed to the model input but NOT persisted
- WHEN the continuation completes successfully THEN `Message.error` SHALL be cleared (set to null)
- WHEN the continuation fails THEN the partial text SHALL be preserved and error SHALL remain set
- WHEN continuing THEN the model context SHALL include all previous messages in the thread

### 5. Wire Continue Event in ChatContainer

**User Story**: As a developer, I want the Continue event to be properly wired from ChatMessage to the chat composable.

**Acceptance Criteria**:
- WHEN ChatMessage emits a `continue` event THEN ChatContainer SHALL call `continueMessage(messageId, model.value)`
- WHEN `continueMessage` is not exposed from `useChat` THEN it SHALL be added to the return object

### 6. Test Expectations

**User Story**: As a developer, I want tests to verify the new Continue behavior.

**Acceptance Criteria**:
- The `stream-error` test SHALL be updated to verify partial assistant content is retained
- The test SHALL verify the assistant message has `error` set
- A new test SHALL verify the Continue flow works end-to-end (optional but recommended)
