# Retry Feature Plan

## Overview

Add a **Retry** mechanism allowing a user message from anywhere in a thread to be re-run. The original occurrence (the user message and its assistant reply, if any) is removed from its current position and a new send happens at the end of the thread (bottom of chat) producing a fresh assistant response with current context.

## Current Message Ordering Summary

-   Messages stored in Dexie `messages` table with sparse `index` per thread (1000 increments) via compound index `[thread_id+index]`.
-   UI loads ordered messages in `pages/chat.vue` using this compound index and filters out `deleted`.
-   `appendMessage` assigns `last.index + 1000` (or 1000 for first) ensuring O(1) append without reindex.
-   `useChat.sendMessage` persists a user message (role `user`), then creates a streaming placeholder assistant message (role `assistant`).
-   `ChatContainer.vue` maps DB `msg.data.content` to display string; `ChatMessage.vue` currently receives no `id` so action buttons lack context.

## Scope (V1)

-   Retry only for USER messages.
-   Removes the targeted user message and its immediate assistant reply (if adjacent and same thread) before re-sending.
-   Reuses original user text & file attachments (via `file_hashes`).
-   Creates new user + assistant messages appended at the bottom (normal flow).
-   Hard delete originals (simple; soft delete/undo can be future enhancement).

## Assumptions

1. Assistant reply to remove is the first assistant message after the user in the same thread (if present & not deleted).
2. If no assistant reply exists (e.g. failed/aborted) only the user message is removed.
3. Attachments referenced by `file_hashes` remain valid; reusing hashes does not require ref count change (DB schema leaves file tracking as-is).
4. Retrying while another stream is active is disallowed (guard with `loading`).

## Edge Cases

-   Retrying last pair (already at bottom): still remove & append for consistent audit trail.
-   User message with no assistant yet: just remove + resend.
-   Non-user (assistant) retry click: ignored or disabled in UI for V1.
-   Missing DB record (race / already deleted): show toast & abort gracefully.
-   Concurrent retries: second blocked due to `loading` or internal flag.

## Data Flow Steps (Retry)

1. User clicks Retry on a user message.
2. Emit event including `messageId` from `ChatMessage.vue`.
3. `ChatContainer.vue` handles `retry` event → calls `chat.retryMessage(id)`.
4. `useChat.retryMessage`:
    - Guard `loading`.
    - Fetch user message from DB (`queries.getMessage` OR `db.messages.get`). Verify `role === 'user'` and same active `threadId`.
    - Find assistant reply: first message in same thread with `index > user.index` and `role === 'assistant'` & not deleted.
    - Dexie transaction: hard delete user + assistant (if any) using `del.hard.message` (or direct `db.messages.delete`).
    - Update local `messages` array: remove entries matching these `id`s.
    - Parse `file_hashes` (string -> string[] via existing `parseFileHashes`).
    - Call existing `sendMessage(originalUserText, { model: currentModel, file_hashes: parsedHashes })`.
    - (Optional) Hook notifications before/after.

## UI Changes

-   Pass `id` (and existing `file_hashes`) through `ChatContainer` mapping to each `ChatMessage` prop.
-   Update `ChatMessage.vue` prop definition to include `id` (in the UI message type).
-   Add `defineEmits(['retry'])` and emit on Retry button click with `props.message.id`.
-   Optionally disable Retry button for assistant messages: `:disabled="props.message.role !== 'user'"` or conditional render.

## Composable Changes (`useChat`)

Add `retryMessage(messageId: string): Promise<void>`:

```ts
async function retryMessage(messageId: string) {
    if (loading.value) return;
    const userMsg = await db.messages.get(messageId);
    if (
        !userMsg ||
        userMsg.role !== 'user' ||
        userMsg.thread_id !== threadIdRef.value
    )
        return;
    // find assistant reply
    const assistant = await db.messages
        .where('[thread_id+index]')
        .between(
            [userMsg.thread_id, userMsg.index + 1],
            [userMsg.thread_id, Dexie.maxKey]
        )
        .filter((m) => m.role === 'assistant' && !m.deleted)
        .first();
    await db.transaction('rw', db.messages, async () => {
        await db.messages.delete(userMsg.id);
        if (assistant) await db.messages.delete(assistant.id);
    });
    // purge local array
    messages.value = messages.value.filter(
        (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
    );
    // reuse hashes
    const hashes = userMsg.file_hashes
        ? parseFileHashes(userMsg.file_hashes)
        : [];
    await sendMessage((userMsg.data as any)?.content || '', {
        model: currentModel.value,
        file_hashes: hashes,
    });
}
```

(Exact code will integrate existing imports & error handling.)

## Hooks (Optional V1)

-   `ai.chat.retry:action:before` (payload: originalUserId, assistantId?, threadId)
-   `ai.chat.retry:action:after` (payload: originalUserId, newUserId, newAssistantId?, threadId)

## Testing Scenarios

1. Middle pair retry: removed and re-appended at bottom; order stable; indexes sparse.
2. Last pair retry: re-added as new last pair (ids change).
3. User-only (no assistant) retry: new user+assistant appear; original removed.
4. Concurrent stream: Retry button disabled (or ignored) while `loading`.
5. Attachment presence: hashes preserved; thumbnails still resolve in new message.

## Non-Goals / Future Enhancements

-   Assistant-only regenerate (keep user, replace assistant in place / append) – future.
-   Branching a thread at a historical message (Branch button) – separate feature.
-   Undo retry / soft delete – future.
-   Normalizing indexes post-delete (not required due to sparse allocation).

## Implementation Checklist

-   [x] Extend `RenderMessage` in `ChatContainer.vue` to keep `id` & pass to `<ChatMessage />`.
-   [x] Update `ChatMessage.vue` props + emit `retry` event.
-   [x] Wire `@retry` handler in `ChatContainer.vue` → `chat.retryMessage`.
-   [x] Implement `retryMessage` in `useChat` with DB + local state logic.
-   [x] Add optional hooks (before/after) for retry lifecycle.
-   [ ] Disable / conditionally show Retry for non-user messages in UI (expanded to allow assistant retry, intentional).
-   [ ] Smoke test edge cases listed above.

## Decision Points (Confirmed Defaults)

-   Delete both user + immediate assistant reply (if exists).
-   Hard delete (simpler) for V1.
-   Retry limited to user messages for first iteration.

---

Prepared for implementation. Adjust any assumptions above before coding if needed.
