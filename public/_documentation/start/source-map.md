# Source contributor map

Use this map when changing OR3 itself. Individual function signatures and return types live beside the implementation in TypeScript and JSDoc. Start with the feature guide, then inspect the listed modules and existing callers.

Portable plugin authors should use [the SDK](/documentation/plugins/plugin-sdk) and [feature recipes](/documentation/plugins/add-features). Private host imports are source integration details.

## Find the right owner

| Task | Source entry points | Feature guide |
| --- | --- | --- |
| Chat admission, streaming, retry, and cancellation | `app/composables/chat/useAi.ts` exports useChat; `app/utils/chat/useAi-internal/` contains request and persistence helpers. | [Chat lifecycle](/documentation/architecture/chat-lifecycle) |
| Model selection, capabilities, and credentials | `app/composables/chat/useChatModelSelection.ts`, `app/core/auth/`, `app/utils/modelCatalog.ts` | [OpenRouter](/documentation/auth/overview) |
| Document loading, staged edits, and autosave | `app/composables/documents/useDocumentsStore.ts`, `useDocumentEditorSessions.ts`, `app/db/documents.ts` | [Documents](/documentation/database/documents) |
| Document AI proposals and chat/editor tools | `app/composables/documents/useDocumentAiAgent.ts`, `app/utils/documents/document-chat-tools.ts` | [Document tools](/documentation/utils/chat-tools) |
| Tab session, pane bindings, and drafts | `app/composables/core/useWorkspaceTabs.ts`, `useWorkspaceTabHost.ts`, `useWorkspaceTabDrafts.ts`, `useMultiPane.ts` | [Chat lifecycle](/documentation/architecture/chat-lifecycle#tabs-and-drafts) |
| Workspace switching and session identity | `app/composables/workspace/`, `app/composables/auth/useSessionContext.ts` | [Cloud accounts](/documentation/cloud/auth-system) and [database safety](/documentation/database/safe-changes) |
| Backups and restore | `app/composables/core/useWorkspaceBackup.ts`, `app/utils/workspace-backup-stream.ts` | [Back up and restore](/documentation/database/backup) |
| Notifications | `app/composables/notifications/useNotifications.ts` and its current service callers | [Notifications](/documentation/cloud/notifications) |
| Theme resolution and component overrides | `app/composables/useThemeResolver.ts`, `app/composables/useThemeSelection.ts`, `app/theme/` | [Theme reference](/documentation/themes/api-reference) |
| Search and command-palette sources | `app/core/search/` and the sidebar search callers | [Command palette](/documentation/start/command-palette) |

Some names are exported through barrels or Nuxt auto-imports. Confirm the defining module and current call site rather than assuming that the filename matches the export.

## Extend source UI through its registry

For new source-owned UI, use the existing registry for that surface. Do not create a second global list or mutate another feature's state directly.

| Surface | Defining module under app/composables |
| --- | --- |
| Dashboard tiles and pages | `dashboard/useDashboardPlugins.ts` |
| Pane apps | `core/usePaneApps.ts` |
| Sidebar pages and environment | `sidebar/useSidebarPages.ts`, `registerSidebarPage.ts`, `useSidebarEnvironment.ts` |
| Sidebar sections and footer actions | `sidebar/useSidebarSections.ts` |
| Header and composer actions | `sidebar/useHeaderActions.ts`, `useComposerActions.ts` |
| Message actions | `chat/useMessageActions.ts` |
| Document/thread history actions | `documents/useDocumentHistoryActions.ts`, `threads/useThreadHistoryActions.ts` |
| Project tree actions | `projects/useProjectTreeActions.ts` |
| TipTap nodes, marks, extensions, toolbar, and inspector | `editor/useEditorNodes.ts`, `useEditorExtensionLoader.ts`, `useEditorToolbar.ts`, `useEditorInspectorPanels.ts` |

Definitions carry the context, visibility, ordering, and access fields appropriate to that surface. Sidebar injection helpers must run inside their provided component subtree; a registered sidebar page and a workspace pane do not have identical context.

The [source pane tutorial](/documentation/start/mini-app-tutorial) demonstrates owned registration and cleanup. For a small source toolbar action, create `app/plugins/example-header.client.ts`:

```ts
import { defineNuxtPlugin } from '#app';
import { registerHeaderAction } from '~/composables/sidebar/useHeaderActions';

export default defineNuxtPlugin(() => {
  const handle = registerHeaderAction({
    id: 'example:documentation',
    icon: 'pixelarticons:book-open',
    tooltip: 'Open documentation',
    order: 250,
    handler: () => { window.open('/documentation', '_blank', 'noopener'); },
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => { handle.dispose(); });
  }
});
```

Verify that the action appears once, opens documentation, and does not duplicate after HMR. Retain the returned owner-scoped handle: removing by ID later can remove a newer replacement registration. A component-owned registration also needs unmount cleanup. Access/visibility rules control UI availability; server authorization still belongs to the server's capability checks.

## Lifecycle and runtime boundaries

Create setup-dependent controllers during component setup, then invoke their methods from user actions. Hook listeners need owned disposal; see [hook lifecycle](/documentation/hooks/reference#lifecycle). Do not treat a singleton ref as request-scoped server state.

Use client boundaries for browser storage and window APIs. Keep auth/database SDKs under server boundaries, and preserve the explicitly static build path. Resolve the active browser database when an operation starts; longer work needs a captured workspace and guard.

Reuse existing caches, debounce rules, and lazy imports. Search callers preserve substring fallback if indexing fails. Preview/blob URL owners must release their retained resources. These rules belong in the feature's implementation and callers, rather than a second handwritten API catalog.

See [development setup](/documentation/start/development-setup) for commands and test lanes, and [TypeScript contracts](/documentation/types/overview) for selecting types.
