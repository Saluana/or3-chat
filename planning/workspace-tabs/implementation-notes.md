# OR3 Chat Workspace Tabs
## Complex Integration Notes

**Status:** Implementation guidance  
**Target:** `Saluana/or3-chat`, branch `or3-cloud`  
**Related files:** `or3-workspace-tabs-plan.md`, `or3-workspace-tabs-tasks.md`  
**Prepared:** 2026-07-31

---

## 1. Purpose

This document focuses on the parts of the tab integration most likely to look simple at first and then produce subtle bugs:

- Drag reordering in an overflowing, variable-width tab strip.
- Switching rapidly between chats, documents, and custom pane apps.
- Keeping chat drafts, attachments, streaming jobs, and scroll state attached to the correct tab.
- Capturing and restoring document editor state without losing edits.
- Adding tab-scoped scroll restore to `or3-scroll` / `or3-vsc`.
- Closing, undoing, restoring, routing, and reconciling tabs with existing pane/plugin APIs.
- Avoiding stale async work, memory growth, hidden component trees, and focus regressions.

The code examples are proposed integration code. They are intentionally close to OR3's existing Vue/TypeScript style, but they are not presented as copy-paste patches against a specific commit.

---

## 2. The most important implementation rules

These rules should be treated as invariants, not visual preferences.

### 2.1 Tabs own navigation state; panes own mounted views

A tab owns:

- Resource identity.
- Tab order.
- Cached title and status.
- Draft/view state.
- Recently closed snapshot.
- Whether it is visible in a split.

A pane owns:

- A mounted chat, document editor, or pane app.
- Focus.
- Width.
- Runtime component/session handles.
- A binding to one tab.

A resource store owns:

- Chat messages.
- Thread records.
- Document content.
- Background jobs.
- Synced records.
- Durable save state.

Do not copy messages or full document content into the tab store.

### 2.2 Every async switch must be cancellable or generation-guarded

Switching A → B → C must always leave C active, even when:

- A's history load completes after C.
- B's document flush takes longer than C's load.
- A custom pane app creates an initial record late.
- Scroll restoration for A runs two animation frames later.
- A stale title or metadata request completes.

Use both:

- `AbortController` where the lower layer can actually stop work.
- A monotonically increasing activation generation to reject stale results.

An `AbortSignal` saves wasted work. A generation check protects correctness even when a dependency cannot be aborted.

### 2.3 Capture state before changing identity

Before a pane changes from tab A to tab B:

1. Capture A's synchronous local view state.
2. Make A's durable data safe.
3. Change the selected tab immediately.
4. Bind B.
5. Restore B only if the activation is still current.

Do not first change `threadId` / `documentId` and then try to infer what state belonged to the outgoing tab.

### 2.4 A tab switch must not imply “stop work”

Closing or hiding a chat tab must not automatically abort generation.

Generation belongs to the chat request/thread job layer, not to the mounted tab button or pane component. A tab can disappear while a background job continues.

### 2.5 Scroll restore must use stable item identity

`scrollTop` alone is insufficient for a virtual chat list because message heights can change due to:

- Streaming text.
- Reasoning sections.
- Images loading.
- Tool results expanding.
- Edited messages.
- History being prepended.
- Responsive width changes.

Store a keyed anchor plus an offset inside that item. Keep `scrollTop` only as a fallback.

### 2.6 Drag visuals and tab ordering are separate

During pointer movement:

- Keep the authoritative `tabs` array unchanged.
- Calculate visual transforms or a drop indicator.
- Commit one reorder on pointer release.

This prevents expensive reactive churn, repeated persistence writes, URL changes, and accidental content remounts.

### 2.7 Preserve stable geometry under the pointer

A tab close button should not move when it appears. A tab should not change width while it is being dragged. A closing tab should not cause the next close button to jump under the mouse before pointer release.

Reserve close-button space and freeze measured widths during a drag.

---

## 3. Research notes: codebases worth borrowing from

### 3.1 VS Code: view state is a memento, not the editor model

VS Code's `AbstractEditorWithViewState` captures editor view state:

- Before an editor closes.
- Before input is cleared.
- During shutdown.
- Explicitly when an editor is backgrounded without being disposed.

It associates the view state with both the resource and the editor group, while the underlying resource remains independently owned.

Its `EditorMemento` uses a bounded LRU cache instead of retaining every editor component indefinitely.

**OR3 takeaway:**

- Keep document/chat data in their existing stores.
- Keep tab/pane view state in a bounded memento store.
- Key view state by tab ID, with the resource ID and content revision included for validation.
- Capture at explicit lifecycle boundaries.
- Do not solve view-state restoration by mounting every hidden tab.

Sources:

- [VS Code editorWithViewState.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorWithViewState.ts)
- [VS Code editorPane.ts / EditorMemento](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPane.ts)

### 3.2 VS Code tabs: model-first updates and stable close geometry

VS Code's editor tabs separate the editor model from the tab rendering. Reordering updates the editor model and redraws the affected range. Its tab implementation also takes special care to prevent close buttons from shifting while the user is closing a sequence of tabs.

**OR3 takeaway:**

- The tabs array is authoritative.
- A drag preview is temporary presentation state.
- Commit the order once.
- Reveal the active tab after layout.
- Reserve close geometry.
- Batch title/status updates rather than rebuilding all tabs per event.

Sources:

- [VS Code multiEditorTabsControl.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts)
- [VS Code editorTabsControl.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorTabsControl.ts)

### 3.3 dnd-kit: transforms during drag, array move on drop

dnd-kit's sortable architecture keeps the rendered order stable while displaced items are transformed. It then commits the array move on drag end. Its sortable guidance also emphasizes:

- Activation constraints to distinguish click from drag.
- A keyboard path.
- Horizontal-list-specific strategies.
- Drag overlays for scrollable containers.

**OR3 takeaway:**

For the first tab bar, OR3 can implement the same principles in a small local controller without necessarily adding a dependency:

- Mouse movement threshold.
- Stable IDs.
- Transform-only preview.
- Commit on release.
- Keyboard Move Left / Move Right actions.
- Optional lightweight overlay.

If tab DnD later expands into cross-pane dragging, detached windows, touch reordering, or plugin drop targets, use a mature headless toolkit instead of growing a custom framework.

Sources:

- [dnd-kit repository](https://github.com/clauderic/dnd-kit)
- [dnd-kit sortable overview](https://github.com/clauderic/dnd-kit/blob/main/apps/docs/docs/legacy/presets/sortable/overview.mdx)

### 3.4 Atlassian Pragmatic Drag and Drop: edge intent is a pure function

Atlassian separates:

1. Which edge of the target the pointer is closest to.
2. What destination index that edge means.
3. The immutable reorder itself.

This is especially useful when moving forward in a list, where “drop before target” and “drop after target” need index correction after removal of the source item.

**OR3 takeaway:**

Keep hit testing and reorder math pure. Do not mutate the tabs array from `pointermove`.

Sources:

- [get-reorder-destination-index.ts](https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/hitbox/src/get-reorder-destination-index.ts)
- [reorder-with-edge.ts](https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/hitbox/src/reorder-with-edge.ts)
- [list-item.ts](https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/hitbox/src/list-item.ts)

### 3.5 React Virtuoso: restore virtualizer measurements and describe mutation intent

React Virtuoso's state snapshot includes measured size ranges as well as scroll offset. Its message-list API also treats scroll behavior as an explicit consequence of the data mutation:

- Initial item location.
- Append and conditional bottom-follow.
- Prepend while preserving position.
- Existing item changed height.
- Remove from start/end.
- Replace and purge old measurements.

**OR3 takeaway:**

- Exact in-session restoration benefits from a bounded measurement snapshot.
- Do not make one heuristic guess cover local send, remote append, streaming growth, prepend, and conversation switch.
- At minimum, expose explicit capture/restore.
- Longer term, pass a mutation reason or policy to `Or3Scroll`.

Sources:

- [React Virtuoso stateLoadSystem.ts](https://github.com/petyosi/react-virtuoso/blob/main/packages/react-virtuoso/src/stateLoadSystem.ts)
- [Virtuoso Message List scroll modifiers](https://github.com/petyosi/react-virtuoso/blob/main/packages/message-list/docs/20.scroll-modifier.md)

### 3.6 ProseMirror: selections have serializable and map-friendly forms

ProseMirror selections can be serialized to JSON. It also has the concept of a lightweight selection bookmark that can be mapped through document changes and later resolved, with a fallback when the original selection is no longer valid.

**OR3 takeaway:**

- While an editor remains alive, use a live bookmark if useful.
- For an unmounted tab, store selection JSON plus a document revision/version.
- Restore only when the saved selection is compatible with the current document.
- Fall back to a safe nearby cursor rather than throwing or blocking activation.

Source:

- [ProseMirror selection.ts](https://github.com/ProseMirror/prosemirror-state/blob/master/src/selection.ts)

### 3.7 OR3 Scroll: the right foundation already exists

`or3-vsc` already has unusually strong foundations:

- Explicit scroll modes.
- Internal scroll ownership.
- Keyed anchoring.
- Layout compensation.
- Content, measurement, jump, reset, and frame generations.
- Prepend/append paths.
- Batched ResizeObserver updates.
- Estimated jump followed by measured correction.

The tab work should extend these concepts rather than add DOM poking in `ChatContainer`.

Sources:

- [Or3Scroll.vue](https://github.com/Saluana/or3-vsc/blob/master/src/lib/components/Or3Scroll.vue)
- [Or3Scroll public types](https://github.com/Saluana/or3-vsc/blob/master/src/lib/components/types.ts)
- [useScrollJump.ts](https://github.com/Saluana/or3-vsc/blob/master/src/lib/composables/useScrollJump.ts)
- [or3-scroll audit](https://github.com/Saluana/or3-vsc/blob/master/dumb-issues.md)

---

## 4. State ownership matrix

Use this table when deciding where a new field belongs.

| State | Owner | Key | Persist across reload? |
|---|---|---|---:|
| Tab order | Workspace tab store | Workspace/profile | Yes |
| Active tab | Workspace tab store | Workspace/profile | Yes |
| Pane-to-tab binding | Workspace tab host | Runtime pane ID | Reconstructed |
| Pane width | Existing multi-pane state | Pane position/profile | Existing behavior |
| Chat messages | DB / `useChat` | Thread ID | Yes |
| AI background job | Background job tracker | Thread/request/message | Yes where supported |
| Chat composer text | Tab draft store | Tab ID | In-memory v1 |
| Composer TipTap JSON | Tab draft store | Tab ID | In-memory v1 |
| Unsent attachment lease | Tab draft store | Tab ID | In-memory v1 |
| Chat scroll anchor | Tab view-state store | Tab ID | Optional lightweight restore |
| Document content/title | Document store | Document ID | Yes |
| Document selection/scroll | Tab view-state store | Tab ID + document revision | Optional |
| Find/inspector open state | Tab view-state store | Tab ID | In-memory |
| Pane component refs | Tab host | Runtime pane ID | No |
| Recently closed tab | Bounded session stack | Workspace/profile | In-memory v1 |
| Tab title cache | Metadata resolver / snapshot | Resource key | Yes, as fallback |
| Streaming/saving indicator | Derived status store | Resource key | No |

A useful check:

> If two duplicate tabs show the same document at different scroll positions, should this field differ?

If yes, key it by `tabId`, not only `documentId`.

---

## 5. Switching tabs: use an activation transaction

### 5.1 Do not express switching as several unrelated watchers

A fragile implementation looks like:

```ts
activeTabId.value = tabId
pane.threadId = ...
watch(threadId, loadMessages)
watch(documentId, flushOldDocument)
watch(activeTabId, restoreScroll)
watch(route, replaceState)
```

Every watcher is individually reasonable, but their relative ordering is implicit. Rapid interaction can produce stale restoration, stale URL projection, or state captured under the wrong identity.

Use one explicit activation coordinator.

### 5.2 Recommended activation phases

For a hidden tab B being assigned to pane P:

#### Phase A — reserve activation

- Increment P's activation generation.
- Abort P's previous switch controller.
- Set selected tab state immediately.
- Render B's type-specific loading shell immediately.
- Mark P as binding B.

#### Phase B — capture outgoing tab A

This should be synchronous or locally durable:

- Chat composer draft.
- Chat scroll view state.
- Document editor JSON/title pending state.
- Document selection and scroll.
- Custom app state through an optional adapter.

Do not wait for cloud sync.

#### Phase C — bind B's resource

- Chat: use the existing `setPaneThread` / `useChat.switchThread`.
- Document: ensure the outgoing document is locally safe, then set the document.
- App: use `setPaneApp`.
- Await only the minimum required for the target to become coherent.

#### Phase D — verify ownership

After every `await`:

```ts
if (!activation.isCurrent()) return
```

#### Phase E — restore B

- Restore composer draft.
- Restore scroll after the scroller has reconciled keys.
- Restore document selection after the editor is ready.
- Restore focus only when the activation came from keyboard or an explicit focus command.

#### Phase F — project active route

- Replace the URL only when B is still active.
- Custom apps continue their existing route policy.
- Do not add browser history for every tab click.

### 5.3 Activation coordinator example

```ts
export interface PaneActivation {
    readonly paneId: string
    readonly generation: number
    readonly signal: AbortSignal
    isCurrent(): boolean
    throwIfStale(): void
}

export function createPaneActivationCoordinator() {
    const generations = new Map<string, number>()
    const controllers = new Map<string, AbortController>()

    function begin(paneId: string): PaneActivation {
        controllers.get(paneId)?.abort(
            new DOMException('Superseded tab activation', 'AbortError')
        )

        const controller = new AbortController()
        controllers.set(paneId, controller)

        const generation = (generations.get(paneId) ?? 0) + 1
        generations.set(paneId, generation)

        const isCurrent = () =>
            generations.get(paneId) === generation &&
            controllers.get(paneId) === controller &&
            !controller.signal.aborted

        return {
            paneId,
            generation,
            signal: controller.signal,
            isCurrent,
            throwIfStale() {
                if (!isCurrent()) {
                    throw new DOMException(
                        'Stale tab activation',
                        'AbortError'
                    )
                }
            },
        }
    }

    function cancel(paneId: string): void {
        controllers.get(paneId)?.abort()
        controllers.delete(paneId)
        generations.set(paneId, (generations.get(paneId) ?? 0) + 1)
    }

    return { begin, cancel }
}
```

### 5.4 Host activation example

```ts
async function activateTabInPane(
    tabId: string,
    paneId: string,
    reason: 'pointer' | 'keyboard' | 'restore' | 'command'
): Promise<void> {
    const tab = tabsById.value.get(tabId)
    const pane = getPaneById(paneId)
    if (!tab || !pane) return

    const activation = activationCoordinator.begin(paneId)
    const outgoingTabId = paneBindings.value.get(paneId)

    // Selection feedback should not wait for I/O.
    setFocusedPane(paneId)
    setActiveTab(tabId)
    setPendingBinding(paneId, tabId)

    try {
        if (outgoingTabId && outgoingTabId !== tabId) {
            captureTabViewState(outgoingTabId, paneId)
            await ensureOutgoingTabLocallySafe(outgoingTabId, {
                signal: activation.signal,
            })
            activation.throwIfStale()
        }

        await bindResourceToPane(pane, tab.resource, {
            signal: activation.signal,
            generation: activation.generation,
        })
        activation.throwIfStale()

        commitPaneBinding(paneId, tabId)

        await nextTick()
        activation.throwIfStale()

        await restoreTabViewState(tabId, paneId, {
            signal: activation.signal,
        })
        activation.throwIfStale()

        replaceProjectedRoute(tab.resource)

        if (reason === 'keyboard' || reason === 'command') {
            focusActivatedPaneWithoutStealingEditorSelection(paneId)
        }
    } catch (error) {
        if (isAbortError(error)) return

        rollbackPendingBinding(paneId, outgoingTabId)
        markTabActivationError(tabId, error)
        reportError(error, {
            tags: { domain: 'workspace-tabs', action: 'activate' },
        })
    } finally {
        clearPendingBindingIfOwned(
            paneId,
            tabId,
            activation.generation
        )
    }
}
```

### 5.5 Do not block selected styling on document flush

The user should see the tab become selected immediately. A slow flush cannot make the tab strip feel frozen.

The important distinction is:

- **Capture**: synchronously copy editor state into the document store.
- **Local durability**: ensure the pending state cannot disappear if the editor unmounts.
- **Remote/cloud sync**: may continue after switching.

If the existing document store only becomes safe after `flush(documentId)`, the activation may need to wait before destroying the outgoing editor. It still should select the new tab and show its loading shell immediately.

### 5.6 Foreground chat streaming needs an explicit invariant

Before shipping tabs, verify this exact case in static and cloud modes:

1. Start an assistant response in chat A.
2. Switch the same mounted `ChatContainer` to chat B.
3. Let A continue.
4. Return to A.
5. Confirm no tokens were inserted into B, lost, duplicated, or attached to the wrong stream.

`useChat.switchThread()` is the right architectural direction because it avoids recreating setup-only composables. However, tab integration must confirm that an active foreground request is either:

- Detached into a thread-keyed runtime/background tracker, or
- Held by a request object that continues independently of `threadIdRef`, or
- Explicitly prevented from switching with a clear UI contract.

Never silently call `abort()` because the user clicked another tab.

---

## 6. Chat state: split resource, tab, and pane state

### 6.1 What should not be in `WorkspaceTab`

Do not add:

```ts
interface BadTab {
    messages: UiChatMessage[]
    loading: boolean
    streamAccumulator: ...
    chatComposable: ...
}
```

That duplicates canonical state and makes persistence, sync, deletion, and background streaming much harder.

### 6.2 Recommended chat tab view state

```ts
export interface ChatComposerDraft {
    version: 1
    text: string
    editorJson?: Record<string, unknown>
    pendingPromptId?: string | null
    modelId?: string
    settings?: {
        webSearchEnabled?: boolean
        thinkingEnabled?: boolean
        reasoningEffort?: string | null
    }
    attachments: TabAttachmentLease[]
    updatedAt: number
}

export interface ChatTabViewState {
    version: 1
    draft?: ChatComposerDraft
    scroll?: Or3ScrollViewState
    focusedRegion?: 'messages' | 'composer'
}
```

Only keep model/settings here if product behavior is intended to be per tab. If model selection is thread-level and already durably stored elsewhere, do not duplicate it.

### 6.3 Key drafts by `tabId`, not thread ID or pane ID

Reasons:

- A blank chat has no thread ID.
- A blank chat must keep its draft when it becomes a real thread.
- Two explicit duplicate views of one thread may have different drafts.
- A draft must move when its tab is assigned to another pane.
- A pane can display many tabs over time.

### 6.4 Draft store example

```ts
type DraftListener = (draft: ChatComposerDraft | undefined) => void

export function createChatTabDraftStore() {
    const drafts = new Map<string, ChatComposerDraft>()
    const listeners = new Map<string, Set<DraftListener>>()

    function read(tabId: string): ChatComposerDraft | undefined {
        return drafts.get(tabId)
    }

    function write(tabId: string, next: ChatComposerDraft): void {
        drafts.set(tabId, next)
        listeners.get(tabId)?.forEach((listener) => listener(next))
    }

    function patch(
        tabId: string,
        patch: Partial<ChatComposerDraft>
    ): void {
        const current = drafts.get(tabId) ?? {
            version: 1,
            text: '',
            attachments: [],
            updatedAt: Date.now(),
        }

        write(tabId, {
            ...current,
            ...patch,
            updatedAt: Date.now(),
        })
    }

    function subscribe(
        tabId: string,
        listener: DraftListener
    ): () => void {
        const set = listeners.get(tabId) ?? new Set()
        set.add(listener)
        listeners.set(tabId, set)
        listener(drafts.get(tabId))

        return () => {
            set.delete(listener)
            if (!set.size) listeners.delete(tabId)
        }
    }

    function deleteDraft(tabId: string): void {
        const draft = drafts.get(tabId)
        draft?.attachments.forEach((attachment) => attachment.release())
        drafts.delete(tabId)
        listeners.get(tabId)?.forEach((listener) => listener(undefined))
    }

    return { read, write, patch, subscribe, deleteDraft }
}
```

### 6.5 Composer integration

Pass both IDs:

```vue
<ChatInputDropper
    :pane-id="paneId"
    :tab-id="tabId"
    :thread-id="currentThreadId"
/>
```

Their jobs differ:

- `paneId`: plugin bridge and visible pane runtime.
- `tabId`: draft and view-state ownership.
- `threadId`: durable chat resource.

Inside `ChatInputDropper`, watch `tabId` explicitly:

```ts
const restoringDraft = ref(false)

async function captureDraft(tabId: string): Promise<void> {
    draftStore.write(tabId, {
        version: 1,
        text: promptText.value,
        editorJson: editor.value?.getJSON(),
        pendingPromptId: pendingPromptId.value,
        attachments: attachmentStore.leaseForTab(tabId),
        updatedAt: Date.now(),
    })
}

async function restoreDraft(tabId: string): Promise<void> {
    const saved = draftStore.read(tabId)

    restoringDraft.value = true
    try {
        promptText.value = saved?.text ?? ''
        editor.value?.commands.setContent(
            saved?.editorJson ?? saved?.text ?? '',
            { emitUpdate: false }
        )
        pendingPromptId.value = saved?.pendingPromptId ?? null
        attachmentStore.bindTab(tabId)
    } finally {
        await nextTick()
        restoringDraft.value = false
    }
}

watch(
    () => props.tabId,
    async (next, previous) => {
        if (previous) await captureDraft(previous)
        await restoreDraft(next)
    },
    { flush: 'pre' }
)
```

Guard editor update handlers:

```ts
onUpdate({ editor }) {
    if (restoringDraft.value) return

    promptText.value = editor.getText()
    scheduleDraftCapture(props.tabId)
}
```

### 6.6 Attachment ownership is the hard part

`ChatInputDropper` currently owns attachment state and releases resources on unmount. That works while the composer lifetime equals the draft lifetime. Tabs break that assumption.

Do not store only an object URL string in a tab draft and then call `URL.revokeObjectURL()` when the pane switches.

Use a lease:

```ts
export interface TabAttachmentLease {
    readonly id: string
    readonly name: string
    readonly mime: string
    readonly size: number
    readonly previewUrl?: string
    readonly state: 'uploading' | 'ready' | 'error'
    retain(): void
    release(): void
}
```

A simple reference-counted owner:

```ts
interface OwnedAttachment {
    lease: TabAttachmentLease
    refs: number
    revoke?: () => void
}

const ownedAttachments = new Map<string, OwnedAttachment>()

function retainAttachment(id: string): void {
    const owned = ownedAttachments.get(id)
    if (owned) owned.refs += 1
}

function releaseAttachment(id: string): void {
    const owned = ownedAttachments.get(id)
    if (!owned) return

    owned.refs -= 1
    if (owned.refs > 0) return

    owned.revoke?.()
    ownedAttachments.delete(id)
}
```

Ownership rules:

- The tab draft retains attachments.
- The visible composer borrows them.
- Switching panes releases the composer borrow, not the tab's ownership.
- A successful send transfers or ends the draft ownership.
- Permanently closing/evicting the draft releases the tab ownership.
- Undo keeps the ownership alive until the recently-closed entry expires.
- Full reload persistence of unsent files remains out of scope for v1.

### 6.7 Blank chat promotion

When first send creates a real thread:

```ts
function promoteBlankChat(
    tabId: string,
    threadId: string
): void {
    updateTab(tabId, {
        resource: { kind: 'chat', threadId },
        ephemeral: false,
    })

    // Draft and scroll state stay under the same tabId.
    // Do not copy or rename them.
}
```

Use `tabId` as `Or3Scroll.contentKey`. Do not use `threadId` as the sole content key.

Why:

- Promotion from blank to real thread should not reset the view.
- Two duplicate tabs of the same thread need independent scroll positions.
- Switching tab A to tab B must reset/restore even if both happen to show the same thread.
- Tab identity is the correct view identity.

### 6.8 Clearing a draft

Only clear after durable send acceptance, preserving the current good behavior.

```ts
const acceptance = await durableAcceptance
if (!hasDurableSendAcceptance(acceptance)) return acceptance

draftStore.deleteDraft(props.tabId)
clearComposerUiWithoutDoubleReleasingAttachments()
```

Be careful not to release an attachment once from the composer and again from the tab draft.

---

## 7. Document state: consolidate the switching owner

### 7.1 Current integration concern

The current document stack contains two switching mechanisms:

- `LazyEditorHost.vue` changes a `renderKey` when `documentId` changes, forcing `DocumentEditorRoot` to remount.
- `DocumentEditorRoot.vue` also watches `documentId`, captures the previous document, resets AI, and loads the next one.

That is ambiguous ownership. A keyed remount can make the root's own watcher redundant or cause lifecycle timing that is hard to reason about.

Choose one.

### 7.2 Recommended first-release choice

For the tab release:

- Keep a keyed remount only for fatal retry/recovery.
- Let `DocumentEditorRoot` own normal in-place document switching.
- Expose an explicit document session API to the tab host.
- Capture before the prop/resource changes.
- Recreate the TipTap editor internally only when its extension/model lifecycle requires it.

If in-place switching proves too risky for the first PR, use a remount but remove the redundant root watcher and let the host perform the capture transaction first. Do not keep both paths.

### 7.3 Expand the document editor session contract

Current session registration only captures. Tabs need more explicit lifecycle operations.

```ts
export interface DocumentEditorViewState {
    version: 1
    documentId: string
    contentRevision?: number
    scrollTop: number
    selectionJson?: unknown
    inspectorOpen?: boolean
    inspectorTab?: string
    findOpen?: boolean
    focusedRegion?: 'title' | 'content' | 'inspector'
}

export interface ActiveDocumentEditorSession {
    readonly documentId: string
    captureContent(): void
    ensureLocalDurability(): Promise<void>
    captureViewState(): DocumentEditorViewState
    restoreViewState(
        state: DocumentEditorViewState,
        options?: { focus?: boolean }
    ): Promise<void>
}
```

Registry:

```ts
const sessionsByDocument = new Map<
    string,
    Set<ActiveDocumentEditorSession>
>()

export function registerDocumentEditorSession(
    session: ActiveDocumentEditorSession
): () => void {
    const sessions =
        sessionsByDocument.get(session.documentId) ?? new Set()

    sessions.add(session)
    sessionsByDocument.set(session.documentId, sessions)

    return () => {
        sessions.delete(session)
        if (!sessions.size) {
            sessionsByDocument.delete(session.documentId)
        }
    }
}
```

For duplicate document tabs, the tab host should select the session by pane/tab, not merely take all sessions by document ID. A stronger registry key is:

```ts
type DocumentSessionKey = `${string /* paneId */}:${string /* tabId */}`
```

### 7.4 Capture content synchronously

`DocumentEditorRoot` already follows the correct basic pattern:

```ts
const json = editor.getJSON()
setDocumentContent(documentId, json)
```

The tab host should call this before changing the active document.

Then call a durability operation that means:

- Written to the local document store/Dexie or a durable outbox.
- Safe if the editor component unmounts.
- Not necessarily synced to the server.

This keeps a local-first application responsive without risking content loss.

### 7.5 Close semantics

A document tab close should be a two-stage transaction:

```ts
async function closeDocumentTab(tabId: string): Promise<boolean> {
    const tab = getTab(tabId)
    if (tab?.resource.kind !== 'document') return false

    const session = getVisibleDocumentSession(tabId)

    try {
        session?.captureContent()
        await session?.ensureLocalDurability()
    } catch (error) {
        markTabError(tabId, 'save')
        showSaveFailureToast(tabId, error)
        return false
    }

    removeTabFromWorkspace(tabId)
    pushRecentlyClosed(tabId)
    return true
}
```

A cloud sync retry should not block closing once local durability is confirmed.

### 7.6 Document view state capture

```ts
function captureDocumentViewState(): DocumentEditorViewState {
    const scrollRoot =
        rootElement.value?.querySelector<HTMLElement>('.editor-scroll')

    const currentSelection = editor.value?.state.selection

    return {
        version: 1,
        documentId: props.documentId,
        contentRevision: state.value.record?.clock,
        scrollTop: scrollRoot?.scrollTop ?? 0,
        selectionJson: currentSelection?.toJSON(),
        inspectorOpen: inspectorOpen.value,
        inspectorTab: inspectorTab.value,
        findOpen: findOpen.value,
        focusedRegion: getFocusedDocumentRegion(),
    }
}
```

### 7.7 Safely restore selection

```ts
import { Selection } from '@tiptap/pm/state'

function restoreSelection(
    saved: DocumentEditorViewState,
    shouldFocus: boolean
): void {
    const current = editor.value
    if (!current || current.isDestroyed) return

    const sameRevision =
        saved.contentRevision === undefined ||
        saved.contentRevision === state.value.record?.clock

    if (!sameRevision || !saved.selectionJson) {
        return
    }

    try {
        const selection = Selection.fromJSON(
            current.state.doc,
            saved.selectionJson
        )

        current.view.dispatch(
            current.state.tr.setSelection(selection)
        )

        if (shouldFocus) {
            current.commands.focus()
        }
    } catch {
        // Document changed or selection is no longer legal.
        // Preserve scroll, but do not fail tab activation.
    }
}
```

If the document changed while hidden, restoration can fall back to:

- The same heading/block ID if available.
- A clamped previous head position resolved with `Selection.near`.
- The saved `scrollTop`.
- The top of the document.

Do not maintain a long cross-device ProseMirror mapping history solely to restore a cursor.

### 7.8 Restore timing

Restore in this order:

1. Load the document record.
2. Create/bind the editor.
3. Wait for TipTap editor readiness.
4. Restore inspector/find UI.
5. Restore scroll without smooth animation.
6. Restore selection.
7. Focus only when activation was keyboard-driven or explicitly requested.

Use the activation generation after every async boundary.

---

## 8. `or3-scroll`: add first-class view-state capture and restore

### 8.1 Current behavior

`Or3Scroll` already:

- Captures an internal keyed anchor.
- Restores it after measurements and structural changes.
- Resets completely when `contentKey` changes.
- Exposes keyed jumps.
- Uses generation counters to reject stale work.

What it does not currently expose is a public snapshot of the old content before `contentKey` changes.

Without a public API, `ChatContainer` would need to reach into private DOM/model details. Do not do that.

### 8.2 Public view-state type

Add to the package's public types:

```ts
export interface Or3ScrollAnchorPoint {
    key: Or3ScrollItemKey
    withinItem: number
    fallbackIndex: number
}

export interface Or3ScrollViewState {
    version: 1
    contentKey?: Or3ScrollItemKey

    /**
     * `bottom` means the user intended to follow new content.
     * `anchor` means preserve the reading position.
     */
    mode: 'bottom' | 'anchor'

    /**
     * Several candidates make restoration survive deletion of the
     * first visible row.
     */
    anchors?: Or3ScrollAnchorPoint[]

    /**
     * Last-resort fallback only.
     */
    scrollTop: number

    /**
     * In-memory snapshots may carry a bounded measurement cache.
     * Do not put a huge array into the persisted workspace manifest.
     */
    measurements?: Array<readonly [
        key: Or3ScrollItemKey,
        height: number,
    ]>
}
```

### 8.3 Exposed API

```ts
export interface Or3ScrollExposed {
    scrollToBottom(options?: { smooth?: boolean }): void
    scrollToIndex(
        index: number,
        options?: {
            align?: 'start' | 'center' | 'end'
            smooth?: boolean
        }
    ): void
    scrollToItemKey(
        key: Or3ScrollItemKey,
        options?: {
            align?: 'start' | 'center' | 'end'
            smooth?: boolean
        }
    ): void

    captureViewState(): Or3ScrollViewState

    restoreViewState(
        state: Or3ScrollViewState,
        options?: {
            /**
             * Normally false. A snapshot from a different logical view
             * should not be applied accidentally.
             */
            allowDifferentContentKey?: boolean
        }
    ): Promise<
        | { status: 'restored'; method: 'bottom' | 'anchor' | 'offset' }
        | { status: 'ignored'; reason: 'stale' | 'wrong-content' | 'empty' }
    >

    refreshMeasurements(): void
    reset(): void
}
```

### 8.4 Capture implementation

Use the existing internal `captureAnchor()` rather than rebuilding the algorithm.

```ts
const MAX_SNAPSHOT_MEASUREMENTS = 512

function captureViewState(): Or3ScrollViewState {
    if (container.value) {
        latestScrollTop = container.value.scrollTop
    }

    const anchor = captureAnchor()
    const following =
        props.maintainBottom &&
        scrollMode === 'followingBottom' &&
        isAtBottom.value

    const visibleOrRecentKeys = collectBoundedMeasurementKeys(
        MAX_SNAPSHOT_MEASUREMENTS
    )

    return {
        version: 1,
        contentKey: props.contentKey,
        mode: following ? 'bottom' : 'anchor',
        anchors: anchor?.candidates.slice(0, 3).map((point) => ({
            key: point.key,
            withinItem: point.withinItem,
            fallbackIndex: point.index,
        })),
        scrollTop: latestScrollTop,
        measurements: visibleOrRecentKeys.flatMap((key) => {
            const height = heightByKey.get(key)
            return height === undefined ? [] : [[key, height] as const]
        }),
    }
}
```

Why several anchors:

- The first visible message may be deleted.
- A temporary streaming row may disappear.
- A branch operation may replace a message.
- A filtered tool row may no longer render.

Use the first surviving candidate with the smallest index displacement.

### 8.5 Restore implementation

Restore is asynchronous because the new item keys and viewport measurements may not be ready immediately.

```ts
async function restoreViewState(
    saved: Or3ScrollViewState,
    options: { allowDifferentContentKey?: boolean } = {}
) {
    if (
        !options.allowDifferentContentKey &&
        saved.contentKey !== undefined &&
        saved.contentKey !== props.contentKey
    ) {
        return {
            status: 'ignored',
            reason: 'wrong-content',
        } as const
    }

    const generation = ++jumpGeneration
    cancelResetFrames()

    seedMeasurements(saved.measurements)
    updateRange()
    setCommittedTrackHeight(engine.getTotalHeight())

    await nextTick()
    await nextAnimationFrame()

    if (generation !== jumpGeneration || isDestroyed) {
        return { status: 'ignored', reason: 'stale' } as const
    }

    if (saved.mode === 'bottom' && props.maintainBottom) {
        scrollToBottom({ smooth: false })
        return {
            status: 'restored',
            method: 'bottom',
        } as const
    }

    const restoredAnchor = restorePublicAnchor(saved.anchors)
    if (restoredAnchor) {
        await correctRestoredAnchorAfterMeasurement(
            restoredAnchor,
            generation
        )

        return {
            status: 'restored',
            method: 'anchor',
        } as const
    }

    applyScrollTop(saved.scrollTop, 'jump', false)
    scheduleScrollFrame()

    return {
        status: 'restored',
        method: 'offset',
    } as const
}
```

`nextAnimationFrame()`:

```ts
function nextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve())
    })
}
```

Do not use smooth scrolling during restoration. It turns a state restore into a visible navigation animation and creates extra `scrollend` races.

### 8.6 Seed measurements carefully

In-memory view state can include enough recent measurements for a close-to-exact restore.

Full reload persistence should usually omit them because:

- The viewport width may differ.
- Fonts/theme may differ.
- Message rendering may have changed.
- A large history can create a large snapshot.

Validate heights:

```ts
function seedMeasurements(
    measurements: Or3ScrollViewState['measurements']
): void {
    if (!measurements?.length) return

    for (const [key, rawHeight] of measurements) {
        const index = indexByKey.get(key)
        if (index === undefined) continue
        if (!Number.isFinite(rawHeight) || rawHeight <= 0) continue

        const height = quantizeHeight(rawHeight)
        heightByKey.set(key, height)
        engine.setHeight(index, height)
    }
}
```

### 8.7 `contentKey` should be the tab ID

Change the chat integration from:

```vue
:content-key="props.threadId ?? 'new-thread'"
```

to:

```vue
:content-key="props.tabId"
```

Then:

- Switching tabs changes `contentKey`.
- Blank chat promotion does not.
- Duplicate views of one thread remain independent.
- View-state snapshots validate against the view instance.

### 8.8 ChatContainer integration

```ts
const scroller = ref<Or3ScrollExposed | null>(null)

function captureChatViewState(): ChatTabViewState {
    return {
        version: 1,
        scroll: scroller.value?.captureViewState(),
        focusedRegion: composerContainsFocus()
            ? 'composer'
            : 'messages',
    }
}

async function restoreChatViewState(
    saved: ChatTabViewState | undefined,
    signal: AbortSignal
): Promise<void> {
    if (!saved?.scroll || !scroller.value) return
    if (signal.aborted) throw signal.reason

    const result = await scroller.value.restoreViewState(saved.scroll)
    if (signal.aborted) throw signal.reason

    if (
        result.status === 'ignored' &&
        allMessages.value.length &&
        saved.scroll.mode === 'bottom'
    ) {
        scroller.value.scrollToBottom()
    }
}

defineExpose({
    captureViewState: captureChatViewState,
    restoreViewState: restoreChatViewState,
})
```

The tab host should use a registered session handle rather than walking component refs through several levels.

### 8.9 Keep `Or3Scroll` stateless between views

Do not make `Or3Scroll` internally store a map of every `contentKey` it has ever rendered. That couples a reusable virtualizer to workspace/tab policy and can grow without a clear lifecycle.

The tab view-state store owns the LRU. `Or3Scroll` only captures and restores the current view.

### 8.10 Add explicit mutation policy later

The existing scroll mode handles many cases, but a future API should distinguish intent:

```ts
export type Or3ScrollMutation =
    | { type: 'switch-view' }
    | { type: 'append'; source: 'local' | 'remote' }
    | { type: 'prepend-history' }
    | { type: 'items-changed' }
    | { type: 'replace'; purgeMeasurements: boolean }
    | { type: 'remove-start' }
    | { type: 'remove-end' }

export type BottomPolicy =
    | 'preserve'
    | 'follow-if-at-bottom'
    | 'force-bottom'
```

Suggested chat policy:

| Change | Policy |
|---|---|
| User sends a message | `force-bottom` |
| Remote assistant starts while at bottom | `follow-if-at-bottom` |
| Streaming assistant grows | `follow-if-at-bottom` |
| History prepended | `preserve` |
| Message edited above viewport | `preserve` |
| Switch tab | explicit `restoreViewState` |
| First open with no snapshot | `force-bottom` |

Do not force this broader API into the initial tab PR unless the current behavior blocks correctness.

### 8.11 Hardening work to complete before relying on restore

The existing `or3-scroll` audit identifies several remaining issues relevant to tabs. Prioritize:

1. Verify the retained middle-key sequence before append/prepend fast paths.
2. Reset top/bottom boundary latches on `contentKey` reset.
3. Remove generic descendant `mousedown` as a user-scroll signal.
4. Do not let viewport resize compensation fight an active user gesture.
5. Make the measured correction after a smooth jump instant.
6. Retry `useScrollJump` requests when the scroller ref becomes ready.
7. Add `AbortSignal` to `loadHistoryUntil`.
8. Use one viewport height metric consistently.
9. Add a browser test for content switch while a scroll frame and scroll-end timer are pending.

Tabs will exercise `contentKey` changes much more frequently than the current app, so these are no longer obscure edge cases.

---

## 9. Drag reordering

### 9.1 Recommended scope

First release:

- Desktop mouse/pen pointer drag.
- Horizontal tab strip only.
- Reorder within one strip.
- Edge auto-scroll.
- Escape/pointer-cancel rollback.
- Keyboard Move Left / Move Right commands.
- Mobile uses horizontal scrolling and context-menu reorder.

Defer direct touch drag because horizontal dragging competes with the native horizontal scroll gesture. Add it only after the desktop implementation is stable.

### 9.2 Why not use native HTML drag-and-drop for v1

VS Code uses browser drag-and-drop partly because it supports richer transfers between editor groups, windows, and external locations.

OR3's initial requirement is a one-dimensional in-strip reorder. Pointer Events provide:

- Better direct movement control.
- Simpler animation.
- No browser ghost image.
- Clear pointer-cancel handling.
- Easier distinction between tab close and drag.
- No dependency.

If OR3 later supports dragging a tab into a split, another window, a project, or the desktop, revisit a mature DnD library.

### 9.3 State machine

```ts
type TabDragState =
    | { phase: 'idle' }
    | {
          phase: 'pending'
          pointerId: number
          tabId: string
          startClientX: number
          startClientY: number
          startIndex: number
          geometry: DragGeometry
      }
    | {
          phase: 'dragging'
          pointerId: number
          tabId: string
          startIndex: number
          destinationIndex: number
          pointerClientX: number
          geometry: DragGeometry
      }
```

Transitions:

```text
idle
  └─ primary pointerdown on tab body
      → pending
          ├─ movement < threshold and pointerup → normal click
          ├─ movement >= threshold → dragging
          ├─ Escape/pointercancel → idle
          └─ pointerup while dragging → commit reorder → idle
```

### 9.4 Do not start from interactive children

```ts
function isDragStartTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false

    return !target.closest(
        [
            '[data-tab-close]',
            'button',
            'a',
            'input',
            'textarea',
            'select',
            '[contenteditable="true"]',
            '[role="menuitem"]',
        ].join(',')
    )
}
```

Only use:

```ts
if (event.button !== 0 || !event.isPrimary) return
```

Suggested activation threshold:

- Mouse/pen: 6–8 CSS pixels.
- Touch: disabled for v1.
- If touch is later added: delay around 250ms with a small movement tolerance, following established sortable patterns.

### 9.5 Use strip content coordinates

Viewport coordinates change when the strip auto-scrolls. Convert both tab geometry and pointer position into strip content coordinates.

```ts
interface TabRect {
    id: string
    left: number
    right: number
    width: number
    center: number
}

interface DragGeometry {
    stripLeft: number
    initialScrollLeft: number
    tabs: TabRect[]
    activeWidth: number
    gap: number
}
```

Capture:

```ts
function measureDragGeometry(
    strip: HTMLElement,
    tabElements: Map<string, HTMLElement>,
    activeTabId: string
): DragGeometry {
    const stripRect = strip.getBoundingClientRect()
    const scrollLeft = strip.scrollLeft

    const tabs = [...tabElements].map(([id, element]) => {
        const rect = element.getBoundingClientRect()
        const left = rect.left - stripRect.left + scrollLeft
        const right = rect.right - stripRect.left + scrollLeft

        return {
            id,
            left,
            right,
            width: rect.width,
            center: (left + right) / 2,
        }
    })

    const active = tabs.find((tab) => tab.id === activeTabId)
    if (!active) throw new Error(`Missing active tab ${activeTabId}`)

    return {
        stripLeft: stripRect.left,
        initialScrollLeft: scrollLeft,
        tabs,
        activeWidth: active.width,
        gap: readTabGap(strip),
    }
}
```

Pointer coordinate:

```ts
function pointerContentX(
    event: PointerEvent,
    strip: HTMLElement
): number {
    const stripRect = strip.getBoundingClientRect()
    return event.clientX - stripRect.left + strip.scrollLeft
}
```

This continues working while `scrollLeft` changes.

### 9.6 Pure target-edge calculation

```ts
type HorizontalEdge = 'left' | 'right'

function nearestTabEdge(
    contentX: number,
    tabs: readonly TabRect[],
    activeId: string
): { targetId: string; edge: HorizontalEdge } | null {
    let best:
        | {
              targetId: string
              edge: HorizontalEdge
              distance: number
          }
        | undefined

    for (const tab of tabs) {
        if (tab.id === activeId) continue

        const leftDistance = Math.abs(contentX - tab.left)
        const rightDistance = Math.abs(contentX - tab.right)

        const candidate =
            leftDistance <= rightDistance
                ? {
                      targetId: tab.id,
                      edge: 'left' as const,
                      distance: leftDistance,
                  }
                : {
                      targetId: tab.id,
                      edge: 'right' as const,
                      distance: rightDistance,
                  }

        if (!best || candidate.distance < best.distance) {
            best = candidate
        }
    }

    return best
        ? { targetId: best.targetId, edge: best.edge }
        : null
}
```

Destination index:

```ts
function destinationIndexForEdge(options: {
    sourceIndex: number
    targetIndex: number
    edge: HorizontalEdge
}): number {
    const { sourceIndex, targetIndex, edge } = options

    if (sourceIndex === targetIndex) return sourceIndex

    const wantsAfter = edge === 'right'
    const movingForward = sourceIndex < targetIndex

    if (movingForward) {
        return wantsAfter ? targetIndex : targetIndex - 1
    }

    return wantsAfter ? targetIndex + 1 : targetIndex
}
```

Clamp:

```ts
function clampDestination(index: number, count: number): number {
    return Math.max(0, Math.min(index, count - 1))
}
```

### 9.7 Transform-only preview

Keep the active tab's layout slot in place and move a visual clone or the active element with `translate3d`.

Tabs between source and destination shift by the active slot width:

```ts
function tabPreviewTransform(options: {
    index: number
    sourceIndex: number
    destinationIndex: number
    activeSlotSize: number
}): number {
    const {
        index,
        sourceIndex,
        destinationIndex,
        activeSlotSize,
    } = options

    if (sourceIndex < destinationIndex) {
        return index > sourceIndex && index <= destinationIndex
            ? -activeSlotSize
            : 0
    }

    if (sourceIndex > destinationIndex) {
        return index >= destinationIndex && index < sourceIndex
            ? activeSlotSize
            : 0
    }

    return 0
}
```

For variable-width tabs:

- Freeze each tab's current pixel width for the duration of the drag.
- `activeSlotSize = activeWidth + gap`.
- Neighbor shifts use the active slot size.
- The active preview follows the pointer independently.
- Remove inline widths on finish/cancel.

This avoids title/status updates changing geometry mid-drag.

### 9.8 Commit once

```ts
function moveItem<T>(
    items: readonly T[],
    from: number,
    to: number
): T[] {
    if (from === to) return [...items]

    const result = [...items]
    const [item] = result.splice(from, 1)
    if (item === undefined) return result

    result.splice(to, 0, item)
    return result
}

function commitTabDrag(
    sourceIndex: number,
    destinationIndex: number
): void {
    tabs.value = moveItem(
        tabs.value,
        sourceIndex,
        destinationIndex
    )

    scheduleSessionPersistence()
    announceTabReorder(
        tabs.value[destinationIndex]?.cachedTitle,
        destinationIndex,
        tabs.value.length
    )
}
```

Do not change active pane bindings or remount content. A tab's ID and pane binding remain unchanged.

### 9.9 Edge auto-scroll

Use one animation loop and velocity based on distance into the edge zone.

```ts
const EDGE_ZONE = 40
const MAX_SCROLL_PER_FRAME = 18

function autoScrollVelocity(
    clientX: number,
    stripRect: DOMRect
): number {
    const leftDepth = stripRect.left + EDGE_ZONE - clientX
    if (leftDepth > 0) {
        const ratio = Math.min(1, leftDepth / EDGE_ZONE)
        return -MAX_SCROLL_PER_FRAME * ratio * ratio
    }

    const rightDepth = clientX - (stripRect.right - EDGE_ZONE)
    if (rightDepth > 0) {
        const ratio = Math.min(1, rightDepth / EDGE_ZONE)
        return MAX_SCROLL_PER_FRAME * ratio * ratio
    }

    return 0
}
```

Loop:

```ts
function runAutoScrollFrame(): void {
    if (dragState.value.phase !== 'dragging') return

    const strip = stripRef.value
    if (!strip) return

    const velocity = autoScrollVelocity(
        dragState.value.pointerClientX,
        strip.getBoundingClientRect()
    )

    if (velocity !== 0) {
        const previous = strip.scrollLeft
        strip.scrollLeft += velocity

        if (strip.scrollLeft !== previous) {
            recomputeDragDestination()
        }
    }

    autoScrollFrame = requestAnimationFrame(runAutoScrollFrame)
}
```

Stop on:

- Pointer up.
- Pointer cancel.
- Escape.
- Window blur.
- Component unmount.
- Feature disabled.
- Tab deleted during drag.

### 9.10 Pointer controller skeleton

```ts
function onTabPointerDown(
    event: PointerEvent,
    tabId: string
): void {
    if (
        event.button !== 0 ||
        !event.isPrimary ||
        !isDragStartTarget(event.target)
    ) {
        return
    }

    const strip = stripRef.value
    if (!strip) return

    const sourceIndex = tabs.value.findIndex(
        (tab) => tab.id === tabId
    )
    if (sourceIndex === -1) return

    dragState.value = {
        phase: 'pending',
        pointerId: event.pointerId,
        tabId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startIndex: sourceIndex,
        geometry: measureDragGeometry(
            strip,
            tabElements,
            tabId
        ),
    }

    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
    window.addEventListener('pointercancel', cancelDrag)
}

function onWindowPointerMove(event: PointerEvent): void {
    const current = dragState.value
    if (current.phase === 'idle') return
    if (event.pointerId !== current.pointerId) return

    if (current.phase === 'pending') {
        const distance = Math.hypot(
            event.clientX - current.startClientX,
            event.clientY - current.startClientY
        )

        if (distance < 7) return

        beginVisualDrag(current, event)
    }

    if (dragState.value.phase !== 'dragging') return

    dragState.value = {
        ...dragState.value,
        pointerClientX: event.clientX,
    }

    updateActivePreviewTransform(event.clientX)
    recomputeDragDestination()
}

function onWindowPointerUp(event: PointerEvent): void {
    const current = dragState.value
    if (current.phase === 'idle') return
    if (event.pointerId !== current.pointerId) return

    if (current.phase === 'dragging') {
        commitTabDrag(
            current.startIndex,
            current.destinationIndex
        )
        suppressFollowingClickOnce()
    }

    finishDrag()
}
```

Use `event.preventDefault()` only after the drag crosses the threshold. Otherwise ordinary click activation and text selection behavior can be disturbed.

### 9.11 Keyboard reorder

Do not attempt to emulate pointer dragging for keyboard users. Offer deterministic commands:

```ts
function moveFocusedTab(delta: -1 | 1): void {
    const index = tabs.value.findIndex(
        (tab) => tab.id === keyboardFocusedTabId.value
    )
    if (index === -1) return

    const destination = Math.max(
        0,
        Math.min(index + delta, tabs.value.length - 1)
    )
    if (destination === index) return

    tabs.value = moveItem(tabs.value, index, destination)
    nextTick(() => focusTabAtIndex(destination))
    announceTabReorder(
        tabs.value[destination]?.cachedTitle,
        destination,
        tabs.value.length
    )
}
```

Expose through:

- Context menu.
- Command palette.
- Optional modifier shortcut while the tab list itself is focused.

### 9.12 Drag tests that need a real browser

Unit-test pure math, but use Playwright for:

- Reorder while strip is scrolled.
- Auto-scroll at both edges.
- Variable-width tabs.
- Active tab drag.
- Theme/title status change queued during drag.
- Pointer cancel.
- Escape cancel.
- Window blur.
- Close button click without drag.
- Click activation without accidental drag.
- No content remount.
- No persistence writes during pointer movement.
- Reduced motion.
- 125%, 150%, and device-pixel-ratio rounding where CI supports it.

---

## 10. Closing tabs and undo

### 10.1 Close is a transaction, not an array splice

A close operation may need to:

- Capture a draft.
- Ensure a document is locally durable.
- Handle a tab visible in a pane.
- Find a hidden replacement.
- Close a split.
- Keep a background chat job running.
- Push an Undo snapshot.
- Move focus.
- Update route.
- Release attachment leases later.

### 10.2 Snapshot type

```ts
export interface ClosedTabSnapshot {
    version: 1
    tab: WorkspaceTab
    previousIndex: number
    previousPaneId?: string
    viewState?: WorkspaceTabViewState
    closedAt: number

    /**
     * Keeps in-memory resources alive until restored or evicted.
     */
    release(): void
}
```

### 10.3 Bounded stack

```ts
const MAX_RECENTLY_CLOSED = 10
const CLOSED_TAB_TTL_MS = 5 * 60_000

function pushRecentlyClosed(snapshot: ClosedTabSnapshot): void {
    recentlyClosed.value.unshift(snapshot)

    while (recentlyClosed.value.length > MAX_RECENTLY_CLOSED) {
        recentlyClosed.value.pop()?.release()
    }

    scheduleClosedTabExpiry()
}
```

Do not persist file/blob leases to local storage.

### 10.4 Visible-tab close policy

If closing tab A from pane P:

1. Prefer the nearest hidden tab by tab order.
2. Otherwise:
   - If another pane exists, close P.
   - If P is the last pane, create a blank chat tab.
3. If A is a document, require local durability first.
4. If A is a chat with a running job, remove only the tab UI.
5. Select/focus the replacement.
6. Project the replacement route.
7. Offer Undo.

### 10.5 Prevent close-button “sliding target” behavior

Keep tab width stable until the pointer interaction ends.

Practical options:

- Reserve close button width at all times with opacity.
- During a rapid series of pointer closes, temporarily freeze remaining tab widths for approximately one pointer cycle.
- Never render/unrender the close element in a way that changes title layout.

```css
.workspace-tab__close-slot {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
}

.workspace-tab__close {
    opacity: 0;
    pointer-events: none;
}

.workspace-tab:is(:hover, [aria-selected='true'], :focus-within)
.workspace-tab__close {
    opacity: 1;
    pointer-events: auto;
}
```

---

## 11. Session and route restoration

### 11.1 Direct route wins

Startup order:

1. Parse and validate local tab snapshot.
2. Rebuild tabs.
3. Recreate visible panes up to current profile/device limit.
4. Resolve the direct route resource.
5. Find or add that tab.
6. Make it active in the active pane.
7. Load/restore it.
8. Validate remaining tabs lazily or with bounded concurrency.

Do not first activate the stored tab and then visibly jump to the direct route tab.

### 11.2 Validate without serial startup delays

```ts
async function validateRestoredTabs(
    tabs: readonly WorkspaceTab[],
    signal: AbortSignal
): Promise<WorkspaceTab[]> {
    const concurrency = 4
    const result: WorkspaceTab[] = []
    let cursor = 0

    async function worker(): Promise<void> {
        while (cursor < tabs.length && !signal.aborted) {
            const index = cursor++
            const tab = tabs[index]
            if (!tab) continue

            if (await isRestorableTab(tab, signal)) {
                result[index] = tab
            }
        }
    }

    await Promise.all(
        Array.from({ length: concurrency }, () => worker())
    )

    return result.filter(Boolean)
}
```

The active/direct route tab should be validated first.

### 11.3 Persist lightweight state only

Persist:

- Ordered tab descriptors.
- Active tab ID.
- Visible tab IDs by pane position.
- Cached titles.
- Lightweight optional scroll anchor.
- Schema version.

Do not persist:

- Runtime pane UUID.
- Component refs.
- TipTap editor objects.
- Unsent Blob/File references.
- Background stream accumulator.
- Full virtualizer measurement map.
- Messages/document bodies.

### 11.4 Flush snapshot on `pagehide`

```ts
useEventListener(window, 'pagehide', () => {
    persistence.flushNow(createWorkspaceTabsSnapshot())
})
```

Also debounce normal changes. Reorder commits once, so it should trigger one persistence write.

---

## 12. Pane/plugin reconciliation

Existing plugins can mutate panes through the current global API. The tab feature must not break them.

### 12.1 Avoid observer loops with an operation origin

```ts
const TAB_HOST_ORIGIN = Symbol('workspace-tab-host')

interface PaneMutationContext {
    origin?: symbol
}

async function bindFromTabHost(
    paneId: string,
    resource: WorkspaceResource
): Promise<void> {
    await mutatePaneResource(paneId, resource, {
        origin: TAB_HOST_ORIGIN,
    })
}

function onPaneResourceChanged(
    paneId: string,
    resource: WorkspaceResource,
    context?: PaneMutationContext
): void {
    if (context?.origin === TAB_HOST_ORIGIN) return

    reconcileExternalPaneMutation(paneId, resource)
}
```

If changing the existing pane API signature is undesirable, use a short-lived mutation ledger keyed by pane ID and expected resource key.

### 12.2 External mutation policy

When a plugin changes pane P to resource R:

- If R has an open hidden tab, bind it to P.
- If R is visible in another pane:
  - Because the plugin explicitly placed it, create an instance/duplicate tab.
- Otherwise create a canonical tab.
- Keep the plugin's pane mutation.
- Log a development diagnostic encouraging migration to `openResource`.

### 12.3 Custom pane app view-state adapter

Do not require it for v1, but leave an additive shape:

```ts
export interface PaneAppTabAdapter<TState = unknown> {
    captureViewState?(
        context: {
            paneId: string
            tabId: string
            recordId?: string
        }
    ): TState | Promise<TState>

    restoreViewState?(
        state: TState,
        context: {
            paneId: string
            tabId: string
            recordId?: string
        }
    ): void | Promise<void>

    getTabTitle?(
        recordId?: string
    ): string | Promise<string>
}
```

Unknown apps can simply remount and use their registered label/icon.

---

## 13. Metadata and status updates

### 13.1 Do not create one live query per tab

With 50 tabs, avoid 50 independent Dexie subscriptions.

Use a central resolver:

```ts
interface WorkspaceTabMetadata {
    title: string
    icon?: string
    status:
        | 'idle'
        | 'loading'
        | 'streaming'
        | 'saving'
        | 'attention'
        | 'error'
}

const metadataByResourceKey =
    shallowRef(new Map<string, WorkspaceTabMetadata>())
```

Batch:

- Thread title updates.
- Document title/save status.
- Background job state.
- Resource deletion.
- Custom app metadata.

### 13.2 Batch title invalidation

```ts
const dirtyResourceKeys = new Set<string>()
let titleFlushQueued = false

function invalidateTabTitle(resourceKey: string): void {
    dirtyResourceKeys.add(resourceKey)
    if (titleFlushQueued) return

    titleFlushQueued = true
    queueMicrotask(async () => {
        titleFlushQueued = false
        const keys = [...dirtyResourceKeys]
        dirtyResourceKeys.clear()

        const updates = await resolveMetadataBatch(keys)
        metadataByResourceKey.value = new Map([
            ...metadataByResourceKey.value,
            ...updates,
        ])
    })
}
```

Add a generation/workspace ID check if the batch crosses an async boundary.

### 13.3 Hidden chat completion

When a hidden chat finishes:

- Status becomes `attention`.
- Do not steal focus.
- Optionally create a notification through the existing system.
- Clear attention when its tab becomes active.
- If tab was closed, the chat remains in history but has no tab indicator.

---

## 14. Focus and accessibility integration

### 14.1 Pointer activation should preserve expected focus

Clicking a tab should generally leave focus on the tab or where the browser naturally places it. Do not always call `editor.focus()` after pointer activation because:

- It can move the page unexpectedly.
- It can reopen a mobile keyboard.
- It can destroy a document selection restored for viewing.
- It makes tab-strip keyboard navigation harder.

Activation reason matters:

```ts
type ActivationReason =
    | 'pointer'
    | 'keyboard'
    | 'command'
    | 'restore'
    | 'external-pane-focus'
```

Suggested behavior:

| Reason | Focus after activation |
|---|---|
| Pointer tab click | Keep tab focused; content ready |
| Keyboard Enter/Space | Keep tab focused or move to panel only by explicit command |
| Command palette open | Focus content's main region if command semantics imply it |
| Session restore | Do not steal focus |
| Pane click | Select associated tab but retain clicked target |

### 14.2 Roving tabindex

```ts
const keyboardTabId = ref(activeTabId.value)

function tabIndexFor(tabId: string): 0 | -1 {
    return keyboardTabId.value === tabId ? 0 : -1
}
```

Left/Right moves keyboard focus. Depending on measured activation latency:

- Automatic activation: also activate as focus moves.
- Manual activation: Enter/Space activates.

### 14.3 Reorder announcements

Pointer drag does not need to narrate every pixel movement. Announce after commit:

```ts
function announceTabReorder(
    title: string | undefined,
    index: number,
    count: number
): void {
    liveRegion.value =
        `${title ?? 'Tab'} moved to position ${index + 1} of ${count}`
}
```

Keyboard move commands should announce each committed step.

### 14.4 Visible in another split

Only one tab is `aria-selected="true"`: the tab for the focused pane.

A tab visible in another pane can expose:

```html
aria-description="Open in another split"
```

or reference hidden descriptive text with `aria-describedby`.

When that pane receives focus, update the selected tab.

---

## 15. Performance and memory notes

### 15.1 Mounted content must stay O(visible panes)

Add a development assertion/test:

```ts
expect(
    document.querySelectorAll('[data-chat-container]').length
).toBeLessThanOrEqual(visiblePaneCount)

expect(
    document.querySelectorAll('[data-document-editor-root]').length
).toBeLessThanOrEqual(visiblePaneCount)
```

A 50-tab session with one pane should not create 50 chat runtimes.

### 15.2 Bound every cache

Suggested initial limits:

| Cache | Limit |
|---|---:|
| Recently closed tabs | 10 |
| Tab view-state entries | 100 |
| Full in-memory scroll measurement snapshots | 20 most recently used tabs |
| Measurements per snapshot | 512 entries |
| Cached title metadata | Current tabs + small grace window |
| Draft attachment leases | Owned only by active/open/recently-closed drafts |

Use LRU or explicit eviction and release callbacks.

### 15.3 Instrument the critical path

```ts
performance.mark(`tab:${tabId}:activation:start`)

// ...

performance.mark(`tab:${tabId}:content-bound`)
performance.measure(
    'or3.workspace-tabs.activation.bind',
    `tab:${tabId}:activation:start`,
    `tab:${tabId}:content-bound`
)

// ...

performance.mark(`tab:${tabId}:restored`)
performance.measure(
    'or3.workspace-tabs.activation.total',
    `tab:${tabId}:activation:start`,
    `tab:${tabId}:restored`
)
```

Track:

- Selected visual response.
- Resource bind.
- Scroll/editor restore.
- Total activation.
- Drag frame work.
- Session restore.
- Number of mounted heavy views.
- Number and size of view-state entries.

### 15.4 Avoid these hot-path operations

Do not do any of the following on every pointer move:

- Rewrite the tabs array.
- Serialize local storage.
- Query IndexedDB.
- Recalculate every title.
- Update URL.
- Call `nextTick`.
- Await.
- Read layout after writing transforms in the same frame.

Measure geometry once, use content coordinates, and update transforms in one scheduled frame.

---

## 16. Failure handling

### 16.1 Activation errors

A target resource can be:

- Deleted.
- Inaccessible after workspace change.
- Invalid.
- Failing to load.
- Missing plugin.
- Failing custom app initialization.

Policy:

- Keep the tab descriptor temporarily.
- Show a coherent error panel in the pane.
- Mark tab status `error`.
- Offer Retry and Close.
- Do not roll back to a stale tab if the user has already activated another tab.
- Remove invalid restored tabs silently only during startup validation, unless it was the direct route.

### 16.2 Document durability failure

- Do not discard the tab.
- Keep captured JSON in memory.
- Mark save error.
- Offer Retry.
- Do not continue destructive close until local durability succeeds.

### 16.3 Scroll restore failure

Scroll restore must never fail tab activation.

Fallback order:

1. Keyed anchor.
2. Fallback index.
3. Clamped `scrollTop`.
4. Bottom if saved mode was bottom.
5. Default initial position.

### 16.4 Drag interruption

Cancel safely on:

- Pointer cancel.
- Escape.
- Window blur.
- Visibility change.
- Tab deletion.
- Workspace switch.
- Feature flag disabled.
- Component unmount.

Cancellation removes transforms, inline widths, overlay, auto-scroll frame, and listeners without committing.

---

## 17. Tests that deserve disproportionate attention

### 17.1 Rapid activation matrix

Use deferred promises:

```ts
const a = deferred<void>()
const b = deferred<void>()
const c = deferred<void>()

const activationA = activate('A', { bind: () => a.promise })
const activationB = activate('B', { bind: () => b.promise })
const activationC = activate('C', { bind: () => c.promise })

c.resolve()
await activationC

a.resolve()
b.resolve()
await Promise.all([activationA, activationB])

expect(activeTabId.value).toBe('C')
expect(boundResource(paneId)).toBe('C')
```

Repeat with:

- Chat history load.
- Document durability.
- Custom app record creation.
- Scroll restore.
- Route projection.

### 17.2 Chat draft matrix

- Blank A draft → B → A.
- A first send promotes tab without losing identity.
- A attachment upload still in progress while switching.
- Close A → Undo A.
- Close A → recently-closed eviction releases URL.
- Two duplicate views of one thread have separate drafts.
- Successful send clears only A.
- Rejected send preserves A.
- Pane closes but tab remains hidden with draft.

### 17.3 Streaming matrix

- Stream in A, switch to B, return to A.
- Stream in A, close A, reopen from history.
- Stream completion while A hidden marks attention.
- A and B stream concurrently where supported.
- Static mode foreground stream switching.
- Cloud background job reattachment.
- Delete thread during stream.
- Workspace switch during stream.

### 17.4 Document matrix

- Type, switch immediately before debounce fires.
- Slow local flush.
- Rejected local flush.
- Selection restore with same revision.
- Selection ignored after revision change.
- Scroll restore after image/table layout.
- Inspector/find state.
- Close → Undo.
- Duplicate tabs with separate scroll/selection.
- AI edit running while switching.
- Fatal lazy-editor retry does not duplicate session registration.

### 17.5 Or3Scroll browser tests

Use a real browser, not only jsdom:

- Above-viewport row grows after tab restore.
- History prepend after restore.
- Switch `contentKey` while a scroll frame is pending.
- Switch while touch/pointer is active.
- Restore bottom-follow tab.
- Restore scrolled-up tab during streaming growth.
- Saved anchor row deleted.
- Saved first candidate deleted but second survives.
- Width changes between capture and restore.
- Measurement snapshot stale after theme/font change.
- `useScrollJump` called before ref mount.
- Superseded history load receives abort.

### 17.6 Drag matrix

- 2, 10, 30, and 50 tabs.
- Variable widths.
- Overflowing strip.
- Drag first to last and last to first.
- Auto-scroll in both directions.
- Active tab.
- Hidden-in-split tab.
- Pointer cancel.
- Escape.
- Close button click.
- Middle click.
- Right-click context menu.
- Title/status changes queued during drag.
- Sidebar resize during drag.
- Browser zoom.
- Reduced motion.
- Drag does not remount pane content.

### 17.7 Restore matrix

- Corrupt snapshot.
- Duplicate tab IDs.
- Missing active tab.
- More visible tabs than pane limit.
- Desktop snapshot opened on mobile.
- Mobile snapshot opened on desktop.
- Direct route not in snapshot.
- Deleted direct route.
- Workspace/profile changed.
- Plugin app not installed.
- Schema version unsupported.

---

## 18. Recommended implementation sequence for the tricky work

### PR A — Activation coordinator and view-state session interfaces

Before rendering draggable tabs:

- Add stable tab IDs.
- Add activation generations and abort support.
- Add chat/document session registration.
- Add pure activation tests.
- Keep existing visual navigation.

This establishes correctness before adding more interaction paths.

### PR B — Chat draft ownership and blank promotion

- Pass `tabId`.
- Extract attachment ownership.
- Capture/restore TipTap draft.
- Verify first-send promotion.
- Verify foreground/background streams.

This is the highest-risk state ownership change.

### PR C — Or3Scroll capture/restore

- Add public snapshot types.
- Add capture/restore API.
- Change `contentKey` to tab ID.
- Fix tab-relevant audit issues.
- Add real-browser tests.
- Integrate with ChatContainer session API.

Do not implement scroll restore through `querySelector` in the tab store as a temporary shortcut. Temporary DOM shortcuts tend to become the permanent API.

### PR D — Document session consolidation

- Choose one document switching owner.
- Expand editor session API.
- Separate capture from durability.
- Restore scroll/selection.
- Add slow/failing save tests.

### PR E — Desktop reorder

- Pure geometry/reorder tests.
- Pointer state machine.
- Transform preview.
- Auto-scroll.
- Keyboard commands.
- Browser tests.
- No mobile touch reorder yet.

### PR F — Close/Undo, restore, and polish

- Transactional close.
- Recently closed leases.
- Startup restoration.
- Metadata batching.
- Accessibility and visual regression.
- Performance/memory gates.

---

## 19. Things not to do

### 19.1 Do not use one `<KeepAlive>` entry per open tab

This retains:

- Chat virtualizers.
- TipTap editors.
- ResizeObservers.
- Input bridges.
- Plugin subscriptions.
- Background watchers.
- Attachment state.

Keep mounted views proportional to visible panes.

### 19.2 Do not key drafts by `threadId`

Blank tabs have no thread ID, and duplicate views may need independent state.

### 19.3 Do not key scroll by pane ID

The tab moves between panes; its reading position should move with it.

### 19.4 Do not persist runtime pane UUIDs

Reconstruct bindings by pane order and visible tab IDs.

### 19.5 Do not infer switch completion from `nextTick` alone

A lazy editor, history load, measurement correction, or custom app init can outlive a Vue tick. Use explicit session-ready promises plus activation generations.

### 19.6 Do not mutate tab order continuously during drag

It produces reactive churn and complicated target movement. Preview with transforms and commit once.

### 19.7 Do not release attachments on pane unmount

Release when the tab draft is cleared, permanently closed, or evicted.

### 19.8 Do not make cloud sync completion a prerequisite for switching

Require local durability. Let cloud sync retry.

### 19.9 Do not let a stale restore focus an old editor

Every delayed focus/restore operation must verify activation ownership.

### 19.10 Do not make every tab independently subscribe to its DB record

Use centralized metadata resolution.

---

## 20. Suggested minimal new interfaces

These interfaces are enough to connect the complex behavior without turning tabs into a platform-wide rewrite.

```ts
export interface WorkspaceViewSession<TState = unknown> {
    capture(): TState
    ensureLocalDurability?(): Promise<void>
    restore(
        state: TState | undefined,
        context: {
            signal: AbortSignal
            focus: boolean
        }
    ): Promise<void>
}

export interface WorkspacePaneHost {
    registerSession(
        paneId: string,
        tabId: string,
        session: WorkspaceViewSession
    ): () => void

    getSession(
        paneId: string,
        tabId: string
    ): WorkspaceViewSession | undefined
}

export interface WorkspaceTabHost {
    activateTab(
        tabId: string,
        paneId: string,
        reason: ActivationReason
    ): Promise<void>

    captureTab(tabId: string, paneId: string): void

    closeTab(tabId: string): Promise<boolean>

    closeSplit(paneId: string): Promise<void>
}
```

Chat and document sessions can use different state types while the workspace host treats them uniformly.

---

## 21. Final implementation priorities

When tradeoffs are necessary, prioritize in this order:

1. No data loss.
2. No state leaking between tabs.
3. No stale async activation.
4. Background work remains correctly attached.
5. Scroll position is stable.
6. Keyboard/focus behavior is coherent.
7. Mounted content remains proportional to visible panes.
8. Tab activation feels immediate.
9. Drag is smooth.
10. Visual polish.

A tab bar that looks perfect but occasionally puts A's draft in B, jumps to the wrong message, or applies a late document load is not ready. The integration should make those states structurally difficult to produce, not merely test the common click path.
