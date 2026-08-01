# OR3 Chat Workspace Tabs
## Implementation Task List

**Target:** `Saluana/or3-chat` / `or3-cloud`  
**Companion document:** `or3-workspace-tabs-plan.md`

Priority labels:

- **P0:** Required for the feature to ship.
- **P1:** Required for the polished launch.
- **P2:** Explicitly deferred unless the P0/P1 work finishes cleanly.

---

## Phase 0 — Baseline, vocabulary, and rollout safety

### 0.1 Record current behavior — P0

- [ ] Add a short architecture note describing current pane behavior.
- [ ] Record current desktop and mobile screenshots in light and dark themes.
- [ ] Record current behavior for:
  - [ ] New pane.
  - [ ] Close pane.
  - [ ] Sidebar chat selection.
  - [ ] Sidebar document selection.
  - [ ] Direct `/chat/:id` and `/docs/:id` navigation.
  - [ ] Profile initial panes.
  - [ ] Mobile single-pane policy.
  - [ ] Custom pane app launch.
- [ ] Run the existing unit, integration, E2E, and performance suites.
- [ ] Save baseline performance output.

**Acceptance**

- [ ] Existing failures are documented before tab work begins.
- [ ] The tab feature is not blamed for pre-existing failures.

### 0.2 Add a temporary feature flag — P0

Suggested config:

```ts
features: {
  workspaceTabs: {
    enabled: false
  }
}
```

- [x] Add typed config and default.
- [x] Keep the legacy top chrome available while development is incomplete.
- [x] Add a clear removal milestone: one stable release after default enablement.
- [x] Do not fork chat/document business logic between flag paths.

**Acceptance**

- [ ] Enabling/disabling the flag changes only workspace chrome/orchestration.
- [ ] Both paths pass the existing smoke tests during development.

### 0.3 Lock vocabulary — P0

- [x] Use `tab` for an open resource.
- [x] Use `pane` or `split` for a visible viewport.
- [x] Change the existing “New window” tooltip to “New split” when tabs are enabled.
- [x] Label the tab-strip plus button “New tab.”
- [x] Add terminology to developer documentation.

---

## Phase 1 — Pure tab model

### 1.1 Create workspace-tab types — P0

Add:

```txt
app/core/workspace-tabs/types.ts
```

- [x] Define `WorkspaceResource`.
- [x] Define `WorkspaceTab`.
- [x] Define `WorkspaceTabRuntime`.
- [x] Define `WorkspaceTabsState`.
- [x] Define `ClosedTabSnapshot`.
- [x] Define `WorkspaceTabsSnapshotV1`.
- [x] Keep messages, document content, and large editor state out of these types.
- [x] Document which fields are persistent and transient.

### 1.2 Add canonical resource keys — P0

Add:

```txt
app/core/workspace-tabs/resource-key.ts
```

- [x] Implement keys for chat, document, app record, app instance, and blank chat.
- [x] Add `allowDuplicate` support through instance keys.
- [x] Make a blank-chat key stable by tab ID.
- [x] Add tests for malformed IDs and missing app record IDs.

**Acceptance**

- [x] Sidebar opening the same chat twice focuses one tab by default.
- [x] Explicit duplicate requests remain possible.
- [x] Blank chat promotion does not change the tab ID.

### 1.3 Implement pure transitions — P0

Add:

```txt
app/composables/core/workspace-tab-transitions.ts
```

Implement pure, deterministic operations:

- [x] `createInitialState()`
- [x] `openTab()`
- [x] `activateTab()`
- [x] `bindTabToPane()`
- [x] `unbindPane()`
- [x] `closeTab()`
- [x] `closeSplit()`
- [x] `reorderTab()`
- [x] `promoteBlankChat()`
- [x] `markResourceDeleted()`
- [x] `restoreSnapshot()`
- [x] `reconcilePaneResource()`

Enforce invariants after every development/test transition:

- [x] Unique tab IDs.
- [x] Valid active tab.
- [x] Valid pane bindings.
- [x] One pane per tab.
- [x] One tab per pane.
- [x] Workspace never empty.
- [x] Active tab matches active pane binding.

**Acceptance**

- [x] Transition tests do not require Vue or IndexedDB.
- [x] Invalid input produces a safe fallback rather than a half-valid state.

### 1.4 Unit-test the state machine — P0

Create focused tests for:

- [x] Initial blank tab.
- [x] Untouched blank reuse.
- [x] Open new resource after active tab.
- [x] Dedupe existing resource.
- [x] Explicit duplicate.
- [x] Activate hidden tab.
- [x] Activate tab visible in another pane.
- [x] Close hidden tab.
- [x] Close visible tab and use hidden replacement.
- [x] Close visible tab and collapse extra pane.
- [x] Close last tab and create blank fallback.
- [x] Close split while preserving tab.
- [x] Reorder tabs.
- [x] Promote blank chat.
- [x] Delete active resource.
- [x] Delete hidden resource.
- [x] Restore invalid snapshot.
- [x] Restore with a lower pane limit.
- [x] Mobile restore with one visible pane.

---

## Phase 2 — Persistence and metadata

### 2.1 Add a versioned snapshot schema — P0

Add:

```txt
app/core/workspace-tabs/snapshot-schema.ts
```

- [x] Validate with the project’s existing schema approach.
- [x] Set `schemaVersion: 1`.
- [x] Clamp string lengths and array sizes.
- [x] Reject duplicate tab IDs.
- [x] Reject pane bindings to missing tabs.
- [x] Ignore unknown fields.
- [x] Safely ignore unsupported future versions.
- [x] Add migration entry point even though v1 has no migration yet.

### 2.2 Add local persistence — P0

Add:

```txt
app/composables/core/useWorkspaceTabPersistence.ts
```

- [x] Scope the key by workspace/local deployment and profile ID.
- [x] Persist:
  - [x] Ordered tab descriptors.
  - [x] Cached titles.
  - [x] Active tab.
  - [x] Visible tab IDs in pane order.
  - [x] Active visible index.
- [x] Do not persist runtime pane UUIDs.
- [x] Debounce writes.
- [x] Flush on `pagehide`.
- [x] Restore before opening non-route background tabs.
- [x] Make the direct route override stored active state.
- [x] Drop deleted/inaccessible resources.
- [x] Keep pane widths in the existing storage path.

**Acceptance**

- [ ] Reload restores 20 tabs without mounting 20 content trees.
- [ ] Corrupt storage opens a safe blank chat.
- [ ] Switching workspaces never leaks another workspace’s tabs.

### 2.3 Add centralized title metadata — P0

Add:

```txt
app/composables/core/useWorkspaceTabMetadata.ts
```

- [x] Batch-load thread titles.
- [x] Batch-load document titles.
- [x] Use custom pane-app label/icon.
- [x] Use cached title for immediate paint.
- [x] Listen to existing DB update/delete hooks or a small number of live queries.
- [x] Update title after chat title generation.
- [x] Avoid one live query per tab.
- [x] Provide full title separately from truncated display title.
- [x] Add fallback titles.

### 2.4 Add runtime status metadata — P1

- [x] Track chat loading/streaming.
- [ ] Track hidden completion/attention.
- [x] Track document saving.
- [x] Track document save errors.
- [x] Clear attention on activation.
- [x] Include status in accessible label.
- [x] Ensure status updates do not rebuild all pane components.

---

## Phase 3 — Tab host and pane integration

### 3.1 Create `useWorkspaceTabs` orchestration — P0

Add:

```txt
app/composables/core/useWorkspaceTabs.ts
```

Responsibilities:

- [x] Own reactive tab state.
- [x] Call pure transitions.
- [x] Coordinate persistence.
- [x] Expose:
  - [x] `openResource`
  - [x] `newTab`
  - [x] `activateTab`
  - [x] `closeTab`
  - [x] `reopenClosedTab`
  - [x] `reorderTab`
  - [x] `newSplit`
  - [x] `closeSplit`
  - [x] `openInSplit`
- [x] Do not load messages or flush documents directly.
- [x] Delegate pane work to the host adapter.

### 3.2 Create the tab host adapter — P0

Add:

```txt
app/composables/core/useWorkspaceTabHost.ts
```

- [x] Map runtime pane IDs to indexes safely.
- [x] Focus an existing pane.
- [x] Add a pane through `useMultiPane`.
- [x] Close a pane through `useMultiPane`.
- [x] Bind chat resource.
- [x] Bind document resource.
- [x] Bind custom pane app.
- [x] Capture outgoing view state.
- [x] Update the URL after successful/optimistic binding.
- [x] Return structured errors for toast/reporting.

### 3.3 Add per-pane activation generations — P0

- [x] Maintain a generation counter by pane ID.
- [x] Increment before each activation.
- [x] Check after every awaited operation.
- [x] Ignore late chat load, document flush, and app initialization.
- [x] Add rapid-switch tests with deliberately delayed promises.

**Acceptance**

- [ ] Clicking A -> B -> C quickly always leaves C visible.
- [ ] A late document flush cannot rebind A over C.
- [ ] A late app record creation cannot consume the wrong pane.

### 3.4 Make pane APIs ID-safe — P0

The existing public API can remain index-based, but tab orchestration should use stable IDs.

- [x] Add internal helpers to find pane index by pane ID.
- [x] Add `activePaneId` computed value or equivalent.
- [x] Avoid storing pane indexes in persisted tab state.
- [x] Test index shifts after closing a pane to the left of the active pane.

### 3.5 Integrate workspace-profile initial panes — P0

- [x] Convert initial pane descriptors into tabs.
- [x] Bind as many as the desktop pane limit allows.
- [x] On mobile, create all tabs but bind one.
- [x] Preserve route-initialized resource priority.
- [x] Lowering the pane limit closes splits but not tabs.
- [x] Raising the limit does not create surprise splits.

### 3.6 Reconcile direct plugin pane mutations — P0

- [x] Watch pane resource identity.
- [x] Detect changes that did not originate from the tab layer.
- [x] Find/create the matching tab.
- [x] Bind it to that pane.
- [x] Allow duplicate instance when a plugin explicitly places the same resource in two panes.
- [x] Preserve existing pane hooks.
- [x] Add development diagnostics.
- [x] Add custom pane-app compatibility tests.

---

## Phase 4 — Preserve chat and document state

### 4.1 Pass stable tab identity into visible content — P0

Update:

```txt
PageShell.vue
ChatContainer.vue
ChatInputDropper.vue
DocumentEditor.vue
```

- [x] Add `tabId` or `viewStateKey` prop.
- [x] Keep existing `paneId` for pane/plugin APIs.
- [x] Do not substitute tab ID for pane ID in existing bridges.
- [x] Document the distinction.

### 4.2 Add tab-keyed chat drafts — P0

Add:

```txt
app/composables/core/useWorkspaceTabDrafts.ts
```

Capture:

- [x] Plain composer text.
- [x] TipTap JSON.
- [x] Pending prompt ID.
- [x] Safe attachment state that can remain in memory.
- [x] Relevant composer settings that are currently pane-local.

Integrate:

- [x] Restore on tab activation.
- [x] Capture on deactivation.
- [x] Capture on component unmount.
- [x] Debounce live changes.
- [x] Clear only after durable send acceptance.
- [x] Transfer state when blank tab becomes a real thread.
- [x] Preserve state through Undo close.
- [x] Release blob URLs when the draft is permanently discarded.

**Acceptance**

- [ ] Type in tab A, switch to B, return to A, and text remains.
- [ ] Draft from A never appears in B.
- [ ] Sending in A clears only A.
- [ ] Closing and undoing A restores its draft.
- [ ] Closing without undo eventually releases attachment resources.

### 4.3 Add chat scroll capture/restore — P0

- [x] Add a public capture API to `ChatContainer`/`Or3Scroll`.
- [x] Store bottom-pinned state.
- [x] Store anchor message ID and offset.
- [x] Store fallback absolute offset.
- [x] Restore after content-key/thread switch.
- [x] Handle prepended history.
- [x] Handle streaming message growth.
- [x] Do not force bottom when the user had scrolled up.

### 4.4 Harden document switching — P0

- [x] Capture active editor before unbinding.
- [x] Flush local document state.
- [x] Do not block visual activation longer than necessary.
- [ ] On close-tab flush failure:
  - [x] Keep the tab open.
  - [x] Mark error.
  - [x] Show actionable toast.
- [ ] On ordinary switch flush failure:
  - [x] Preserve captured local state.
  - [x] Mark error.
  - [x] Avoid data loss.
- [x] Test slow and rejected flushes.

### 4.5 Add document view-state adapter — P1

- [x] Capture scroll position.
- [x] Capture selection/caret when technically stable.
- [x] Restore only after editor readiness.
- [x] Do not persist editor internals in the tab manifest.
- [x] Add regression tests for switching two documents repeatedly.

### 4.6 Verify background AI lifecycle — P0

- [ ] Start generation in tab A.
- [ ] Switch to B.
- [ ] Confirm A continues.
- [ ] Close A.
- [ ] Confirm generation continues according to current background-job behavior.
- [ ] Reopen A from history.
- [ ] Confirm result reattaches.
- [ ] Mark hidden completion as attention.
- [ ] Ensure closing a tab never calls stop-generation implicitly.

---

## Phase 5 — Extract and rebuild workspace chrome

### 5.1 Extract `WorkspaceChrome.vue` — P0

Move top-chrome rendering out of `PageShell.vue`.

Suggested structure:

```txt
WorkspaceChrome
  WorkspaceTabBar
  WorkspaceChromeActions
```

- [x] Keep `PageShell` responsible for orchestration only.
- [x] Move sidebar-toggle rendering into the chrome component.
- [x] Move theme, notifications, split, and header actions.
- [x] Keep handlers passed as explicit props/events.
- [x] Add stable test IDs.
- [x] Do not move business data into the component.

### 5.2 Replace hard-coded top offsets — P0

- [x] Introduce `--or3-workspace-chrome-height`.
- [x] Align with the measured sidebar header height where practical.
- [x] Replace `46px` padding/clearance duplication.
- [x] Keep a safe fallback token.
- [ ] Test expanded and collapsed sidebar.
- [ ] Test sidebar resizing during tab overflow.
- [ ] Verify no first-paint layout jump.

### 5.3 Build the desktop tab strip — P0

Add:

```txt
WorkspaceTabBar.vue
WorkspaceTab.vue
```

- [x] One row only.
- [x] Visual tab height <= 32px.
- [x] `min-width: 96px`.
- [x] Preferred width around 168px.
- [x] Maximum width around 220px.
- [x] Ellipsis long titles.
- [x] Full-title tooltip.
- [x] Type icon.
- [x] Status indicator.
- [x] Reserved close-button geometry.
- [x] Active style.
- [x] Secondary visible-in-split style.
- [x] Hover style.
- [x] Focus-visible style.
- [x] New-tab button at end.
- [x] Horizontal overflow.
- [x] Leading/trailing fades.
- [x] Active auto-reveal.
- [x] Reduced-motion support.

### 5.4 Build the right-side action cluster — P0

Order:

- [x] New split.
- [x] Close active split when applicable or place it in split menu.
- [x] Theme toggle.
- [x] Notifications.
- [x] Compact plugin actions.
- [x] More overflow.

Rules:

- [x] Fixed right side.
- [x] Never overlaps tabs.
- [x] Never shrinks below target size.
- [x] Disabled split state keeps existing tooltip.
- [x] Mobile hides split controls.
- [x] Labelled plugin actions default to overflow.
- [x] Existing header-action handler/error behavior remains.

### 5.5 Remove pane close overlay — P1

- [x] Move active split closure to the right action cluster/menu.
- [x] Remove the current top-right pane overlay.
- [x] Keep a clear visible indication of the focused split.
- [x] Ensure users can close a split by keyboard and screen reader.

---

## Phase 6 — Mobile chrome

### 6.1 Implement compact two-row layout — P0

- [x] Top app row around 48px.
- [x] Tab row no more than 40px.
- [x] Visual tabs remain 32px.
- [x] Menu and brand on left.
- [x] Core actions on right.
- [x] Tabs horizontally scroll.
- [x] New-tab button remains reachable.
- [x] Split controls hidden.
- [x] Respect safe-area top inset.
- [x] Avoid extra whitespace between rows.

### 6.2 Touch behavior — P0

- [x] Set appropriate `touch-action`.
- [x] Ordinary horizontal swipe scrolls.
- [x] Vertical page/content gestures remain unaffected.
- [x] Close button does not accidentally activate the tab.
- [x] Tap activation is immediate.
- [x] No 300ms-style delayed interaction.
- [x] Do not implement direct mobile drag reorder yet.

### 6.3 Mobile viewport tests — P0

Test at:

- [ ] 390x740.
- [ ] 393x852.
- [ ] 430x932.
- [ ] Landscape phone.
- [ ] Installed PWA.
- [ ] Browser tab.
- [ ] Notched safe-area simulation.

Verify:

- [ ] No page-level horizontal overflow.
- [ ] Chat input remains visible.
- [ ] Bottom navigation does not cover content.
- [ ] Tab strip does not cover message content.
- [ ] Active tab stays visible after rotation.

---

## Phase 7 — Accessibility

### 7.1 Implement tab semantics — P0

- [x] `role="tablist"`.
- [x] `role="tab"`.
- [x] `aria-selected`.
- [x] `aria-controls`.
- [x] Roving tabindex.
- [x] Focused content `role="tabpanel"`.
- [x] Labelled secondary split regions.
- [x] Accessible close labels.
- [x] Status in accessible names/descriptions.

### 7.2 Keyboard behavior — P0

- [x] Left/Right.
- [x] Home/End.
- [x] Enter/Space when required.
- [x] Delete closes when focus is on tab.
- [x] Context-menu equivalent for close.
- [x] Focus adjacent tab after close.
- [x] Escape closes menus, not tabs.
- [x] Do not intercept arrow keys outside the tab strip.
- [x] Do not globally steal browser `Ctrl/Cmd+W` or `Ctrl+Tab` in v1.
- [x] Add tab commands to the command palette.

### 7.3 Target sizes and high contrast — P0

- [x] Close target >= 24x24 CSS px.
- [x] New-tab target >= 24x24.
- [x] All right-side actions >= 24x24.
- [x] Focus ring passes light/dark.
- [x] Forced-colors retains selected/focused state.
- [x] Active state is not color-only.
- [x] Reduced-motion disables reorder/scroll animations.

### 7.4 Screen-reader audit — P1

Test:

- [ ] VoiceOver + Safari.
- [ ] VoiceOver + Chrome.
- [ ] NVDA + Chrome/Firefox where available.
- [ ] Tab names.
- [ ] Selected state.
- [ ] Close controls.
- [ ] “Visible in another split” description.
- [ ] Focus movement after close.
- [ ] Undo announcement.

---

## Phase 8 — Open-resource integration

### 8.1 Sidebar chats and documents — P0

- [x] Route all selections through `openResource`.
- [x] Focus existing canonical tab.
- [x] Reuse untouched blank tab.
- [x] Open new tab otherwise.
- [x] Keep sidebar active highlight aligned to focused pane.
- [x] Close mobile sidebar after selection.

### 8.2 New chat and new document — P0

- [x] New chat uses new-tab semantics.
- [x] New document creates the document once and opens its tab.
- [x] Existing disabled-feature toasts remain.
- [x] Creation failures do not leave ghost tabs.

### 8.3 Command palette — P0

- [x] Add commands:
  - [x] New tab.
  - [x] Close tab.
  - [x] Reopen closed tab.
  - [x] Next tab.
  - [x] Previous tab.
  - [x] New split.
  - [x] Close split.
- [x] Add an “Open tabs” search source.
- [x] Selecting a listed tab focuses its existing split or opens it in active pane.
- [x] Reuse existing palette host context rather than a second global command system.

### 8.4 Notifications — P0

- [ ] Thread notification focuses/open its canonical chat tab.
- [ ] Document notification focuses/opens its canonical document tab.
- [ ] Existing tab in another split focuses that split.
- [ ] No duplicate tab by default.

### 8.5 Projects and plugin launchers — P0

- [x] Project tree resource selections use `openResource`.
- [x] Custom pane apps create tabs with app metadata.
- [x] Existing plugin-created panes reconcile.
- [x] Test at least one example pane plugin.

### 8.6 Direct routes — P0

- [x] `/chat`.
- [x] `/chat/:id`.
- [x] `/docs`.
- [x] `/docs/:id`.
- [x] Route resource becomes active after restore.
- [x] Missing/deleted route behavior remains.
- [x] Tab activation uses replace-state, not push-state.

---

## Phase 9 — Launch polish

### 9.1 Undo and recently closed — P1

- [x] Bounded stack of 10.
- [x] Preserve order index.
- [x] Preserve transient draft/view state while retained.
- [x] Undo toast.
- [x] Reopen command.
- [x] Context-menu action.
- [x] Release retained resources when evicted.

### 9.2 Context menu — P1

Actions:

- [x] Close tab.
- [x] Close other tabs.
- [x] Close tabs to the right.
- [x] Reopen closed tab.
- [x] Open in split.
- [x] Copy resource link where a stable route exists.
- [x] Move left/right for mobile accessibility.
- [x] Disable invalid actions.
- [x] Keyboard-openable menu.

### 9.3 Middle-click close — P1

- [x] Desktop `auxclick` closes.
- [x] Prevent accidental content activation.
- [x] Undo remains available.
- [x] Do not apply on touch.

### 9.4 Desktop drag reorder — P1

- [x] Pointer Events.
- [x] Movement threshold.
- [x] Pointer capture.
- [x] `requestAnimationFrame`.
- [x] Transform-only movement.
- [x] Edge auto-scroll.
- [x] Cancel on Escape.
- [x] Restore on pointer cancellation.
- [x] Commit once on drop.
- [x] No content remount.
- [x] Keyboard alternative.

### 9.5 Open-tabs overflow control — P1

- [ ] Show when strip overflows or tab count is high.
- [ ] Open command palette filtered to open tabs.
- [ ] Search title/type.
- [ ] Indicate active and visible-in-split states.
- [ ] Permit closing from list only if interaction remains simple.

---

## Phase 10 — Theme and extension surface

### 10.1 Add semantic theme tokens — P0

- [x] Workspace chrome background.
- [x] Tab backgrounds.
- [x] Active border.
- [x] Hover state.
- [x] Text states.
- [x] Attention/error.
- [x] Close/new controls.
- [x] Dark-theme fallbacks.
- [x] Blank-theme coverage.

### 10.2 Add theme override identifiers — P0

- [x] `shell.workspace-chrome`
- [x] `shell.tab`
- [x] `shell.tab-active`
- [x] `shell.tab-close`
- [x] `shell.tab-new`
- [x] `shell.tab-overflow`
- [x] `shell.split-new`
- [x] `shell.split-close`

### 10.3 Extend header-action context — P1

Add optional values without breaking existing handlers:

- [x] Active tab.
- [x] Active pane.
- [x] Tab count.
- [x] Pane count.
- [x] Visible-tab IDs.

### 10.4 Avoid premature public tab hooks — P0

- [x] Keep tab lifecycle internal for v1.
- [x] Document that existing pane hooks still fire.
- [x] Collect actual plugin use cases before stabilizing `ui.tab.*` hooks.

---

## Phase 11 — Tests and quality gates

### 11.1 Component and composable tests — P0

- [x] Tab bar rendering.
- [x] Tab host adapter.
- [x] Metadata resolver.
- [x] Persistence.
- [x] Draft store.
- [x] Route reconciliation.
- [x] Plugin reconciliation.
- [x] Activation generations.
- [x] Accessibility interaction.

### 11.2 E2E desktop suite — P0

Create a dedicated spec such as:

```txt
tests/e2e/workspace-tabs.spec.ts
```

Cover:

- [ ] Open/switch/close.
- [ ] Session restore.
- [ ] Split behavior.
- [ ] Document flush.
- [ ] Chat draft preservation.
- [ ] Rapid switching.
- [ ] 30-tab overflow.
- [ ] Keyboard operation.
- [ ] Theme toggle.
- [ ] Plugin pane app.
- [ ] Background generation behavior where test infrastructure permits.

### 11.3 E2E mobile suite — P0

- [ ] Compact dimensions.
- [ ] Natural strip scroll.
- [ ] No horizontal viewport overflow.
- [ ] New-tab accessibility.
- [ ] Close/Undo.
- [ ] Orientation.
- [ ] Input and bottom-nav clearance.

### 11.4 Visual regression — P1

Capture:

- [ ] Desktop light.
- [ ] Desktop dark.
- [ ] Desktop overflow.
- [ ] Desktop two/three splits.
- [ ] Mobile light.
- [ ] Mobile dark.
- [ ] Long titles.
- [ ] Streaming/saving/attention states.
- [ ] Focus-visible state.

### 11.5 Performance instrumentation — P0

- [x] Add development `performance.mark`/`measure`.
- [x] Measure open, activate, bind, close, restore, reorder.
- [ ] Attach measurements to performance test output.
- [ ] Verify no long task from tab activation.
- [ ] Verify no tab-caused CLS.
- [ ] Verify hidden tabs do not create chat/editor DOM trees.
- [ ] Verify 20-tab restore remains within current OR3 budgets.

### 11.6 Memory and cleanup — P0

- [ ] Draft eviction releases attachment object URLs.
- [ ] Closed-tab eviction releases runtime state.
- [ ] Event listeners dispose on HMR/unmount.
- [ ] Pointer capture always releases.
- [ ] Resize observers dispose.
- [ ] Metadata watchers do not multiply after theme/route changes.
- [ ] Global API reference still cleans up.

---

## Phase 12 — Documentation and rollout

### 12.1 Developer documentation — P0

Document:

- [x] Tab vs pane concepts.
- [x] `openResource`.
- [x] New tab host responsibilities.
- [x] Persistence schema.
- [x] Custom pane-app behavior.
- [x] Header-action overflow.
- [x] Theme identifiers.
- [x] Compatibility/reconciliation behavior.
- [x] Non-goals.

### 12.2 User-facing notes — P1

Document:

- [x] New tab.
- [x] New split.
- [x] Close tab vs close split.
- [x] Reopen closed.
- [x] Keyboard controls.
- [x] Mobile tab scrolling.

### 12.3 Staged enablement — P0

- [x] Enable in local/dev first.
- [ ] Run all suites.
- [ ] Enable for preview deployment.
- [ ] Collect activation timing and error telemetry where permitted.
- [ ] Fix P0 regressions.
- [ ] Make enabled by default.
- [ ] Keep legacy path for one stable release.
- [ ] Remove feature flag and dead legacy chrome.

---

## Deferred P2 backlog

Do not pull these into the first launch unless the core implementation is already stable:

- [ ] Pinned tabs.
- [ ] Tab groups.
- [ ] Vertical tabs.
- [ ] Multi-select tabs.
- [ ] Cloud-synced tab sessions.
- [ ] Multiple named local sessions.
- [ ] Full restart persistence for composer drafts/attachments.
- [ ] Duplicate-resource UI.
- [ ] Drag tab directly onto a split.
- [ ] Detach into a real browser window.
- [ ] Mobile long-press drag reorder.
- [ ] Theme replacement of the complete tab-bar component.
- [ ] Public `ui.tab.*` plugin hook family.
- [ ] AI semantic tab grouping/focus mode.

---

## Recommended delivery estimate

For one engineer familiar with the repository:

| Workstream | Focused engineering time |
|---|---:|
| Core state, persistence, host adapter | 2–3 days |
| Chat/document state preservation | 2–3 days |
| Desktop and mobile chrome | 2–3 days |
| Accessibility and integrations | 1.5–2.5 days |
| Polish, E2E, performance hardening | 2–3 days |
| **Total** | **9.5–14.5 focused days** |

This is an engineering estimate, not a deadline. The state-preservation and race-condition work is more important than making the first visual tab bar quickly.
