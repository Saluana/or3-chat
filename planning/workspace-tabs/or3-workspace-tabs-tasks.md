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

- [ ] Add typed config and default.
- [ ] Keep the legacy top chrome available while development is incomplete.
- [ ] Add a clear removal milestone: one stable release after default enablement.
- [ ] Do not fork chat/document business logic between flag paths.

**Acceptance**

- [ ] Enabling/disabling the flag changes only workspace chrome/orchestration.
- [ ] Both paths pass the existing smoke tests during development.

### 0.3 Lock vocabulary — P0

- [ ] Use `tab` for an open resource.
- [ ] Use `pane` or `split` for a visible viewport.
- [ ] Change the existing “New window” tooltip to “New split” when tabs are enabled.
- [ ] Label the tab-strip plus button “New tab.”
- [ ] Add terminology to developer documentation.

---

## Phase 1 — Pure tab model

### 1.1 Create workspace-tab types — P0

Add:

```txt
app/core/workspace-tabs/types.ts
```

- [ ] Define `WorkspaceResource`.
- [ ] Define `WorkspaceTab`.
- [ ] Define `WorkspaceTabRuntime`.
- [ ] Define `WorkspaceTabsState`.
- [ ] Define `ClosedTabSnapshot`.
- [ ] Define `WorkspaceTabsSnapshotV1`.
- [ ] Keep messages, document content, and large editor state out of these types.
- [ ] Document which fields are persistent and transient.

### 1.2 Add canonical resource keys — P0

Add:

```txt
app/core/workspace-tabs/resource-key.ts
```

- [ ] Implement keys for chat, document, app record, app instance, and blank chat.
- [ ] Add `allowDuplicate` support through instance keys.
- [ ] Make a blank-chat key stable by tab ID.
- [ ] Add tests for malformed IDs and missing app record IDs.

**Acceptance**

- [ ] Sidebar opening the same chat twice focuses one tab by default.
- [ ] Explicit duplicate requests remain possible.
- [ ] Blank chat promotion does not change the tab ID.

### 1.3 Implement pure transitions — P0

Add:

```txt
app/composables/core/workspace-tab-transitions.ts
```

Implement pure, deterministic operations:

- [ ] `createInitialState()`
- [ ] `openTab()`
- [ ] `activateTab()`
- [ ] `bindTabToPane()`
- [ ] `unbindPane()`
- [ ] `closeTab()`
- [ ] `closeSplit()`
- [ ] `reorderTab()`
- [ ] `promoteBlankChat()`
- [ ] `markResourceDeleted()`
- [ ] `restoreSnapshot()`
- [ ] `reconcilePaneResource()`

Enforce invariants after every development/test transition:

- [ ] Unique tab IDs.
- [ ] Valid active tab.
- [ ] Valid pane bindings.
- [ ] One pane per tab.
- [ ] One tab per pane.
- [ ] Workspace never empty.
- [ ] Active tab matches active pane binding.

**Acceptance**

- [ ] Transition tests do not require Vue or IndexedDB.
- [ ] Invalid input produces a safe fallback rather than a half-valid state.

### 1.4 Unit-test the state machine — P0

Create focused tests for:

- [ ] Initial blank tab.
- [ ] Untouched blank reuse.
- [ ] Open new resource after active tab.
- [ ] Dedupe existing resource.
- [ ] Explicit duplicate.
- [ ] Activate hidden tab.
- [ ] Activate tab visible in another pane.
- [ ] Close hidden tab.
- [ ] Close visible tab and use hidden replacement.
- [ ] Close visible tab and collapse extra pane.
- [ ] Close last tab and create blank fallback.
- [ ] Close split while preserving tab.
- [ ] Reorder tabs.
- [ ] Promote blank chat.
- [ ] Delete active resource.
- [ ] Delete hidden resource.
- [ ] Restore invalid snapshot.
- [ ] Restore with a lower pane limit.
- [ ] Mobile restore with one visible pane.

---

## Phase 2 — Persistence and metadata

### 2.1 Add a versioned snapshot schema — P0

Add:

```txt
app/core/workspace-tabs/snapshot-schema.ts
```

- [ ] Validate with the project’s existing schema approach.
- [ ] Set `schemaVersion: 1`.
- [ ] Clamp string lengths and array sizes.
- [ ] Reject duplicate tab IDs.
- [ ] Reject pane bindings to missing tabs.
- [ ] Ignore unknown fields.
- [ ] Safely ignore unsupported future versions.
- [ ] Add migration entry point even though v1 has no migration yet.

### 2.2 Add local persistence — P0

Add:

```txt
app/composables/core/useWorkspaceTabPersistence.ts
```

- [ ] Scope the key by workspace/local deployment and profile ID.
- [ ] Persist:
  - [ ] Ordered tab descriptors.
  - [ ] Cached titles.
  - [ ] Active tab.
  - [ ] Visible tab IDs in pane order.
  - [ ] Active visible index.
- [ ] Do not persist runtime pane UUIDs.
- [ ] Debounce writes.
- [ ] Flush on `pagehide`.
- [ ] Restore before opening non-route background tabs.
- [ ] Make the direct route override stored active state.
- [ ] Drop deleted/inaccessible resources.
- [ ] Keep pane widths in the existing storage path.

**Acceptance**

- [ ] Reload restores 20 tabs without mounting 20 content trees.
- [ ] Corrupt storage opens a safe blank chat.
- [ ] Switching workspaces never leaks another workspace’s tabs.

### 2.3 Add centralized title metadata — P0

Add:

```txt
app/composables/core/useWorkspaceTabMetadata.ts
```

- [ ] Batch-load thread titles.
- [ ] Batch-load document titles.
- [ ] Use custom pane-app label/icon.
- [ ] Use cached title for immediate paint.
- [ ] Listen to existing DB update/delete hooks or a small number of live queries.
- [ ] Update title after chat title generation.
- [ ] Avoid one live query per tab.
- [ ] Provide full title separately from truncated display title.
- [ ] Add fallback titles.

### 2.4 Add runtime status metadata — P1

- [ ] Track chat loading/streaming.
- [ ] Track hidden completion/attention.
- [ ] Track document saving.
- [ ] Track document save errors.
- [ ] Clear attention on activation.
- [ ] Include status in accessible label.
- [ ] Ensure status updates do not rebuild all pane components.

---

## Phase 3 — Tab host and pane integration

### 3.1 Create `useWorkspaceTabs` orchestration — P0

Add:

```txt
app/composables/core/useWorkspaceTabs.ts
```

Responsibilities:

- [ ] Own reactive tab state.
- [ ] Call pure transitions.
- [ ] Coordinate persistence.
- [ ] Expose:
  - [ ] `openResource`
  - [ ] `newTab`
  - [ ] `activateTab`
  - [ ] `closeTab`
  - [ ] `reopenClosedTab`
  - [ ] `reorderTab`
  - [ ] `newSplit`
  - [ ] `closeSplit`
  - [ ] `openInSplit`
- [ ] Do not load messages or flush documents directly.
- [ ] Delegate pane work to the host adapter.

### 3.2 Create the tab host adapter — P0

Add:

```txt
app/composables/core/useWorkspaceTabHost.ts
```

- [ ] Map runtime pane IDs to indexes safely.
- [ ] Focus an existing pane.
- [ ] Add a pane through `useMultiPane`.
- [ ] Close a pane through `useMultiPane`.
- [ ] Bind chat resource.
- [ ] Bind document resource.
- [ ] Bind custom pane app.
- [ ] Capture outgoing view state.
- [ ] Update the URL after successful/optimistic binding.
- [ ] Return structured errors for toast/reporting.

### 3.3 Add per-pane activation generations — P0

- [ ] Maintain a generation counter by pane ID.
- [ ] Increment before each activation.
- [ ] Check after every awaited operation.
- [ ] Ignore late chat load, document flush, and app initialization.
- [ ] Add rapid-switch tests with deliberately delayed promises.

**Acceptance**

- [ ] Clicking A -> B -> C quickly always leaves C visible.
- [ ] A late document flush cannot rebind A over C.
- [ ] A late app record creation cannot consume the wrong pane.

### 3.4 Make pane APIs ID-safe — P0

The existing public API can remain index-based, but tab orchestration should use stable IDs.

- [ ] Add internal helpers to find pane index by pane ID.
- [ ] Add `activePaneId` computed value or equivalent.
- [ ] Avoid storing pane indexes in persisted tab state.
- [ ] Test index shifts after closing a pane to the left of the active pane.

### 3.5 Integrate workspace-profile initial panes — P0

- [ ] Convert initial pane descriptors into tabs.
- [ ] Bind as many as the desktop pane limit allows.
- [ ] On mobile, create all tabs but bind one.
- [ ] Preserve route-initialized resource priority.
- [ ] Lowering the pane limit closes splits but not tabs.
- [ ] Raising the limit does not create surprise splits.

### 3.6 Reconcile direct plugin pane mutations — P0

- [ ] Watch pane resource identity.
- [ ] Detect changes that did not originate from the tab layer.
- [ ] Find/create the matching tab.
- [ ] Bind it to that pane.
- [ ] Allow duplicate instance when a plugin explicitly places the same resource in two panes.
- [ ] Preserve existing pane hooks.
- [ ] Add development diagnostics.
- [ ] Add custom pane-app compatibility tests.

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

- [ ] Add `tabId` or `viewStateKey` prop.
- [ ] Keep existing `paneId` for pane/plugin APIs.
- [ ] Do not substitute tab ID for pane ID in existing bridges.
- [ ] Document the distinction.

### 4.2 Add tab-keyed chat drafts — P0

Add:

```txt
app/composables/core/useWorkspaceTabDrafts.ts
```

Capture:

- [ ] Plain composer text.
- [ ] TipTap JSON.
- [ ] Pending prompt ID.
- [ ] Safe attachment state that can remain in memory.
- [ ] Relevant composer settings that are currently pane-local.

Integrate:

- [ ] Restore on tab activation.
- [ ] Capture on deactivation.
- [ ] Capture on component unmount.
- [ ] Debounce live changes.
- [ ] Clear only after durable send acceptance.
- [ ] Transfer state when blank tab becomes a real thread.
- [ ] Preserve state through Undo close.
- [ ] Release blob URLs when the draft is permanently discarded.

**Acceptance**

- [ ] Type in tab A, switch to B, return to A, and text remains.
- [ ] Draft from A never appears in B.
- [ ] Sending in A clears only A.
- [ ] Closing and undoing A restores its draft.
- [ ] Closing without undo eventually releases attachment resources.

### 4.3 Add chat scroll capture/restore — P0

- [ ] Add a public capture API to `ChatContainer`/`Or3Scroll`.
- [ ] Store bottom-pinned state.
- [ ] Store anchor message ID and offset.
- [ ] Store fallback absolute offset.
- [ ] Restore after content-key/thread switch.
- [ ] Handle prepended history.
- [ ] Handle streaming message growth.
- [ ] Do not force bottom when the user had scrolled up.

### 4.4 Harden document switching — P0

- [ ] Capture active editor before unbinding.
- [ ] Flush local document state.
- [ ] Do not block visual activation longer than necessary.
- [ ] On close-tab flush failure:
  - [ ] Keep the tab open.
  - [ ] Mark error.
  - [ ] Show actionable toast.
- [ ] On ordinary switch flush failure:
  - [ ] Preserve captured local state.
  - [ ] Mark error.
  - [ ] Avoid data loss.
- [ ] Test slow and rejected flushes.

### 4.5 Add document view-state adapter — P1

- [ ] Capture scroll position.
- [ ] Capture selection/caret when technically stable.
- [ ] Restore only after editor readiness.
- [ ] Do not persist editor internals in the tab manifest.
- [ ] Add regression tests for switching two documents repeatedly.

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

- [ ] Keep `PageShell` responsible for orchestration only.
- [ ] Move sidebar-toggle rendering into the chrome component.
- [ ] Move theme, notifications, split, and header actions.
- [ ] Keep handlers passed as explicit props/events.
- [ ] Add stable test IDs.
- [ ] Do not move business data into the component.

### 5.2 Replace hard-coded top offsets — P0

- [ ] Introduce `--or3-workspace-chrome-height`.
- [ ] Align with the measured sidebar header height where practical.
- [ ] Replace `46px` padding/clearance duplication.
- [ ] Keep a safe fallback token.
- [ ] Test expanded and collapsed sidebar.
- [ ] Test sidebar resizing during tab overflow.
- [ ] Verify no first-paint layout jump.

### 5.3 Build the desktop tab strip — P0

Add:

```txt
WorkspaceTabBar.vue
WorkspaceTab.vue
```

- [ ] One row only.
- [ ] Visual tab height <= 32px.
- [ ] `min-width: 96px`.
- [ ] Preferred width around 168px.
- [ ] Maximum width around 220px.
- [ ] Ellipsis long titles.
- [ ] Full-title tooltip.
- [ ] Type icon.
- [ ] Status indicator.
- [ ] Reserved close-button geometry.
- [ ] Active style.
- [ ] Secondary visible-in-split style.
- [ ] Hover style.
- [ ] Focus-visible style.
- [ ] New-tab button at end.
- [ ] Horizontal overflow.
- [ ] Leading/trailing fades.
- [ ] Active auto-reveal.
- [ ] Reduced-motion support.

### 5.4 Build the right-side action cluster — P0

Order:

- [ ] New split.
- [ ] Close active split when applicable or place it in split menu.
- [ ] Theme toggle.
- [ ] Notifications.
- [ ] Compact plugin actions.
- [ ] More overflow.

Rules:

- [ ] Fixed right side.
- [ ] Never overlaps tabs.
- [ ] Never shrinks below target size.
- [ ] Disabled split state keeps existing tooltip.
- [ ] Mobile hides split controls.
- [ ] Labelled plugin actions default to overflow.
- [ ] Existing header-action handler/error behavior remains.

### 5.5 Remove pane close overlay — P1

- [ ] Move active split closure to the right action cluster/menu.
- [ ] Remove the current top-right pane overlay.
- [ ] Keep a clear visible indication of the focused split.
- [ ] Ensure users can close a split by keyboard and screen reader.

---

## Phase 6 — Mobile chrome

### 6.1 Implement compact two-row layout — P0

- [ ] Top app row around 48px.
- [ ] Tab row no more than 40px.
- [ ] Visual tabs remain 32px.
- [ ] Menu and brand on left.
- [ ] Core actions on right.
- [ ] Tabs horizontally scroll.
- [ ] New-tab button remains reachable.
- [ ] Split controls hidden.
- [ ] Respect safe-area top inset.
- [ ] Avoid extra whitespace between rows.

### 6.2 Touch behavior — P0

- [ ] Set appropriate `touch-action`.
- [ ] Ordinary horizontal swipe scrolls.
- [ ] Vertical page/content gestures remain unaffected.
- [ ] Close button does not accidentally activate the tab.
- [ ] Tap activation is immediate.
- [ ] No 300ms-style delayed interaction.
- [ ] Do not implement direct mobile drag reorder yet.

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

- [ ] `role="tablist"`.
- [ ] `role="tab"`.
- [ ] `aria-selected`.
- [ ] `aria-controls`.
- [ ] Roving tabindex.
- [ ] Focused content `role="tabpanel"`.
- [ ] Labelled secondary split regions.
- [ ] Accessible close labels.
- [ ] Status in accessible names/descriptions.

### 7.2 Keyboard behavior — P0

- [ ] Left/Right.
- [ ] Home/End.
- [ ] Enter/Space when required.
- [ ] Delete closes when focus is on tab.
- [ ] Context-menu equivalent for close.
- [ ] Focus adjacent tab after close.
- [ ] Escape closes menus, not tabs.
- [ ] Do not intercept arrow keys outside the tab strip.
- [ ] Do not globally steal browser `Ctrl/Cmd+W` or `Ctrl+Tab` in v1.
- [ ] Add tab commands to the command palette.

### 7.3 Target sizes and high contrast — P0

- [ ] Close target >= 24x24 CSS px.
- [ ] New-tab target >= 24x24.
- [ ] All right-side actions >= 24x24.
- [ ] Focus ring passes light/dark.
- [ ] Forced-colors retains selected/focused state.
- [ ] Active state is not color-only.
- [ ] Reduced-motion disables reorder/scroll animations.

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

- [ ] Route all selections through `openResource`.
- [ ] Focus existing canonical tab.
- [ ] Reuse untouched blank tab.
- [ ] Open new tab otherwise.
- [ ] Keep sidebar active highlight aligned to focused pane.
- [ ] Close mobile sidebar after selection.

### 8.2 New chat and new document — P0

- [ ] New chat uses new-tab semantics.
- [ ] New document creates the document once and opens its tab.
- [ ] Existing disabled-feature toasts remain.
- [ ] Creation failures do not leave ghost tabs.

### 8.3 Command palette — P0

- [ ] Add commands:
  - [ ] New tab.
  - [ ] Close tab.
  - [ ] Reopen closed tab.
  - [ ] Next tab.
  - [ ] Previous tab.
  - [ ] New split.
  - [ ] Close split.
- [ ] Add an “Open tabs” search source.
- [ ] Selecting a listed tab focuses its existing split or opens it in active pane.
- [ ] Reuse existing palette host context rather than a second global command system.

### 8.4 Notifications — P0

- [ ] Thread notification focuses/open its canonical chat tab.
- [ ] Document notification focuses/opens its canonical document tab.
- [ ] Existing tab in another split focuses that split.
- [ ] No duplicate tab by default.

### 8.5 Projects and plugin launchers — P0

- [ ] Project tree resource selections use `openResource`.
- [ ] Custom pane apps create tabs with app metadata.
- [ ] Existing plugin-created panes reconcile.
- [ ] Test at least one example pane plugin.

### 8.6 Direct routes — P0

- [ ] `/chat`.
- [ ] `/chat/:id`.
- [ ] `/docs`.
- [ ] `/docs/:id`.
- [ ] Route resource becomes active after restore.
- [ ] Missing/deleted route behavior remains.
- [ ] Tab activation uses replace-state, not push-state.

---

## Phase 9 — Launch polish

### 9.1 Undo and recently closed — P1

- [ ] Bounded stack of 10.
- [ ] Preserve order index.
- [ ] Preserve transient draft/view state while retained.
- [ ] Undo toast.
- [ ] Reopen command.
- [ ] Context-menu action.
- [ ] Release retained resources when evicted.

### 9.2 Context menu — P1

Actions:

- [ ] Close tab.
- [ ] Close other tabs.
- [ ] Close tabs to the right.
- [ ] Reopen closed tab.
- [ ] Open in split.
- [ ] Copy resource link where a stable route exists.
- [ ] Move left/right for mobile accessibility.
- [ ] Disable invalid actions.
- [ ] Keyboard-openable menu.

### 9.3 Middle-click close — P1

- [ ] Desktop `auxclick` closes.
- [ ] Prevent accidental content activation.
- [ ] Undo remains available.
- [ ] Do not apply on touch.

### 9.4 Desktop drag reorder — P1

- [ ] Pointer Events.
- [ ] Movement threshold.
- [ ] Pointer capture.
- [ ] `requestAnimationFrame`.
- [ ] Transform-only movement.
- [ ] Edge auto-scroll.
- [ ] Cancel on Escape.
- [ ] Restore on pointer cancellation.
- [ ] Commit once on drop.
- [ ] No content remount.
- [ ] Keyboard alternative.

### 9.5 Open-tabs overflow control — P1

- [ ] Show when strip overflows or tab count is high.
- [ ] Open command palette filtered to open tabs.
- [ ] Search title/type.
- [ ] Indicate active and visible-in-split states.
- [ ] Permit closing from list only if interaction remains simple.

---

## Phase 10 — Theme and extension surface

### 10.1 Add semantic theme tokens — P0

- [ ] Workspace chrome background.
- [ ] Tab backgrounds.
- [ ] Active border.
- [ ] Hover state.
- [ ] Text states.
- [ ] Attention/error.
- [ ] Close/new controls.
- [ ] Dark-theme fallbacks.
- [ ] Blank-theme coverage.

### 10.2 Add theme override identifiers — P0

- [ ] `shell.workspace-chrome`
- [ ] `shell.tab`
- [ ] `shell.tab-active`
- [ ] `shell.tab-close`
- [ ] `shell.tab-new`
- [ ] `shell.tab-overflow`
- [ ] `shell.split-new`
- [ ] `shell.split-close`

### 10.3 Extend header-action context — P1

Add optional values without breaking existing handlers:

- [ ] Active tab.
- [ ] Active pane.
- [ ] Tab count.
- [ ] Pane count.
- [ ] Visible-tab IDs.

### 10.4 Avoid premature public tab hooks — P0

- [ ] Keep tab lifecycle internal for v1.
- [ ] Document that existing pane hooks still fire.
- [ ] Collect actual plugin use cases before stabilizing `ui.tab.*` hooks.

---

## Phase 11 — Tests and quality gates

### 11.1 Component and composable tests — P0

- [ ] Tab bar rendering.
- [ ] Tab host adapter.
- [ ] Metadata resolver.
- [ ] Persistence.
- [ ] Draft store.
- [ ] Route reconciliation.
- [ ] Plugin reconciliation.
- [ ] Activation generations.
- [ ] Accessibility interaction.

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

- [ ] Add development `performance.mark`/`measure`.
- [ ] Measure open, activate, bind, close, restore, reorder.
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

- [ ] Tab vs pane concepts.
- [ ] `openResource`.
- [ ] New tab host responsibilities.
- [ ] Persistence schema.
- [ ] Custom pane-app behavior.
- [ ] Header-action overflow.
- [ ] Theme identifiers.
- [ ] Compatibility/reconciliation behavior.
- [ ] Non-goals.

### 12.2 User-facing notes — P1

Document:

- [ ] New tab.
- [ ] New split.
- [ ] Close tab vs close split.
- [ ] Reopen closed.
- [ ] Keyboard controls.
- [ ] Mobile tab scrolling.

### 12.3 Staged enablement — P0

- [ ] Enable in local/dev first.
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
