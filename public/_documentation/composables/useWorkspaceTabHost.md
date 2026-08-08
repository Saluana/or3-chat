# useWorkspaceTabHost

Adapter that connects the workspace tab session to the multi-pane engine. It is a narrow bridge: it maps pane ids to pane indexes and binds tab resources to panes, but never owns messages or document content.

## Purpose

`useWorkspaceTabHost(multiPane)` returns a `WorkspaceTabHost` with:

-   `paneIds()` — current pane ids in open order.
-   `activePaneId()` — the focused pane id.
-   `focusPane(paneId)` — make a pane active.
-   `addPane()` — append a blank pane.
-   `closePane(paneId)` — close a pane.
-   `bindResourceToPane(paneId, resource, activation)` — bind a chat, document, or app resource to a pane.

Binding behavior per resource kind:

-   `chat` — switches the pane to chat mode and loads the thread.
-   `document` — switches the pane to document mode with the given `documentId`.
-   `app` — calls `setPaneApp` with the app id and optional record id.

Bindings check the activation token and pane index before applying, so stale work is ignored.

## Usage

```ts
import { useWorkspaceTabHost } from '~/composables/core/useWorkspaceTabHost';
import { useWorkspaceTabs } from '~/composables/core/useWorkspaceTabs';

const host = useWorkspaceTabHost(multiPane);

const tabs = useWorkspaceTabs({
    host,
    paneLimit,
    isMobile,
    workspaceId: () => workspaceId.value,
    profileId: () => profileId.value,
});
```

## Notes

-   Built for a single pane container; it does not create host UI.
-   Usually you never call it directly — pass it to `useWorkspaceTabs`.

## Related

-   `useWorkspaceTabs` — the tab session that consumes this host.
-   `useMultiPane` — the underlying pane engine.
