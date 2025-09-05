# TL;DR (do these first)

1. Throttle DB writes during streaming.
2. Defer sidebar docs + build search index lazily/idle.
3. Kill the deprecated `SidebarProjectTree.vue` and render projects in the existing virtual list.
4. Don’t render both sidebars at once — switch `v-show` → `v-if`.
5. Standardize on the new `useStreamAccumulator` and retire `TailStream`.
6. Clean up/modernize sidebar height/resize logic (no leaky listeners).
7. Normalize message content shape (array-of-parts).
8. Lazy-load non-critical modals/editors.
9. Actively free message state on thread switch.
10. Remove unused runtime packages (ai SDK, hljs, marked-highlight, tokenizer).

Below is the detailed, intern-friendly task list with exact files, what to change, and why.

---

# Top 10 ASAP Tasks (ordered by your priorities: memory → initial load → UI response → render speed)

## 1) Throttle DB writes during assistant streaming (biggest jank/mem win)

**Files:** `app/utils/chat/openrouterStream.ts` (or wherever `sendMessage` streaming loop lives)
**What/Why:** You’re persisting the streaming assistant message every **100ms**; cut that to \~300–500ms and gate by “meaningful bytes changed” to reduce main-thread pressure and IndexedDB churn while streaming. That makes the stream feel smoother and reduces memory pressure during long outputs.
**How:**

-   Find the loop where stream events are handled; you define `const WRITE_INTERVAL_MS = 100;` and call `upsert.message(...)` on a timer (see the constant and pattern here). &#x20;
-   Change `WRITE_INTERVAL_MS` to `300` or `500`.
-   Also track `newCharsSinceLastFlush` and only flush if `>= 50` (or if ≥2s elapsed as a max cap). Pseudocode:

    ```ts
    const WRITE_INTERVAL_MS = 300;
    const MAX_INTERVAL_MS = 2000;
    let lastPersistAt = 0;
    let charsSince = 0;

    // on each token:
    charsSince += delta.length;

    const now = performance.now();
    if (
        (now - lastPersistAt >= WRITE_INTERVAL_MS && charsSince >= 50) ||
        now - lastPersistAt >= MAX_INTERVAL_MS
    ) {
        await upsert.message(updated);
        lastPersistAt = now;
        charsSince = 0;
    }
    ```

-   Keep the **final** post-stream `upsert.message(...)` (you already do it) so nothing is lost.&#x20;

## **DONE**

## 2) Defer docs + build search index on demand/idle (faster startup, less RAM)

**Files:** `app/composables/sidebar/useSidebarSearch.ts` (and sidebar loader)
**What/Why:** `ensureIndex()` builds Orama maps + index for **threads/projects/docs**; building all at boot hurts first paint and memory when users only want chat. Build on first search or during `requestIdleCallback`. &#x20;
**How:**

-   Don’t subscribe to **documents** until the user opens the Docs section or types in the search input.
-   In the search composable:

    -   keep the current lazy `import('@orama/orama')`,
    -   trigger `ensureIndex()` only on first user query, **and** schedule a background `ensureIndex()` during idle (e.g., `requestIdleCallback(() => ensureIndex())`) to pre-warm without blocking TTI.

-   On empty search, return simple lists (you already do).&#x20;

---

## xxxx

---

## 4) Don’t render **both** sidebars (expanded + collapsed) at once

**File:** `app/components/layout/ResizableSidebarLayout.vue`
**What/Why:** You currently `v-show` both the expanded and collapsed versions. That mounts two component trees and doubles memory/CPU at startup. Swap to `v-if`/`v-else` so only one exists. See the `v-show="collapsed"` block here.&#x20;
**How:**

-   Change:

    ```vue
    <div v-show="!collapsed">…</div>
    <div v-show="collapsed">…</div>
    ```

    to:

    ```vue
    <div v-if="!collapsed">…</div>
    <div v-else>…</div>
    ```

-   Preserve minimal state across toggles (search text, selection) via a parent ref if needed.

## **DONE BUT HYBRID**

## 5) Standardize on `useStreamAccumulator` and retire `TailStream`

**Files:**

-   **Adopt:** `app/composables/useStreamAccumulator.ts` (new, rAF-batched) &#x20;
-   **Retire later:** `app/components/chat/TailStream.vue`, `app/composables/useTailStream.ts` (still used today) &#x20;
    **What/Why:** The accumulator batches to ≤1 DOM write per frame across text/reasoning, reducing reactivity churn and post-stream hiccups.
    **How:**
-   Wire the streaming loop to `streamAcc.append(delta, { kind: 'text'|'reasoning' })` and call `streamAcc.finalize()` once.
-   Replace `<TailStream …/>` with a unified component that reads `streamAcc.state.text` and `state.version`.
-   Once all paths use the accumulator, remove TailStream files/imports.

---

## 6) Fix/modernize sidebar resize/height calculations (prevent leaks)

**Files:** `app/components/sidebar/SideNavContent.vue` (or wherever `listHeight`/resize is managed)
**What/Why:** Old code uses manual `window.addEventListener('resize', …)` with tricky cleanup; use `ResizeObserver`/VueUse `useElementSize` instead to avoid leaks and redundant calc passes. (Prevents long-session memory creep; makes the virtual list height reliable.)
**How:**

-   Replace manual listeners with:

    ```ts
    const { height } = useElementSize(containerRef);
    watch(height, () => recomputeListHeight());
    ```

-   If you keep window listeners, **add** `onUnmounted(() => window.removeEventListener('resize', measure))`.

## **DONE**

## 7) Normalize message content to a **single** shape (array of parts)

**Files:** `app/composables/chat/useChat.ts`, `app/components/chat/ChatMessage.vue`
**What/Why:** Today messages can be string **or** `ContentPart[]`; that branches logic in streaming and render. Using `[ { type:'text', text } ]` always keeps code paths shallow and speeds updates (fewer type checks/copies).
**How:**

-   When creating/updating messages in the stream loop (you already update either string or first text part), standardize on an array: if it’s a string, wrap it; always append to the first text part. You already have the code branches here; collapse them to always use an array.&#x20;
-   In ChatMessage, create `contentArray = computed(() => Array.isArray(message.content) ? … : [{type:'text', text: message.content as string}])` and render from that.

---

## 8) Lazy-load heavy modals and editors (lower initial JS/memory)

**Files:** `PageShell.vue` and modals (settings, system prompts), TipTap editor components
**What/Why:** You already lazy-load some sidebar pieces; extend the pattern to **all** modals and the document editor so chat-only users don’t pay for editor code.
**How:**

-   Convert modal imports to async:

    ```ts
    const SettingsModal = defineAsyncComponent(
        () => import('~/components/SettingsModal.vue')
    );
    ```

    Render only under `v-if="open"`.

-   Ensure the TipTap editor (docs mode) is only imported when a doc pane mounts (your `LazyDocumentsDocumentEditor` should do this; verify).
-   Keep Orama already lazy-imported for search (good).&#x20;

---

## 9) Free large message arrays on thread switch (memory hygiene)

**Files:** `ChatContainer.vue`, `useChat`
**What/Why:** If a pane switches threads, old messages should be released to GC, not sit in refs.
**How:**

-   Recreate the chat pane component with a `:key="threadId"` so Vue unmounts old state when switching threads, or
-   Expose `chat.clear()` in `useChat` that sets `messages.value = []` and call it before loading the new thread.
-   Abort any in-flight streams (`abortController.abort()`), then load the new history.

---

## 10) Remove unused runtime packages (smaller bundle, less mem)

**What/Why:** These showed no imports in this snapshot and duplicate built-in functionality:

-   `ai`, `@openrouter/ai-sdk-provider` (you stream OpenRouter manually) — your send path + auth are custom.&#x20;
-   `highlight.js`, `marked-highlight` (no `hljs.*` calls; Streamdown does its own DOM post-processing).
-   `gpt-tokenizer` (no references).
    **How:**
-   In `package.json` remove: `"ai"`, `"@openrouter/ai-sdk-provider"`, `"highlight.js"`, `"marked-highlight"`, `"gpt-tokenizer"`.
-   Move `@types/spark-md5` to `devDependencies`.
-   `bun i && bun build` to confirm no missing imports.

---

## Bonus micro-cleanup (do opportunistically)

-   Delete dead commented blocks in Streamdown post-processing (table wrapper/highlight leftovers) to shrink client code.
-   Add 1-line comments to magic numbers (e.g., recent non-virtual count, stream finalize thresholds) for future maintainers.

---

## Impact mapping (why this order)

-   **Memory usage:** #1, #2, #4, #5, #8, #9, #10
-   **Initial load time:** #2, #4, #8, #10
-   **Faster UI response:** #1, #5, #6, #7
-   **Render speed:** #1, #3, #4, #5

If you want, I can prep a single commit per task with diffs and a quick “test plan” checklist for each, so your intern can land them one by one without breaking flow.
