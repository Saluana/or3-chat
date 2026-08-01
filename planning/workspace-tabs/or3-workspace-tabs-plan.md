# OR3 Chat Workspace Tabs
## Architecture and Integration Plan

**Status:** Proposed  
**Target repository:** `Saluana/or3-chat`  
**Target branch:** `or3-cloud`  
**Prepared:** 2026-07-31

---

## 1. Executive decision

Add tabs as a **workspace layer above the existing multi-pane system**, rather than converting the current `panes` array directly into tabs.

The distinction is the foundation of the design:

- A **tab** is an open chat, document, or custom pane app. There may be many open tabs.
- A **pane** is a visible viewport or split. The existing workspace profile continues to control how many panes can be visible.
- Each visible pane is bound to one tab.
- A tab can be open without being mounted or visible.
- Only tabs assigned to visible panes render their heavy chat/editor component trees.

This gives OR3 browser-style navigation without throwing away its existing split-pane architecture, plugin API, document flushing, route synchronization, pane resizing, or workspace-profile system.

It also creates a useful OR3-specific advantage over ordinary browser and editor tabs: **one compact global tab strip can manage many open resources and several visible splits without adding a separate tab row to every split**.

---

## 2. Product goals

The implementation should:

1. Keep the desktop workspace chrome to one row.
2. Keep each visual tab at or below 32px high.
3. Preserve the existing split-pane feature.
4. Allow far more open tabs than visible panes.
5. Switch tabs instantly and predictably.
6. Preserve chat drafts, document edits, scroll position, and relevant view state while switching.
7. Avoid mounting every open chat and editor.
8. Restore the previous local tab session after reload.
9. Work cleanly on phone-sized installed-PWA layouts.
10. Preserve existing pane hooks, custom pane apps, theme overrides, command-palette integration, and route behavior.
11. Be fully keyboard accessible and screen-reader understandable.
12. Add no large state-management or drag-and-drop dependency.
13. Be delivered in small, independently testable pull requests.

---

## 3. Explicit non-goals for the first release

These are useful ideas, but they should not be allowed to turn the first implementation into a workbench rewrite:

- Cloud-syncing tab order or open-tab state between devices.
- Tab groups.
- Pinned tabs.
- Vertical tabs.
- Multi-selecting tabs.
- True operating-system browser windows.
- Multiple browser-history entries for every tab switch.
- Unbounded `<KeepAlive>` caching of every chat and editor.
- A full VS Code-style editor-group model.
- A new public plugin API for every tab lifecycle event.
- Duplicate views of the same resource unless explicitly requested by an existing plugin or a later “Open duplicate” command.
- Persisting unsent chat attachments or composer drafts across a full browser restart.
- Mobile drag reordering in the first release.

---

## 4. Current OR3 architecture and why it matters

### 4.1 `PageShell.vue` is already the workspace host

`app/components/PageShell.vue` currently owns:

- The 46px top navigation.
- Theme, notification, new-pane, and plugin header actions.
- Mobile sidebar controls.
- The existing multi-pane renderer.
- Chat and document selection from the sidebar.
- Route projection through `history.replaceState`.
- Initial route and workspace-profile pane setup.
- Deletion handling.
- Command-palette host context.
- Document capture and flush integration.

The tab implementation should **reduce**, not increase, the responsibilities in this file. The existing top navigation should be extracted into a dedicated workspace-chrome component, while `PageShell` remains the orchestration boundary.

### 4.2 `useMultiPane` should remain the visible-viewport engine

`app/composables/core/useMultiPane.ts` already handles:

- Stable pane IDs.
- Active pane selection.
- Pane creation and closure.
- Split limits.
- Custom pane apps.
- Chat history loading with stale-request protection.
- Pane-width persistence and resizing.
- Existing pane lifecycle hooks.
- A global pane API used by plugins.

This is valuable, working infrastructure. It should continue to represent **visible splits**, not be expanded into a giant tab/session store.

### 4.3 Mobile is already single-pane by policy

Workspace profiles currently expose a desktop pane limit and a `single-pane` mobile policy. Tabs should be independent from that policy:

- Desktop may show one to several bound tabs at once.
- Mobile may keep many tabs open but mount only one.
- Workspace-profile initial panes can become several tabs on mobile even though only the first is visible.

### 4.4 Chat and document components already support resource switching

The chat container can switch thread IDs in place, and the document layer already captures and flushes pending edits before switching. These mechanisms should be used by a small tab-to-pane binding adapter instead of recreating a second rendering stack.

---

## 5. Product vocabulary

The UI and code should consistently distinguish these concepts:

| Term | Meaning |
|---|---|
| **Tab** | An open chat, document, blank chat draft, or custom pane app |
| **Active tab** | The tab assigned to the currently focused pane |
| **Visible tab** | A tab assigned to any pane, including an inactive split |
| **Hidden tab** | An open tab not currently assigned to a pane |
| **Pane / split** | A visible viewport managed by `useMultiPane` |
| **New tab** | Opens a new blank chat tab in the active pane |
| **New split** | Adds a visible pane and opens a new blank chat tab in it |
| **Close tab** | Removes the resource from the open-tab session |
| **Close split** | Removes a viewport but leaves its tab open and hidden |

The existing “New window” icon can remain, but its tooltip should say **New split**. The tab-strip `+` button should say **New tab**. This prevents two similar controls from having ambiguous behavior.

---

## 6. Core interaction contract

### 6.1 Opening a resource

All entry points should call one shared command:

```ts
openResource(resource, {
  target: 'active' | 'background' | 'split',
  allowDuplicate?: boolean
})
```

This command should be used by:

- Sidebar chats.
- Sidebar documents.
- New chat and new document actions.
- Search and command palette results.
- Notification actions.
- Project-tree items.
- Plugin pane-app launchers.
- Direct route initialization.

Default behavior:

1. If that resource is already open, focus its tab.
2. If it is already visible in another split, focus that split.
3. If the active tab is an untouched blank chat, reuse it.
4. Otherwise, create a new tab immediately after the active tab and activate it.
5. Do not implement VS Code-style preview tabs in the first release.

This is predictable, prevents duplicate clutter, and still lets explicit plugin calls request a duplicate instance when needed.

### 6.2 Clicking a tab

- If the tab is visible in any pane, focus that pane.
- If the tab is hidden, assign it to the active pane.
- The tab displaced from that pane remains open and becomes hidden.
- The URL is replaced with the active tab’s chat/document route.
- The active tab scrolls into view in the strip.
- Mouse activation must not unexpectedly move focus into the content panel.
- Keyboard activation should place focus according to the tablist interaction contract.

### 6.3 Creating a tab

The `+` control at the end of the tab strip:

- Creates an ephemeral blank chat tab.
- Inserts it after the active tab.
- Assigns it to the active pane.
- Reuses the active tab when it is already an untouched blank chat.
- Keeps a stable `tabId` when the first sent message creates a real thread.

### 6.4 Creating a split

The right-side window-plus action:

- Uses the existing `canAddPane` policy.
- Adds a new pane.
- Creates a new blank chat tab.
- Binds the new tab to the new pane.
- Focuses the new pane and tab.
- Is hidden or disabled on mobile according to the existing single-pane policy.
- Continues to show the existing max-pane tooltip.

### 6.5 Closing a split

Closing a split:

- Unbinds its tab.
- Leaves that tab open in the tab strip.
- Closes only the pane.
- Focuses the nearest remaining pane.
- Never destroys a chat, document, draft, or background generation.

Move the close-split action from an overlay inside each pane into the right-side action cluster or an active-split menu. This supports the requested “all actions on one side” layout.

### 6.6 Closing a tab

When a tab is closed:

1. Capture lightweight view state.
2. For a document, capture and flush the active editor.
3. Remove the tab from the ordered tab set.
4. If it was visible:
   - Prefer the nearest hidden tab to fill that pane.
   - Otherwise close that pane when another pane remains.
   - Otherwise create a blank chat tab so the workspace is never empty.
5. Push a snapshot onto a bounded recently-closed stack.
6. Show a short Undo toast.

Closing a tab must not silently stop an AI generation. Background work should continue through the existing background-job architecture. The closed chat can be reopened from history or Undo.

### 6.7 Reopening a closed tab

- Keep the last 10 closed-tab snapshots in memory for the session.
- Reopen in its previous order position when possible.
- Restore its draft/view state when still available.
- Expose the action through the context menu and command palette.
- Do not persist the recently-closed stack to cloud state.

### 6.8 Reordering tabs

Desktop behavior:

- Drag horizontally after a small movement threshold.
- Capture the pointer.
- Move a lightweight drag preview with `transform`.
- Shift neighboring tabs with transforms.
- Commit the array reorder only when the pointer is released.
- Keep the active pane and mounted content unchanged.

Mobile behavior in the first release:

- Horizontal swiping scrolls the tab strip.
- Reordering is available through a context menu or “Move left / Move right.”
- Direct long-press drag can be added only after touch scrolling is proven reliable.

---

## 7. State model

### 7.1 Resource descriptors

```ts
export type WorkspaceResource =
  | {
      kind: 'chat'
      threadId: string | null
    }
  | {
      kind: 'document'
      documentId: string
    }
  | {
      kind: 'app'
      appId: string
      recordId?: string
      instanceKey?: string
    }
```

A blank chat uses `threadId: null` and remains distinguishable by its stable `tabId`.

### 7.2 Tab descriptor

```ts
export interface WorkspaceTab {
  id: string
  resource: WorkspaceResource
  cachedTitle: string
  createdAt: number
  lastActivatedAt: number
  ephemeral: boolean
}
```

Keep transient state out of the persisted descriptor:

```ts
export interface WorkspaceTabRuntime {
  status: 'idle' | 'loading' | 'streaming' | 'saving' | 'attention' | 'error'
  draft?: ChatTabDraft
  viewState?: WorkspaceTabViewState
}
```

### 7.3 Runtime workspace state

```ts
export interface WorkspaceTabsState {
  tabs: WorkspaceTab[]
  activeTabId: string
  paneBindings: Map<string, string> // runtime paneId -> tabId
  recentlyClosed: ClosedTabSnapshot[]
}
```

### 7.4 Persisted snapshot

Pane IDs are runtime UUIDs and should not be persisted. Persist visible tab IDs in pane order instead:

```ts
export interface WorkspaceTabsSnapshotV1 {
  schemaVersion: 1
  tabs: WorkspaceTab[]
  activeTabId: string
  visibleTabIds: string[]
  activeVisibleIndex: number
  savedAt: number
}
```

On restore:

- Recreate the required pane count up to the current profile limit.
- Bind `visibleTabIds` by pane position.
- On mobile, mount only the active visible tab and leave the rest open but hidden.
- Keep the existing pane-width storage independent.

### 7.5 Invariants

The core transition layer must enforce:

1. Every tab ID is unique.
2. Every pane binding references an existing tab.
3. A tab is assigned to no more than one pane.
4. The active tab is assigned to the active pane.
5. At least one tab always exists.
6. At least one pane always exists.
7. A canonical resource is opened once by default.
8. An ephemeral blank tab keeps the same tab ID when promoted to a real chat.
9. Closing a split never closes its tab.
10. Closing a tab never leaves an invalid pane binding.
11. Late async activations cannot overwrite a newer activation.

Implement these transitions as small pure functions or a compact reducer. Do not introduce Pinia or another global state framework solely for tabs.

---

## 8. Canonical resource identity

Default deduplication keys:

```txt
chat:<threadId>
document:<documentId>
app:<appId>:<recordId>
app:<appId>:instance:<instanceKey>
blank-chat:<tabId>
```

Rules:

- Sidebar selection focuses an existing canonical tab rather than creating another.
- A blank chat is unique by tab ID.
- First send promotes `blank-chat:<tabId>` to `chat:<threadId>` without moving the tab.
- Existing plugin calls that explicitly place the same resource into another pane may set `allowDuplicate: true`.
- A later “Open duplicate” context command can use an instance key.

---

## 9. Tab-to-pane binding adapter

Introduce a narrow orchestration service between the new tab model and the existing pane model.

Suggested interface:

```ts
interface WorkspaceTabHost {
  focusPane(paneId: string): void
  addPane(): Promise<string | null>
  closePane(paneId: string): Promise<void>
  bindResourceToPane(
    paneId: string,
    resource: WorkspaceResource,
    activationToken: number
  ): Promise<void>
}
```

`bindResourceToPane` should:

### Chat

- Update the pane to chat mode.
- Clear document association.
- Call the existing `setPaneThread`.
- Rebind the existing `ChatContainer`.
- Restore the tab’s composer and scroll state.

### Document

- Capture the outgoing document editor.
- Flush or queue the outgoing document state.
- Update the pane to document mode.
- Assign the target document ID.
- Restore editor scroll/selection where supported.

### Custom pane app

- Use the existing `setPaneApp`.
- Use `PaneAppDef.label` and `PaneAppDef.icon` for tab metadata.
- Remount hidden custom apps unless they later opt into a view-state adapter.

### Async ownership

Rapid tab switching can create races across document flushes, app initialization, and message loads. Maintain an activation generation counter per pane:

```ts
const activationGeneration = new Map<string, number>()
```

Each activation increments the pane’s generation. After every awaited operation, verify that the generation still matches. A late activation must become a no-op.

The existing chat loader already applies this pattern internally; the tab host must extend it across resource kinds.

---

## 10. Preserving state without mounting every tab

### 10.1 Why not cache every tab component

Vue `<KeepAlive>` preserves component instances, but every cached chat/editor tree still consumes memory and keeps lifecycle complexity alive. A user with 30 tabs should not have 30 TipTap editors, chat virtualizers, resize observers, input bridges, and background watchers retained.

Use **O(visible panes)** mounted content.

A small bounded cache can be evaluated later, but it is not required for v1.

### 10.2 Chat draft state

`ChatInputDropper.vue` currently keeps the composer text and TipTap editor in the mounted pane component. That state would otherwise follow the pane rather than the tab.

Add a stable `tabId`/`draftKey` prop through:

```txt
PageShell
  -> ChatContainer
    -> ChatInputDropper
```

Create an in-memory tab draft store containing:

- Plain text.
- TipTap JSON where available.
- Attachment descriptors and upload state that can safely remain alive.
- Selected pending system prompt.
- Composer-specific settings only when they are currently pane-local.

Capture on:

- Tab deactivation.
- Split closure.
- Component unmount.
- Draft change, with a short debounce.

Restore when the tab becomes visible again.

Do not persist unsent attachments across a full restart in v1. Draft persistence across restart can be considered separately because it has storage, privacy, and blob-lifecycle implications.

### 10.3 Chat scroll state

Use a lightweight state such as:

- Message anchor ID.
- Offset relative to that message.
- Whether the user was pinned to bottom.
- Fallback absolute scroll offset.

The anchor approach is more robust when messages stream or history is prepended.

Expose a small capture/restore API from `ChatContainer` or `Or3Scroll`. Do not reach into private DOM structure from the tab store.

### 10.4 Document view state

Use the existing document-editor session registration to capture durable content.

Add optional lightweight view-state capture for:

- Editor scroll position.
- Selection/caret range.
- Open side panels or outline state only if currently local to the editor.

Document content and title remain owned by the document store, not the tab store.

### 10.5 Background AI work

A hidden or closed tab should not own the lifecycle of the AI job.

- Generation continues through the existing background-job mechanism.
- Tab status listens to chat/stream hooks or durable job state.
- When a hidden generation completes, mark the tab `attention`.
- Clear the attention state when the tab becomes active.
- Closing the tab removes only the tab UI, not the job.

---

## 11. Title and status metadata

### 11.1 Titles

Fallback titles:

- `New chat`
- Thread title
- `Untitled document`
- Document title
- Custom pane-app label

Use a centralized metadata resolver rather than one database watcher per tab.

Recommended approach:

- Store a cached title in the persisted tab descriptor for instant first paint.
- Batch-load current thread and document titles.
- Update a reactive metadata map through existing DB update hooks or a small number of Dexie live queries.
- Update the tab when a blank chat receives its generated thread title.
- Truncate visually, but expose the full title in tooltip and accessible name.

### 11.2 Status indicators

Keep indicators subtle and semantic:

| Resource state | Indicator |
|---|---|
| Chat generating | Small spinner or animated dot |
| Hidden generation completed | Attention dot |
| Document saving | Small neutral dot/spinner |
| Document save failed | Error indicator |
| Resource loading | Lightweight skeleton/indicator |
| Normal | Type icon only |

Do not use an unsaved `*` for documents if the normal product contract is automatic saving.

Status must be included in the accessible label, not represented only by color.

---

## 12. Desktop layout

### 12.1 One-row chrome

Do not add a second desktop row.

Recommended structure:

```txt
[ scrollable tab strip ........................ ] [ split ] [ theme ] [ bell ] [ more ]
```

- Tabs: `flex: 1; min-width: 0`.
- Actions: fixed, right-aligned, `flex-shrink: 0`.
- Core actions never get pushed off screen.
- Plugin header actions move into an overflow menu when space is constrained.
- The existing sidebar stays separate from the tab strip, matching the mockups.

### 12.2 Dimensions

Recommended initial tokens:

```css
--or3-workspace-chrome-height: 44px; /* may align to measured sidebar header */
--or3-tab-height: 32px;
--or3-tab-min-width: 96px;
--or3-tab-preferred-width: 168px;
--or3-tab-max-width: 220px;
--or3-tab-gap: 6px;
```

The visible tab stays at or below the requested 32px.

Migrate the existing hard-coded `46px` offset to a shared CSS variable or measured header-height token. Do not maintain separate magic numbers in `PageShell`, the sidebar, and tab components.

### 12.3 Overflow behavior

- Never wrap desktop tabs into multiple rows.
- Shrink tabs toward their minimum width.
- Then allow horizontal overflow.
- Add subtle leading/trailing fades.
- Auto-reveal the active tab using nearest-edge scrolling.
- Respect reduced-motion preferences.
- Add a “List open tabs” control that opens the existing command palette filtered to open tabs.
- Keep the native scroll container keyboard and touch accessible even if the scrollbar is visually minimized.

### 12.4 Stable geometry

- Reserve space for the close button even when it is visually hidden.
- Do not let title text shift on hover.
- Use opacity rather than conditional layout for hover-only controls.
- Avoid animating width during activation.
- Use only transform/opacity for reordering and small state transitions.

---

## 13. Mobile layout

A phone does not have enough horizontal room for branding, sidebar, actions, several tabs, and a new-tab button in one row.

Use two compact rows:

```txt
Row 1, 48px: [menu] [brand] ........ [theme] [notifications/more]
Row 2, 36-40px: [ horizontally scrolling 32px tabs ] [+]
```

Rules:

- The tab itself remains 32px high.
- The second row must not exceed 40px unless safe-area requirements force it.
- The split action is hidden because the mobile workspace policy is single-pane.
- The close target remains at least 24x24 CSS pixels.
- Horizontal swipe scrolls tabs naturally.
- Set `touch-action: pan-x` on the strip.
- Do not begin a reorder from an ordinary swipe.
- Keep the active tab revealed after orientation changes.
- Test installed-PWA safe-area insets and the existing bottom navigation together.
- The mobile input must continue to stay above the bottom navigation and safe area.

---

## 14. Accessibility contract

### 14.1 Single-pane/default semantics

Use the WAI-ARIA tab pattern:

- `role="tablist"` on the strip.
- `role="tab"` on each tab.
- `aria-selected`.
- `aria-controls`.
- One roving `tabindex="0"` on the selected tab.
- `role="tabpanel"` on the focused content pane.
- Left/Right arrows.
- Home/End.
- Enter/Space when manual activation is needed.
- Delete may close, with the same action available in the context menu.
- Focus moves to the logical adjacent tab after closure.

### 14.2 Split-pane semantics

Only one pane is focused at a time.

- The tab assigned to the focused pane is the selected tab.
- Tabs visible in other splits receive a secondary visible marker and an accessible description such as “Open in another split.”
- Secondary pane content is exposed as a labelled `region`, not as another selected tabpanel.
- When a secondary pane is focused, its tab becomes selected.

This preserves one active selection while still communicating simultaneous visibility.

### 14.3 Activation latency

Automatic keyboard activation should ship only when the panel changes with no noticeable delay. The implementation should synchronously:

1. Update selected styling.
2. Bind the tab to the pane.
3. Show either content or an immediate loading surface.

If measured activation cannot meet the performance budget, arrow keys should move focus and Enter/Space should activate.

### 14.4 Targets and focus

- Every close and action target is at least 24x24 CSS pixels.
- The entire 32px tab is clickable.
- Visible focus rings must work in light, dark, forced-colors, and high-contrast modes.
- Tooltips are supplementary; accessible names are always present.
- Status is conveyed in text.
- Reordering has keyboard alternatives.
- Interaction animation is disabled for users requesting reduced motion.

---

## 15. Theme integration

Keep the tab bar structurally owned by core in v1, but expose semantic styling hooks.

Suggested theme identifiers:

```txt
shell.workspace-chrome
shell.tab
shell.tab-active
shell.tab-visible-in-split
shell.tab-close
shell.tab-new
shell.tab-overflow
shell.tab-status
shell.split-new
shell.split-close
```

Suggested CSS variables:

```css
--or3-tab-bg
--or3-tab-bg-hover
--or3-tab-bg-active
--or3-tab-border
--or3-tab-border-active
--or3-tab-text
--or3-tab-text-active
--or3-tab-attention
--or3-workspace-chrome-bg
```

Use existing Material-style OR3 surface and primary tokens as fallbacks.

Do not require every theme to replace the entire tab component. Full component replacement can be added only if the theme architecture later demonstrates a real need.

---

## 16. Header-action integration

The existing header-action registry remains the source of plugin actions.

Recommended rendering policy:

- Core actions stay visible on desktop.
- Theme and notifications stay visible as shown in the mockup.
- Plugin actions are rendered on the same right side.
- Lower-priority or labelled plugin actions move into a More menu.
- On mobile, plugin actions default to the More menu.
- Extend the action context additively with:
  - `activeTab`
  - `activePane`
  - `tabCount`
  - `paneCount`
- Do not let unknown plugin action counts squeeze the tab strip below its usable minimum.

---

## 17. Route and session behavior

### 17.1 Route projection

Keep the existing behavior:

- The URL represents the active chat or document.
- Tab switching uses `history.replaceState`.
- It does not create browser back-stack noise.
- Custom pane apps retain their current route behavior unless they already provide one.

### 17.2 Direct links

For `/chat/:id` or `/docs/:id`:

1. Restore the local tab manifest.
2. Ensure the route resource exists as a tab.
3. Make it active.
4. Bind it to the active pane.
5. Restore other tabs behind it.
6. Keep current deleted/missing-resource validation behavior.

The route wins over the stored active tab.

### 17.3 Session persistence

Persist only the lightweight tab manifest:

- Ordered descriptors.
- Cached titles.
- Active tab ID.
- Visible tab IDs by pane order.
- Active visible index.
- Schema version.
- Timestamp.

Scope the key by workspace and workspace profile where those values are available:

```txt
or3:workspace-tabs:v1:<workspace-or-local>:<profile>
```

Persistence rules:

- Debounce writes.
- Flush on `pagehide`.
- Validate and sanitize on read.
- Ignore unknown schema versions.
- Drop inaccessible, deleted, or malformed resources.
- Never persist messages, document bodies, API keys, generation payloads, or attachment blobs in the tab manifest.
- Keep tab state device-local. It should not enter the cloud sync data model.

---

## 18. Workspace-profile integration

- `desktopPaneLimit` continues to limit visible panes.
- It does not limit open tabs.
- `initialPanes` create matching tabs.
- On desktop, bind as many initial tabs as allowed.
- On mobile, create all valid initial tabs but bind only the first.
- If a profile lowers the pane limit, close extra panes without closing their tabs.
- If a profile raises the limit, do not automatically open more splits.
- Existing pane-width persistence remains untouched.
- Profile changes should use the same restore/reconciliation path as startup.

---

## 19. Plugin compatibility

### 19.1 Preserve existing pane APIs

Do not rename or remove:

- Pane state fields.
- Existing pane hooks.
- Global multi-pane API methods.
- Custom pane-app registration.
- Header-action registration.

### 19.2 Reconciliation for external pane mutations

A plugin may still call the existing pane API directly. Add a reconciliation watcher:

- If a pane resource changes outside the tab command layer, find or create a matching tab.
- Bind that tab to the pane.
- If the resource is already visible elsewhere and the plugin explicitly changed another pane, create an allowed duplicate tab instance rather than undoing the plugin.
- Log a development warning when reconciliation was required, so plugin authors can adopt the newer command later.

This lets the tab system ship without breaking existing extensions.

### 19.3 Custom pane apps

Use existing `label` and `icon` metadata.

Future additive extension, not required for v1:

```ts
tab?: {
  resolveTitle?: (recordId?: string) => string | Promise<string>
  instancePolicy?: 'single-per-record' | 'multiple'
}
```

---

## 20. Suggested file structure

```txt
app/
  components/
    workspace-tabs/
      WorkspaceChrome.vue
      WorkspaceTabBar.vue
      WorkspaceTab.vue
      WorkspaceTabOverflow.vue
      WorkspaceTabContextMenu.vue
      WorkspaceChromeActions.vue
  composables/
    core/
      useWorkspaceTabs.ts
      useWorkspaceTabHost.ts
      useWorkspaceTabMetadata.ts
      useWorkspaceTabPersistence.ts
      useWorkspaceTabDrafts.ts
      workspace-tab-transitions.ts
  core/
    workspace-tabs/
      types.ts
      resource-key.ts
      snapshot-schema.ts
  components/
    PageShell.vue
    PageShell.css
    chat/
      ChatContainer.vue
      ChatInputDropper.vue
    documents/
      DocumentEditor.vue
  composables/
    core/
      useMultiPane.ts
      usePageShellTheme.ts
    documents/
      usePaneDocuments.ts
  tests/
    ...
```

Avoid creating every file on day one. The minimum clean split is:

1. Types and pure transitions.
2. One orchestration composable.
3. One persistence module.
4. One tab bar component.
5. One extracted workspace-chrome component.

---

## 21. Performance design

### 21.1 Required behavior

- Open-tab count affects only tab-button and metadata cost.
- Mounted heavy component count equals visible pane count.
- Title updates are centralized.
- Reordering does not remount content.
- Switching does not recreate the entire `PageShell`.
- Tab status updates do not rerender every pane.
- Persistence never runs on every animation frame.
- Drag pointer movement is scheduled through `requestAnimationFrame`.
- No synchronous query per tab during render.

### 21.2 Proposed budgets

| Measurement | Target |
|---|---:|
| Selected-tab visual response | Same frame |
| Tab activation p95 | <= 50ms |
| Activation JavaScript work | <= 8ms in a frame where practical |
| Long task caused by tab action | 0 tasks over 50ms |
| Reorder interaction | 60fps target |
| Layout shift opening/closing tabs | 0 tab-caused CLS |
| Mobile horizontal overflow | 0 page-level x-overflow |
| Hidden heavy tab component trees | 0 |
| Session restore with 20 tabs | Within existing OR3 performance budgets |

Instrument development builds with `performance.mark` around:

- `tab-open`
- `tab-activate`
- `tab-bind-pane`
- `tab-close`
- `tab-restore`
- `tab-reorder`

Keep the existing browser performance-budget suite as the release gate.

---

## 22. Testing strategy

### 22.1 Pure unit tests

Test the transition layer without Vue rendering:

- Open first tab.
- Reuse untouched blank tab.
- Promote blank chat to thread.
- Dedupe canonical resources.
- Explicit duplicate resource.
- Activate hidden tab.
- Focus tab visible in another pane.
- Close hidden tab.
- Close active visible tab with hidden replacement.
- Close active visible tab with pane collapse.
- Close last tab and create blank fallback.
- Close split without closing tab.
- Reorder active and inactive tabs.
- Restore malformed or stale snapshot.
- Restore more visible tabs than current pane limit.
- Lower mobile/desktop pane limit.
- Ignore stale activation token.
- Deletion reconciliation.
- Workspace/profile scope changes.

### 22.2 Component tests

- Tab title truncation and tooltip.
- Close button does not change tab width on hover.
- Roving tabindex.
- Arrow/Home/End behavior.
- Focus after closure.
- Context-menu actions.
- Active tab auto-reveal.
- Overflow fades.
- Status accessible labels.
- 24px close target.
- Reduced-motion behavior.
- Light, dark, and forced-colors states.

### 22.3 Integration tests

- Sidebar chat opens/focuses tab.
- Sidebar document opens/focuses tab.
- New chat and new document.
- First send promotes blank tab.
- Document capture and flush on switch.
- Rapid A -> B -> C switching leaves C active.
- Hidden chat generation completes and marks attention.
- Close tab does not abort background generation.
- Notification focuses an existing tab.
- Command-palette result focuses an existing tab.
- Custom pane app creates a tab.
- Existing global pane API reconciles a tab.
- Route initialization overrides stored active tab.
- Deleted chat/document removes or resets its tab.
- Workspace-profile initial panes.
- Theme changes preserve tab geometry.

### 22.4 Playwright E2E

Desktop:

- 1440px and 1024px widths.
- One row only.
- Tabs never overlap right-side actions.
- Add, switch, close, undo, reorder.
- Split creation and closure.
- 30-tab overflow and active reveal.
- Reload session restore.
- Keyboard-only operation.
- Middle-click close.
- Light/dark screenshots.

Mobile:

- 390x740, 393x852, and 430px widths.
- No page horizontal overflow.
- 32px tab height.
- Natural horizontal strip scrolling.
- New-tab control remains reachable.
- Header and bottom navigation do not cover content.
- Input remains above safe area.
- Tab closure and Undo.
- Orientation change.

### 22.5 Stress cases

- 50 open tabs.
- Long titles.
- Many identical title prefixes.
- Continuous stream while switching repeatedly.
- Document auto-save while closing.
- Sidebar resize while tab strip is overflowing.
- Profile pane-limit change.
- Theme hot reload.
- Plugin action overflow.
- Resource deleted remotely during activation.
- Slow document flush.
- Slow custom app initialization.

---

## 23. Rollout plan

### Pull request 1 — Core model behind a feature flag

- Add types, canonical resource keys, transitions, snapshot validation, and unit tests.
- No production UI change.
- Add `features.workspaceTabs.enabled`.
- Add development diagnostics for invariant violations.

### Pull request 2 — Host integration and desktop chrome

- Extract workspace chrome from `PageShell`.
- Bind tabs to existing panes.
- Implement open/focus/new/close.
- Move actions to the right.
- Add desktop single-row tab strip.
- Keep legacy layout available through the feature flag.

### Pull request 3 — State preservation, restore, and mobile

- Composer draft adapter.
- Scroll/view-state adapter.
- Document capture/flush hardening.
- Session persistence.
- Mobile two-row chrome.
- Direct-route restore behavior.

### Pull request 4 — Polish and hardening

- Undo/reopen.
- Context menu.
- Desktop drag reorder.
- Status and attention indicators.
- Command-palette open-tabs source.
- Accessibility audit.
- Visual regression coverage.
- Performance instrumentation and budgets.

After one stable release, remove the legacy header branch rather than permanently maintaining two systems.

---

## 24. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `PageShell` becomes more complex | Extract `WorkspaceChrome`; keep transitions and persistence in separate modules |
| Draft follows pane instead of tab | Pass stable `tabId` to composer and use a tab-keyed draft store |
| Rapid switching applies stale async work | Per-pane activation generations |
| Documents lose final edits | Capture editor before unbinding; flush on close; test slow/failing flush |
| Every tab creates DB subscriptions | Centralized metadata resolver |
| Too many hidden component instances | Mount only visible panes; no unbounded KeepAlive |
| Plugin direct pane calls bypass tabs | Reconciliation watcher and compatibility tests |
| Tab strip fights mobile scrolling | `touch-action: pan-x`; no direct mobile drag in v1 |
| Plugin header actions squeeze tabs | Fixed core cluster plus overflow |
| Route restore fights session restore | Direct route always wins |
| Split mode creates ambiguous selected tabs | One focused/selected tab; secondary visible panes are labelled regions |
| Local session schema changes | Versioned validated snapshot with safe fallback |
| Feature flag becomes permanent debt | Define removal milestone after one stable release |

---

## 25. Definition of done

The feature is ready when:

- Desktop adds no second chrome row.
- Visual tabs are no taller than 32px.
- Mobile tabs remain compact and do not create page-level overflow.
- Tabs and splits are independent concepts.
- Existing pane resizing and profile limits still work.
- Existing custom pane apps still open.
- Existing pane hooks and global API remain compatible.
- Sidebar, search, notifications, and command palette share one open-resource command.
- A blank chat becomes a real thread without replacing its tab identity.
- Switching tabs preserves unsent chat text during the session.
- Document switching cannot lose pending edits.
- Hidden tabs do not keep heavy editor/chat trees mounted.
- Reload restores the tab manifest safely.
- Closing a split does not close the tab.
- Closing a tab offers Undo.
- Background generation is not aborted by closing its tab.
- Keyboard and screen-reader behavior passes the documented contract.
- All unit, integration, E2E, visual, and performance gates pass.
- The implementation adds no large runtime dependency and does not replace `useMultiPane`.
