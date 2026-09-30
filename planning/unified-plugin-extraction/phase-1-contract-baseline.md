# Phase 1 contract baseline

Captured on branch `feat/unified-plugin-phase-1`, cut from `or3-cloud` at `2f55206865bf64ca6b2bd1ea2cfc6bba99709b0a`.

## Pre-change check

`bun run plugin-runtime:compatibility:check` failed before any Phase 1 edits:

- `plugin-runtime:ledger:check` reported the ledger stale (7 modules: declaration line drift on pane apps, dashboard, workspace runtime, sidebar pages, hook types, and tools, plus export `getActiveDocumentEditorSession` on `app/composables/index.ts`).
- `plugin-runtime:snapshots:check` then failed on `snapshots/public-api.d.ts` at line 257.

## Post-change check

After wiring `createTrustedHostContext` and refreshing the ledger and snapshots, the same command passes:

- 39 modules, 588 exports, 270 callables, 307 Nuxt auto-imports.
- The new module is `app/composables/plugins/trusted-host-context.ts`.
- Authoring stays one SDK entry: `defineOr3Plugin` plus Manifest V2. Isolation is unchanged.

The refresh includes the pre-existing declaration drift above. It is not a behavior change in those modules.

## Trusted context mapping

| SDK surface | Core registry |
| --- | --- |
| `context.ui.registerSidebar` | `registerSidebarPage` |
| `context.ui.registerPane` | `registerPaneApp` |
| `context.ui.registerCard` | `registerDashboardPlugin` |
| `context.ui.registerAction` (`message` or `chat`) | `registerMessageAction` |
| `context.commands.register` | `registerPaletteCommand` |
| `context.activity.registerSource` | `registerPluginActivitySource` |
| `tools.register` and `chat.tool.client` | `registerTool` |
| `ui.command-palette.post-source` | `registerPluginPostSource` |
| `context.panes.open` / `focus` / `close` | `getGlobalMultiPaneApi` |

`context.chat.create`, `open`, and `appendMessage`, plus toast, confirm, progress, and `commands.run`, stay unsupported. Editor, document-AI, admin, and server-tool contributions throw `unsupported`.

Bundled V1 and tactics-style `{ id, register(api) }` modules receive `workspaceApi` from `createTrustedHostContext`. `createManagedWorkspacePluginRuntime` is documented as the internal adapter behind that entry.
