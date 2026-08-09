# Workspace tabs

Workspace tabs add a local session layer above the existing split-pane host.

- A **tab** is an open chat, document, blank chat, or pane app.
- A **pane** (or **split**) is a mounted visible viewport managed by `useMultiPane`.
- A tab can be hidden without mounting its chat or document tree. Every visible pane is bound to one tab.

## Opening resources

Use the `useWorkspaceTabs()` command surface rather than mutating a pane when the feature is enabled:

```ts
await workspaceTabs.openResource(
  { kind: 'document', documentId },
  { target: 'active' } // `background` and `split` are also available
)
```

The command deduplicates chats, documents, and app records by default, reuses an untouched blank chat, and focuses an already-visible tab in its existing split. Pass `allowDuplicate: true` only when an explicit duplicate view is intended. Legacy plugin pane mutations remain supported: `PageShell` reconciles them into the local tab session.

Sidebar and plugin surfaces can use `useWorkspaceResourceActions(resource)` for the same explicit duplicate views. It accepts any `WorkspaceResource` (chat, document, or pane app) and exposes `openInNewTab()` and `openInNewPane()`. The latter reports unavailable when the workspace profile’s pane limit has been reached; callers should hide that action on mobile.

`useWorkspaceTabHost()` is deliberately narrow. It translates stable pane IDs to the existing index-based `useMultiPane` methods, binds the resource, and leaves chat loading and document storage in their current owners.

## State and persistence

The persisted manifest is `WorkspaceTabsSnapshotV1` in local storage, scoped by workspace/deployment and workspace profile. It contains ordered resource descriptors, cached titles, active tab, visible tab order, and active visible index. It never contains runtime pane UUIDs, messages, document bodies, editor internals, or attachment blobs.

Runtime state is tab-keyed and in memory only. Composer drafts and object URLs survive tab switches and the short Undo-close window, but do not survive a full restart. Chat scroll state uses keyed message anchors from `or3-scroll`; document view state is restored only after the editor session registers.

## Custom apps, extensions, and actions

Custom pane apps become `{ kind: 'app' }` resources. Record-less app instances receive a local instance key. Existing pane hooks and the global pane API remain intact; no `ui.tab.*` plugin hook is public in v1.

When tabs are enabled, labelled plugin header actions live under the chrome’s **More actions** menu so they cannot compress or overlap the tab strip. Header-action handlers receive the existing route/mobile context plus `activeTab`, `activePane`, `tabCount`, `paneCount`, and `visibleTabIds`.

Theme overrides use the `shell` context. Workspace identifiers are `shell.workspace-chrome`, `shell.tab`, `shell.tab-active`, `shell.tab-close`, `shell.tab-new`, `shell.tab-overflow`, `shell.tab-switcher`, `shell.tab-switcher-new`, `shell.tab-switcher-done`, `shell.split-new`, and `shell.split-close`. Tab chrome (desktop strip + mobile) exposes `--or3-workspace-chrome-bg`, `--or3-tab-bg`, `--or3-tab-bg-hover`, `--or3-tab-bg-active`, `--or3-tab-border`, `--or3-tab-border-active`, `--or3-tab-radius`, `--or3-tab-shadow`, and `--or3-tab-shadow-active`, and falls back to `--md-border-width` / `--md-border-radius` / `--md-surface*`. Icon tokens include `shell.tab.new`, `shell.tabs`, and `shell.tabs.search`.

## User behavior

- **New tab** (click) opens an ephemeral blank chat in the active pane. **Right-click** the `+` control for New chat, New document (when enabled), New workflow (when the editor is enabled), and New agent session (when an external agent host is connected with a ready runner).
- **New split** adds a viewport and a blank tab; **Close split** hides its tab but keeps it open.
- **Close tab** removes the tab and offers Undo. The recently-closed stack is capped at ten tabs.
- Keyboard controls on the desktop strip: Left/Right, Home/End, Delete, and the keyboard context-menu key (or Shift+F10).
- Mobile keeps a single visible pane and a safe-area-aware one-row chrome: active title, new-tab, and a tab-count control that opens the fullscreen tab switcher (search, sort, switch, close, reopen closed). Edge-swipe adjacent switching is deferred.

## Rollout

`features.workspaceTabs.enabled` controls the workspace chrome and orchestration while retaining the legacy chrome path. The legacy path should remain for one stable release after default enablement, then be removed with its flag and dead markup. Do not fork chat or document business logic between these paths.

First-release non-goals include cloud-synced tab sessions, groups, pinned/vertical tabs, public tab lifecycle hooks, full-restart attachment persistence, and mobile drag reordering.
