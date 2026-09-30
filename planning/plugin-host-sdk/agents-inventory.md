# External Agents migration inventory

This is the characterization map for moving Agents behind the host SDK. The
current implementation is still a bundled first-party feature; this inventory
keeps parity work explicit before extraction.

| Concern | Current owner and private dependency | SDK capability needed | Existing parity tests |
| --- | --- | --- | --- |
| Entry and launcher | `app/plugins/external-agents.client.ts`, `ExternalAgentLauncher.vue`, `ExternalAgentsSidebarPage.vue`; uses `useSidebarPages`, `usePaneApps`, `getGlobalMultiPaneApi` | `ui.registerSidebar`, `ui.registerAction`, `panes.open`, `commands.register` | `app/components/external-agents/__tests__/ExternalAgents.test.ts`, `app/core/external-agents/__tests__/launcher.test.ts` |
| Session UI | `ExternalAgentSessionPane.vue`, `ExternalAgentComposer.vue`; imports presentation, refs and runtime modules | pane registration/navigation, host transcript/composer DTOs, chat/file references | `ExternalAgents.test.ts` session, draft and action cases |
| Controller and recovery | `app/core/external-agents/controller.ts`, `runtime.ts`, `recovery.ts`, `event-store.ts`, `snapshot-publisher.ts` | generation-bound lifecycle, `network.stream`, `activity.register`, `events` | `controller.test.ts`, `runtime.test.ts`, `recovery.test.ts`, `services.test.ts` |
| Driver/protocol | `driver-detection.ts`, `runs-client.ts`, `app/plugins/external-agents.client.ts` `adaptInternClient`; uses `@or3/intern-client` transport and SSE/runs endpoints | `http.fetch`, `network.stream`, approved destinations and cancellation | `driver-detection.test.ts`, `runs-client.test.ts`, `server/api/connect/__tests__/device-status.test.ts` |
| Credentials | `credentials.ts` and connection setup/removal in `ExternalAgentsSidebarPage.vue`; current vault and Connect APIs | `secrets.get/set/delete/ref/status/unlock`, managed connection projection | `credentials.test.ts`, ExternalAgents Connect removal/configuration cases |
| Attachments | `adaptInternClient.stageFiles/releaseStagedFiles` stages `.or3-upload-*` through private file routes | `files.pick/read/write`, bounded staged transfer and lifecycle references | ExternalAgents attachment, failure rollback and cleanup cases |
| Persistence/workspace | `persistence.ts`, `persistence-adapter.ts`, `session-repository.ts`; directly selects `getActiveWorkspaceId`, `getWorkspaceDb` and KV | `workspace.id/onChange`, scoped storage with revisions | `persistence.test.ts`, `session-repository` coverage, workspace switch tests |
| Activity/commands | `activity-adapter.ts`, `commands.ts`, `connect-command.ts`; directly accesses activity registry and command palette | `activity.registerSource`, typed command registration and host approval routing | `activity-commands.test.ts`, `connect-command.test.ts` |
| Navigation and cloud hosts | `ExternalAgentSessionPane.vue`, sidebar management actions, `/api/connect/environments*` | `workspace.connections.list/manage`, `panes.open` | ExternalAgents Cloud host discovery/removal cases and connection API tests |

The extraction boundary is therefore: keep pure types, controller state
machines, presentation and protocol parsing in the package; inject all
workspace/database, credential, attachment, navigation, activity and transport
operations through the typed SDK clients. No migration step may import
`~/db/client`, Vue composables, Pinia stores, Nuxt APIs, private activity
registries or internal Connect routes.
