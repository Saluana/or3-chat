# useWorkspaceResourceActions

Reusable navigation actions for an existing workspace resource. It supports chats, documents, and registered pane apps, so a sidebar surface can offer the same behavior without duplicating pane or tab routing.

## Usage

```ts
const resource = computed(() => ({
    kind: 'app' as const,
    appId: 'my-plugin',
    recordId,
}));

const {
    canOpenInNewTab,
    canOpenInNewPane,
    openInNewTab,
    openInNewPane,
} = useWorkspaceResourceActions(resource);
```

- `openInNewTab()` creates and activates a duplicate workspace tab.
- `openInNewPane()` creates and activates a duplicate resource in a split pane.
- `canOpenInNewPane` is false when the configured pane limit is reached (and on mobile single-pane workspaces).

Render the new-pane action only on desktop. The composable does not enforce presentation, which keeps it suitable for plugin, agent, and workflow surfaces.
