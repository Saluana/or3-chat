# Chat stabilization tasks

A concise, checkable plan to make chat behavior correct, reactive, and performant. I’ll check items off as we complete them.

Legend: [ ] todo, [x] done, [~] optional

## 0) Current progress snapshot

-   [x] ChatContainer re-initializes useChat when threadId changes (watch + shallowRef)
    -   File: `app/components/chat/ChatContainer.vue`
    -   Status: Implemented
-   [ ] All other tasks pending

---

## 1) Fix thread selection event mismatch (critical)

Goal: Ensure clicking a thread in the sidebar updates the page `threadId`.

-   Files:
    -   `app/pages/chat.vue`
    -   `app/components/sidebar/SideNavContent.vue`

Tasks:

-   [ ] Standardize the event name between child and parent.
    -   Minimal fix: In `chat.vue`, listen to the existing camelCase event.
        -   Change: `<sidebar-side-nav-content @chatSelected="onChatSelected" />`
    -   [x] Minimal fix applied: `chat.vue` now listens for `@chatSelected`.
    -   [~] Alternative: Switch to kebab-case consistently (child emits `'chat-selected'`, parent listens `@chat-selected`). Choose one and apply to both files.

Acceptance:

-   [x] Clicking a sidebar item calls `onChatSelected` and sets `threadId`.

---

## 2) Keep ChatContainer messages in sync on thread and history changes

Goal: No stale/empty messages after switching threads or after async history load.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [x] Also react to `props.messageHistory` changes (implemented):
    -   Used the direct-assignment approach in `ChatContainer.vue`:
        -   `chat.value.messages.value = [...(props.messageHistory || [])]`
    -   (Alternative re-init approach is still valid if you prefer.)
-   [ ] Remove reliance on parent `:key` remount (optional) once the above sync is in place.

Acceptance:

-   [x] Switching threads updates the list immediately.
-   [x] Messages do not flicker or show stale content.

---

## 3) Propagate new thread id created on first send

Goal: When sending a first message without a selected thread, a new thread is created and the page learns its id.

-   Files:
    -   `app/composables/useAi.ts`
    -   `app/components/chat/ChatContainer.vue`
    -   `app/pages/chat.vue`

Tasks:

-   [x] In `useAi.ts`, make `threadId` reactive:
    -   Use `const threadIdRef = ref(threadId)`; update `threadIdRef.value` when creating a thread.
    -   Return `threadId: threadIdRef` from `useChat`.
-   [x] In `ChatContainer.vue`:
    -   Watch the returned `chat.value.threadId` and emit upward when it transitions from falsy to a real id, e.g., `emit('thread-selected', id)`.
-   [x] In `chat.vue`:
    -   Listen for `@thread-selected` from `ChatContainer` and set page-level `threadId`.

Acceptance:

-   [x] Sending the first message when no thread is selected creates a thread and binds the UI to it.

---

## 4) Use stable keys for message rendering

Goal: Avoid DOM reuse glitches and ensure predictable rendering.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [ ] Update `v-for` key to a stable identifier:
    -   Prefer DB `message.id`.
    -   Fallback: `message.stream_id` for streaming assistant placeholders.
    -   As a last resort: a composite key such as `${index}-${message.role}` only if no ids exist yet (not ideal for long-term).

Acceptance:

-   [ ] No warning about duplicate/unstable keys; UI remains stable during updates and streaming.

---

## 5) Improve Dexie query performance and ordering

Goal: Efficiently fetch ordered messages per thread without client-side resort.

-   Files:
    -   `app/db/client.ts` (Dexie schema; add an index)
    -   `app/pages/chat.vue`

Tasks:

-   [x] Add a compound index to messages: `[thread_id+index]`.
-   [x] Query ordered messages via the compound index:
    -   Replace `.where('thread_id').equals(id).sortBy('index')` with
        `.where('[thread_id+index]').between([id, Dexie.minKey], [id, Dexie.maxKey]).toArray()`.
-   [x] Remove extra JS sorting when possible.

Acceptance:

-   [x] Message fetch is ordered and fast on large datasets.

---

## 6) Wire up "New Chat" button

Goal: Create a new thread and select it immediately.

-   Files:
    -   `app/components/sidebar/SideNavContent.vue`
    -   `app/pages/chat.vue`

Tasks:

-   [ ] Implement click handler on New Chat:
    -   Create a thread via `create.thread({ title: 'New Thread', ... })`.
    -   Emit upward the new id (`emit('chatSelected', newId)` or kebab-case version).
-   [ ] Parent `chat.vue` sets `threadId` in `onChatSelected` and fetches messages.

Acceptance:

-   [ ] Clicking New Chat opens an empty conversation bound to the new thread id.

---

## 7) Streaming write optimization (optional but recommended)

Goal: Reduce write amplification during assistant streaming while remaining correct.

-   File: `app/composables/useAi.ts`

Tasks:

-   [x] Throttle `upsert.message` during streaming (e.g., 50–150ms) and ensure a final upsert at end.
-   [x] Keep hooks (`ai.chat.stream:action:delta`) intact.

Acceptance:

-   [x] Noticeably fewer writes during long responses without losing final content.

---

## 8) Loading UX and input state

Goal: Visual feedback and prevent duplicate sends while streaming.

-   File: `app/components/chat/ChatContainer.vue`

Tasks:

-   [x] Bind `loading` to disable send UI or show a subtle spinner/typing indicator.
-   [x] Guard `onSend` to no-op while `loading` is true.

Acceptance:

-   [x] Input disabled/indicates streaming; no duplicate sends mid-stream.

---

## 9) Delete semantics consistency (soft vs hard)

Goal: Predictable UX for delete vs trash.

-   Files:
    -   `app/components/sidebar/SideNavContent.vue`
    -   `app/db/index.ts` (only if changing which API is used)

Tasks:

-   [ ] Choose a policy:
    -   Soft delete: Use `del.soft.thread(id)` and filter out `deleted` in lists (current UI already filters).
    -   Hard delete: Keep current hard delete but adjust copy to warn it’s permanent and ensure no other code expects soft-deleted items.
-   [ ] Apply consistently in menu actions and list queries.

Acceptance:

-   [ ] Delete behavior matches the chosen policy across UI and data layer.

---

## 10) Minor schema and docs polish (optional)

Goal: Align expectations and reduce surprises.

-   Files:
    -   `app/composables/useAi.ts` (model default consistency with docs)
    -   `app/db/schema.ts` (only if relaxing URL constraints for attachments)

Tasks:

-   [~] Align default model id with docs or update docs to reflect `'openai/gpt-oss-120b'`.
-   [~] If needed, relax `AttachmentSchema.url` to allow `blob:`/`data:`/relative URLs, or validate upstream.

Acceptance:

-   [ ] Docs and defaults align; attachment storage behavior is intentional.

---

## File-by-file quick reference

-   `app/pages/chat.vue`

    -   [ ] Fix event listener name (`@chatSelected` or kebab-case strategy)
    -   [ ] Optional: remove `:key` remount after child sync is robust
    -   [ ] Switch to compound-index query once available

-   `app/components/sidebar/SideNavContent.vue`

    -   [ ] Event name consistency with parent
    -   [ ] Implement New Chat creation and emit id
    -   [ ] Decide and apply delete policy (soft vs hard)

-   `app/components/chat/ChatContainer.vue`

    -   [x] Re-init `useChat` on `threadId` change (done)
    -   [ ] Sync messages on `messageHistory` change
    -   [ ] Stable `v-for` keys (prefer `message.id`)
    -   [ ] Use `loading` to disable input / show indicator
    -   [ ] Emit upward when thread id is created by `useChat`

-   `app/composables/useAi.ts`

    -   [ ] Return reactive `threadId` (ref)
    -   [ ] Throttle streaming upserts (optional)
    -   [~] Model default/docs alignment

-   `app/db/client.ts`

    -   [ ] Add `[thread_id+index]` index for messages

-   `app/db/index.ts`

    -   [ ] No code change required unless delete policy changes (then switch to soft/hard helpers accordingly)

-   `app/db/schema.ts`
    -   [~] Optional: relax `AttachmentSchema.url` if non-absolute URLs are used

---

## Acceptance checklist (end-to-end)

-   [ ] Clicking a thread selects it and loads messages quickly
-   [ ] New Chat creates and selects a new thread with empty history
-   [ ] Switching threads shows the correct messages without flicker
-   [ ] First send without a thread creates one and binds the UI to it
-   [ ] Streaming is smooth; input disabled; minimal DB writes
-   [ ] Delete behavior matches chosen policy consistently
-   [ ] No console errors; keys stable; queries efficient

---

Notes:

-   Prefer minimal-diff fixes first (event name, message sync) to restore core functionality, then ship performance and UX improvements.
-   If you want me to start executing, I’ll begin with Section 1 and 2 and validate the flow live.
