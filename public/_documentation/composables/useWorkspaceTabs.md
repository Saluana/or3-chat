# useWorkspaceTabs

Reactive orchestration for the local workspace tab session. It owns the tab manifest (open tabs, active tab, pane bindings) and every tab operation, while a host adapter owns the mounted panes.

## Purpose

`useWorkspaceTabs(options)` returns:

| Member | Description |
| ------ | ----------- |
| `state` | Shallow-reactive `WorkspaceTabsState` (tabs, runtime statuses, pane bindings). |
| `tabs` | Computed list of tabs. |
| `activeTabId` / `activePaneId` | Computed ids for the focused tab and pane. |
| `visibleTabIds` | Computed set of tab ids currently bound to panes. |
| `statusByTabId` | Computed map of tab id to runtime status. |
| `canCloseSplit` | Whether more than one pane is open. |
| `openResource(resource, opts?)` | Open a chat, document, or app resource in the active pane. |
| `newTab(resource)` | Create a new tab for a resource. |
| `activateTab(tabId, reason?, forceBind?)` | Focus a tab, rebinding its resource when needed. |
| `closeTab(tabId)` | Close a tab. |
| `reopenClosedTab()` | Restore the most recently closed tab. |
| `reorderTab(tabId, index)` | Move a tab in the strip. |
| `promoteBlankChat(tabId, threadId)` | Convert a blank chat tab into a real thread tab. |
| `newSplit()` | Open a new pane split. |
| `closeSplit(paneId?)` | Close a pane split. |
| `openInSplit(tabId, paneId)` | Show a tab in another split. |
| `restore()` | Restore the persisted snapshot for the current workspace/profile. |
| `switchScope()` | Switch to another workspace or profile scope. |
| `reconcilePaneResource(paneId, resource)` | Reconcile an externally changed pane. |
| `paneClosedExternally(paneId)` | Handle a pane closed outside the controller. |
| `updateRuntime(tabId, patch)` / `updateCachedTitle(tabId, title)` | Update tab metadata. |
| `flushPersistence()` | Write the tab snapshot to storage immediately. |

## Options

```ts
useWorkspaceTabs({
    host: workspaceTabHost,             // WorkspaceTabHost adapter
    paneLimit,                          // Ref<number>
    isMobile,                           // Ref<boolean>
    workspaceId: () => workspaceId,     // getters for the current scope
    profileId: () => profileId,
    storage?,                           // optional custom storage
    captureOutgoing?,                   // capture hook before a tab leaves a pane
    restoreIncoming?,                   // restore hook before a tab binds
    filterRestoredTabs?,                // validate restored tabs (removes deleted records)
    onError?,                           // error callback
});
```

## Usage

```ts
const tabs = useWorkspaceTabs({
    host: useWorkspaceTabHost(multiPane),
    paneLimit: computed(() => 3),
    isMobile,
    workspaceId: () => activeWorkspaceId.value,
    profileId: () => profileId.value,
});

await tabs.openResource({ kind: 'chat', threadId: 'thread-1' });
tabs.reorderTab('tab-2', 0);
```

## Notes

-   The tab session persists to `localStorage` per workspace and profile (see `useWorkspaceTabPersistence`).
-   Activation is transactional: a newer activation supersedes older work.
-   Telemetry wraps bind and activate actions for performance monitoring.

## Related

-   `useWorkspaceTabHost` — the pane adapter this composable requires.
-   `useWorkspaceTabPersistence` — storage layer.
-   `useWorkspaceTabDrafts` — in-memory composer drafts per tab.
-   `useWorkspaceTabMetadata` — batch title/icon resolution for tab strips.
