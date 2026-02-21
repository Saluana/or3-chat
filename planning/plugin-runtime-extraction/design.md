---
artifact_id: af44d9ad-ab22-4788-ab0b-982ea7172220
title: design.md
status: draft
owner: or3-chat
date: 2026-02-21
---

# design.md

## Overview

This design introduces a production plugin runtime loader for workspace plugins installed via Admin, and a safe extraction path for the existing Tasks plugin.

The design keeps OR3 constraints intact:
- local-first default behavior remains valid,
- workspace enablement is read from canonical workspace settings,
- extension model stays registry/composable driven,
- static builds remain safe.

## Current-state findings

1. Extension install/uninstall and workspace enable/disable already exist.
2. Admin plugin runtime loading exists via `import.meta.glob`.
3. Main app runtime loading for installed workspace plugins is not yet wired.
4. Tasks is currently a built-in client plugin under `app/plugins/tasks-pane.client.ts`.

## Architecture

```mermaid
flowchart TD
    A[Admin installs plugin zip] --> B[extensions/plugins/<id>]
    C[Admin enables plugin for workspace] --> D[WorkspaceSettingsStore plugins.enabled]

    E[Client workspace plugin loader] --> F[GET /api/plugins/runtime-manifest]
    F --> D
    F --> G[listInstalledExtensions]

    E --> H[import.meta.glob extensions/plugins/*/plugin.client.ts]
    H --> I[Load enabled plugins only]
    I --> J[register(api)]
    J --> K[Dashboard/Sidebar/Pane/Tools registries]

    L[Built-in Tasks wrapper] --> M[Compatibility guard]
    N[Extracted Tasks plugin] --> M
    M --> K
```

## Core components

### 1) Workspace plugin runtime loader (client)

New client plugin (example: `app/plugins/workspace-plugins.client.ts`) responsible for:
- resolving active workspace context,
- fetching runtime manifest of enabled plugin IDs,
- importing only enabled plugin entrypoints,
- invoking plugin registration through a constrained API,
- tracking and disposing plugin registrations on workspace switch/HMR.

Loader discovery pattern:

```ts
const modules = import.meta.glob('~~/extensions/plugins/*/plugin.client.ts');
```

### 2) Runtime manifest endpoint (server)

New SSR endpoint (example: `GET /api/plugins/runtime-manifest`) returns workspace-scoped enabled plugin IDs filtered by installed plugins.

Responsibilities:
- resolve session/workspace,
- read `plugins.enabled` via `WorkspaceSettingsStore`,
- intersect with installed plugin inventory,
- return deterministic payload for client loader.

Proposed response shape:

```ts
interface PluginRuntimeManifestResponse {
  workspaceId: string | null;
  enabledPluginIds: string[];
  installedPluginIds: string[];
  revision: string; // hash/version for cache busting
}
```

### 3) Workspace plugin contract (shared)

Introduce a shared runtime contract for installable workspace plugins.

```ts
export interface Or3WorkspacePlugin {
  id: string;
  register(api: Or3WorkspacePluginApi): void | Promise<void>;
}

export interface Or3WorkspacePluginApi {
  registerDashboardPlugin: typeof registerDashboardPlugin;
  registerSidebarPage: typeof registerSidebarPage;
  registerPaneApp: typeof usePaneApps extends () => infer T
    ? T extends { registerPaneApp: infer F } ? F : never
    : never;
  registerMessageAction: typeof registerMessageAction;
  registerTool: (def: ToolDefinition, handler: ToolHandler) => () => void;
  onCleanup: (fn: () => void | Promise<void>) => void;
}
```

Principles:
- explicit API surface,
- additive evolution,
- no direct mutation of internal globals by plugin authors.

### 4) Plugin instance registry + dedupe guard

Add a runtime registry keyed by plugin id with source metadata (`builtin`, `extension`) and cleanup handlers.

Rules:
- only one active instance per plugin id,
- `extension` source takes precedence when enabled,
- duplicate register attempts are ignored with structured warning.

### 5) Tasks extraction strategy

#### Phase A (compatibility refactor in-core)
- Move Tasks registration logic into reusable module (e.g. `app/plugins/tasks/runtime/register.ts`).
- Keep `app/plugins/tasks-pane.client.ts` as a thin compatibility wrapper.

#### Phase B (external plugin project)
- Create standalone project (e.g. `or3-plugin-tasks`) with:
  - `plugin.client.ts`,
  - copied/adapted tasks components/composables/tooling,
  - `or3.manifest.json` (`kind: plugin`, `id: or3-tasks`).

#### Phase C (activation precedence)
- If extracted plugin is installed+enabled, extension instance wins.
- Built-in wrapper remains fallback until rollout is complete.

Invariants that must not change:
- pane app id: `or3-tasks`,
- sidebar page id: `or3-tasks-page`,
- post type: `or3-task-list`,
- tool names: `or3_tasks_*`.

### 6) Admin panel improvements

Leverage existing install/enable/settings UI and add runtime status hints:
- `Installed` (filesystem present),
- `Enabled` (workspace setting present),
- `Loaded` (observed by runtime loader heartbeat/status endpoint).

Status API can be additive and read-only.

## Data and API contracts

### Manifest (existing)

Continue using `or3.manifest.json` schema with `kind/id/name/version/description/capabilities/access`.

### Workspace settings keys (existing)

- `plugins.enabled`: JSON string array
- `plugins.settings.<pluginId>`: JSON object string

No key format changes required.

## Error handling

1. Missing runtime manifest endpoint or auth-disabled mode:
- Loader degrades to no installed workspace plugins.

2. Plugin module import failure:
- Log plugin id + safe error summary.
- Continue loading other plugins.

3. Register failure inside plugin:
- Catch, log, skip plugin.
- Keep app functional.

4. Workspace switch during load:
- Use load token/version to cancel stale registrations.

5. Duplicate plugin id:
- Apply precedence policy; never double-register.

## Security and boundaries

- No server-only imports in client loader.
- Plugin runtime loading is client-side only.
- Protected plugin server routes must continue using plugin access checks + `can()`.
- Admin install/enable remains owner-only mutation.

## Performance considerations

- Import only enabled plugin IDs.
- Cache runtime manifest by revision/TTL.
- Avoid re-registering plugins when enabled set is unchanged.
- Keep cleanup deterministic to avoid leaked timers/hooks/listeners.

## Testing strategy

### Unit
- Loader set-diff logic (add/remove/unchanged).
- Dedupe precedence (`extension` vs `builtin`).
- Manifest validation edge cases.

### Integration
- Admin install plugin zip -> plugin listed.
- Enable plugin for workspace -> runtime manifest returns plugin id.
- Loader imports plugin and registers pane/sidebar/actions.
- Disable plugin -> cleanup paths execute.

### Regression (Tasks)
- Built-in tasks still works with no installed tasks plugin.
- Installed tasks plugin preserves existing list data and tool behavior.
- No duplicate tasks entries in sidebar/dashboard.

### E2E
- Multi-workspace behavior: plugin enabled in workspace A, disabled in B.
- Reload and workspace switch maintain correct plugin activation.

## Rollout and rollback

Rollout:
1. Ship loader + manifest endpoint behind feature flag.
2. Refactor built-in tasks to shared registration module.
3. Publish and install extracted tasks plugin in staging.
4. Enable per workspace and validate parity.
5. Remove built-in fallback only after sustained validation.

Rollback:
- Disable runtime loader flag.
- Keep built-in tasks wrapper active.
- Uninstall/disable extracted tasks plugin.
