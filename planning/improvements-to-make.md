Here’s a ruthless, no-nonsense list of the **top 12 fixes** that will most improve mobile UX right now. Each task includes exact files, variables, and step-by-step instructions, plus a quick acceptance checklist.

---

# 1) Make the input bar keyboard-safe on iOS (stop the 40–80px jump)

**Goal:** Fix the chat input so it doesn’t float up when the iOS keyboard shows/hides.
**Files:** `src/components/ChatContainer.vue`, `src/components/ChatInputDropper.vue` (or wherever your input lives)
**Key vars/props:** `chatInputHeight` (or add one), list container ref

**Steps**

-   Change the chat root container to use `min-h-[100dvh]` (not `h-screen`).
-   On **mobile only**, render the input container as `position: fixed; left:0; right:0; bottom: max(0px, env(safe-area-inset-bottom));`.
-   In `ChatInputDropper.vue`, emit its **live height** whenever the textarea grows/shrinks (use a `ResizeObserver`).
-   In the messages list wrapper, bind `style="padding-bottom: ${inputHeight}px"` so the list never hides behind the fixed input.

**Acceptance**

-   On iOS Safari, open keyboard → input stays glued to the bottom, list doesn’t reflow or hide content.

## ** DONE **

# 2) Replace vh with dvh everywhere the viewport height matters

**Goal:** Stop layout jumps when the URL bar/keyboard shows.
**Files:** Any layout using `h-screen`/`100vh` — e.g., `src/layouts/ResizableSidebarLayout.vue`, `src/views/ChatView.vue`
**Steps**

-   Replace `h-screen` / `height: 100vh` with `min-h-[100dvh]` (or CSS `min-height: 100dvh`).
-   Keep desktop behavior unchanged.

**Acceptance**

-   No vertical jump when scrolling in/out of the address bar or focusing inputs on iOS.

## ** DONE **

# 3) Safe auto-scroll: don’t yank the user to bottom mid-scroll

**Goal:** Only snap to bottom if the user was _recently_ at bottom and isn’t interacting.
**Files:** `src/composables/useAutoScroll.ts` (or wherever you control it), `VirtualMessageList.vue`
**Key vars:** `stick`, `atBottom`, `scrollToBottom()`

**Steps**

-   Track `userScrolling` (set true on `touchstart` / `wheel`, set false via `setTimeout` \~800ms).
-   Track `lastBottomAt` timestamp whenever the list is within \~24px of bottom.
-   In your “stream chunk arrived” handler: `if (stick && !userScrolling && Date.now()-lastBottomAt < 1200) scrollToBottom()`.
-   Add CSS: message list wrapper `overflow-anchor: auto;` and the streaming tail container `overflow-anchor: none;`.

**Acceptance**

-   While a message streams, you can scroll up and stay there; when you return near bottom, it resumes snapping.

---

# 4) Gate the streaming tail by **content**, not a boolean flag

**Goal:** Stop rendering a blank “ghost” message at end of stream.
**Files:** `src/components/ChatContainer.vue` (where the tail `<ChatMessage>` is used), `src/components/TailStream.vue`
**Key vars:** `streamActive`, `tailContent`, `tailReasoning`

**Steps**

-   Replace `v-if="tailActive"` with `v-if="streamActive && (tailContent?.length || tailReasoning?.length)"`.
-   In stream completion, clear `tailContent`/`tailReasoning` **before** turning off `streamActive` (order matters for one extra frame).

**Acceptance**

-   No empty block appears after a message finishes streaming.

---

# 5) Lower virtualization `item-size-estimation` and add `content-visibility: auto`

**Goal:** Reduce scroll jumps and improve perf on long chats.
**Files:** `src/components/VirtualMessageList.vue` and the parent binding in `ChatContainer.vue`
**Key props:** `item-size-estimation`, `overscan`

**Steps**

-   Set `:item-size-estimation="96"` (start conservative; 128 if your items are chunky).
-   Add `style="content-visibility: auto"` to the row wrapper element inside the virtual list.
-   On mobile, use `overscan=2` or `3`; on desktop, `4–6`.

**Acceptance**

-   Smoother scroll on iOS; fewer “teleport” jumps as new chunks arrive.

---

# 6) Persist sidebar open/closed state; default **closed** on mobile

**Goal:** Kill the “randomly open on load” side-nav on phones.
**Files:** `src/layouts/ResizableSidebarLayout.vue` (or wherever the sidenav lives)
**Key vars:** `open` (boolean), sidebar toggle

**Steps**

-   On mount: read `localStorage.getItem('sidebarOpen')`.
-   If no value and `matchMedia('(max-width: 768px)').matches` → `open=false`, else `open=true`.
-   `watch(open, v => localStorage.setItem('sidebarOpen', v ? '1' : '0'))`.

**Acceptance**

-   Mobile loads with nav closed; it stays consistent across reloads.

---

# 7) Remove any global `body { overflow-y: hidden }` from component scopes

**Goal:** Prevent iOS scroll traps and rubber-banding bugs.
**Files:** Search scoped `<style>` blocks for `body { overflow: hidden/clip }`, common culprits in layout components.
**Steps**

-   Delete global body overflow rules in component styles.
-   Apply overflow control to the **chat viewport container only** (e.g., `.chat-scroll { overflow-y: auto; }`).

**Acceptance**

-   You can always scroll the chat on iOS; no input/overlay traps.

---

# 8) Consolidate “Create Document” submit path (dedupe double-creates)

**Goal:** Stop double document creation.
**Files:** `src/components/modals/CreateDocumentModal.vue` (or wherever you submit)
**Key vars:** `creatingDocument` (new), your `submitCreateDocument()` function

**Steps**

-   Use **either** `@submit.prevent` on the `<form>` **or** `@keyup.enter` on the input — not both. Prefer the form.
-   Add a latch:

    ```ts
    let creatingDocument = false;
    async function submitCreateDocument() {
        if (creatingDocument) return;
        creatingDocument = true;
        try {
            /* create */
        } finally {
            creatingDocument = false;
        }
    }
    ```

**Acceptance**

-   Hammer Enter quickly → exactly one document created.

---

# 9) Switch background image from pseudo-element to the container + add PNG fallback

**Goal:** Fix missing background on Mobile Safari due to stacking context.
**Files:** `src/layouts/ResizableSidebarLayout.vue` (or the container owning the tiled bg)
**Steps**

-   Move `background-image` to the **real container** (not `::before/::after`).
-   Use `image-set` fallback:

    ```css
    .bg-tiled {
        background-image: image-set(
            url('/bg.webp') type('image/webp') 1x,
            url('/bg.png') type('image/png') 1x
        );
        background-repeat: repeat;
        background-size: 256px 256px;
        transform: translateZ(0); /* Safari paint stability */
    }
    ```

**Acceptance**

-   Background shows on iOS reliably, including under overlays.

---

# 10) Add bottom sentinel (IntersectionObserver) for robust `atBottom` detection

**Goal:** Make “are we at bottom?” accurate even with keyboards/zoom/safe areas.
**Files:** `VirtualMessageList.vue` (or parent that owns the scroll container)
**Key vars:** `atBottom`, `stick`

**Steps**

-   Render `<div ref="bottomSentinel" style="height:1px"/>` after the last message/tail.
-   `new IntersectionObserver(([e]) => { atBottom.value = e.isIntersecting; if (e.isIntersecting) lastBottomAt = Date.now(); }, { root: scrollEl, threshold: 1 })`.
-   Replace pixel math checks with `atBottom`.

**Acceptance**

-   `atBottom` becomes true only when the last pixel is visible; snapping is predictable on iOS.

---

# 11) Debounce input-height and autoscroll work to one frame

**Goal:** Reduce layout thrash when the textarea grows while streaming.
**Files:** `ChatInputDropper.vue`, `useAutoScroll.ts`
**Steps**

-   Wrap height updates in `requestAnimationFrame`:

    ```ts
    const ro = new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() =>
            emit('resize', { height: el.offsetHeight })
        );
    });
    ```

-   Throttle `scrollToBottom()` calls: only schedule one per animation frame.

**Acceptance**

-   Typing or model streaming doesn’t cause judder on iOS; 60fps feel (or close).

---

# 12) Mobile tap-targets & “New messages ↓” pill when autoscroll paused

**Goal:** Better ergonomics + feedback while streaming.
**Files:** `ChatContainer.vue`, toolbar buttons in `ChatInputDropper.vue`, a small `NewChunksPill.vue`
**Steps**

-   Ensure controls at bottom have **44×44px** min size and spacing on `<md` screens.
-   When `atBottom = false` and new chunks arrive, show a floating pill “New messages ↓”; clicking it calls `scrollToBottom()` and hides it.

**Acceptance**

-   Buttons are easy to tap; when you scroll up during streaming, you get a clear, non-intrusive prompt to return to live.

---

## Bonus sanity checks (do these if you touch the files anyway)

-   **Fix any typos** like `messages.value = [.arr]` → `messages.value = [...arr]` in edit flows; JS errors can leave tail flags dirty.
-   **Add `overscroll-behavior-y: contain`** on the scroll container to prevent the “bounce back to OS” effect while flinging on iOS.
-   **Use `-webkit-text-size-adjust: 100%`** on the chat root to prevent Safari from resizing text after rotation/zoom.

---

Want me to generate **patch-ready diffs** for these (12 commits or one PR with 12 files touched)? Say the word and I’ll output the exact code changes block by block.
