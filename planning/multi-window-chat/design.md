# Multi-Window Chat Design

artifact_id: c5fbba63-6f6e-4ab0-9d5d-cf822d4d5a9f

## 1. Overview

Add lightweight support for up to three side-by-side chat panes within `ChatPageShell.vue`. Each pane encapsulates its own `threadId`, `messageHistory`, and loading lifecycle. The shell maintains an array of pane states and an `activePaneIndex`. Existing sidebar emits (thread selection, new chat) are redirected to the active pane only. Minimal new code; reuse existing `loadMessages` logic with slight refactor to operate per-pane.

## 2. Architecture & Flow

-   Component: Enhance `ChatPageShell.vue` only (no new global stores). Introduce reactive `panes: PaneState[]` instead of single `threadId` and `messageHistory`.
-   PaneState: `{ id: string; threadId: string; messages: ChatMessage[]; validating: boolean }` (id = local uuid for v-for key, separate from threadId).
-   Active pane tracking via `activePaneIndex: Ref<number>`.
-   New window: push blank PaneState if length < 3, set active to new index.
-   Close window: splice index; adjust `activePaneIndex` to nearest valid (min 0).
-   Sidebar selection: calls `setPaneThread(activePaneIndex, threadId)`.
-   Loading messages: extracted helper `loadMessagesFor(threadId): Promise<ChatMessage[]>` (reuse existing DB code). Pane-specific function assigns to `panes[i].messages`.

### Sequence (Sidebar selects thread)

1. Sidebar emits `chatSelected(id)`.
2. `onSidebarSelected` -> `setPaneThread(activePaneIndex, id)`.
3. Function updates pane.threadId then awaits load -> assigns messages.
4. UI re-renders only that pane's ChatContainer.

## 3. Component Structure

```
ChatPageShell
  - Top bar (New Window, Theme Toggle)
  - Flex row container (.panes) with 1-3 Pane wrappers
       PaneWrapper (div, tabindex, border highlight if active)
         ChatContainer (existing props: message-history, thread-id, events)
```

## 4. Data Structures / Types (TypeScript)

```ts
interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    file_hashes?: string | null;
    id?: string;
    stream_id?: string;
}

interface PaneState {
    id: string; // local pane uuid
    threadId: string; // current thread ('' = empty / new chat)
    messages: ChatMessage[];
    validating: boolean; // reserved (if we keep validateInitial logic)
}
```

## 5. Key Reactive State

```ts
const panes = ref<PaneState[]>([createEmptyPane()]);
const activePaneIndex = ref(0);
```

Helper:

```ts
function createEmptyPane(): PaneState {
    return {
        id: crypto.randomUUID(),
        threadId: '',
        messages: [],
        validating: false,
    };
}
```

## 6. Core Functions

```ts
async function loadMessagesFor(threadId: string): Promise<ChatMessage[]> {
    /* existing logic moved & returning array */
}

async function setPaneThread(i: number, threadId: string) {
    const pane = panes.value[i];
    if (!pane) return;
    pane.threadId = threadId;
    pane.messages = await loadMessagesFor(threadId);
}

function addPane() {
    if (panes.value.length >= 3) return;
    panes.value.push(createEmptyPane());
    activePaneIndex.value = panes.value.length - 1;
}

function closePane(i: number) {
    if (panes.value.length === 1) return;
    panes.value.splice(i, 1);
    if (activePaneIndex.value >= panes.value.length)
        activePaneIndex.value = panes.value.length - 1;
}

function setActive(i: number) {
    activePaneIndex.value = i;
}
```

Sidebar integration:

```ts
function onSidebarSelected(threadId: string) {
    setPaneThread(activePaneIndex.value, threadId);
}
function onNewChat() {
    const p = panes.value[activePaneIndex.value];
    p.threadId = '';
    p.messages = [];
}
```

ChatContainer thread-created event:

```ts
function onInternalThreadCreated(newId: string, paneIndex: number) {
    const p = panes.value[paneIndex];
    if (p && p.threadId !== newId) setPaneThread(paneIndex, newId);
}
```

Pass pane index via inline handler in template.

## 7. Template Adjustments

-   Replace single ChatContainer with `v-for="(pane,i) in panes"`.
-   Wrapper div flex with `:class="['pane', i===activePaneIndex ? 'pane-active':'']"`.
-   Add close button inside each wrapper (condition: panes.length>1) top-right overlay.
-   Modify New Window button to call `addPane` (disable if length===3).
-   Active styles: Tailwind classes e.g. `border-2 border-primary shadow-sm` vs `border border-transparent`.

## 8. Keyboard & Focus

-   `tabindex="0"` on pane wrapper.
-   `@focus="setActive(i)" @click="setActive(i)"`.
-   Key handler on wrapper: ArrowLeft/ArrowRight adjust `activePaneIndex` within bounds.

## 9. Minimal Styling

Utility classes only:

```
.flex-row.panes { display:flex; width:100%; height:100%; }
.pane { @apply flex-1 relative overflow-hidden border transition-colors; }
.pane-active { @apply border-primary; }
```

(Implement inline / scoped style additions inside component to avoid external file.)

## 10. Error Handling

-   DB failures fallback: return empty array; console.warn only.
-   Guard indices; no thrown errors.

## 11. Testing Strategy (Lightweight)

-   Manual / basic unit tests (if framework present) not required for initial simplicity.
-   Quick checks:
    1. Add panes until 3, ensure 4th click no-op.
    2. Close middle pane; indices shift; active handled.
    3. Load different threads in different panes; switch active; sidebar loads only active.
    4. Keyboard Arrow navigation changes active border.

## 12. Future Extension Hooks

-   Persist panes array (threadIds) to local storage or IndexedDB.
-   Introduce draggable resizing between panes.
-   Support heterogeneous pane types (editor vs chat) by adding `type` to PaneState.

## 13. Risks / Mitigations

-   Risk: Existing logic tightly coupled to single threadId variables. Mitigation: Encapsulate old functions; keep original names backward compatible if used elsewhere (they are currently local so refactor is safe).
-   Risk: Extra reactivity causing unnecessary loads. Mitigation: Only load when threadId set through helper; no watchers needed.

## 14. Definition of Done

-   Up to 3 panes appear; New Window works / disabled at 3.
-   Each pane independent; highlight & keyboard focus works.
-   Sidebar selections target active pane only.
-   Close extra panes works without layout break.
-   Code remains under ~150 added lines (target) and confined to `ChatPageShell.vue`.
