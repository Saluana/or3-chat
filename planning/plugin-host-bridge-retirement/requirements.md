# Requirements

## Introduction

Retire the two plugin-specific host bridges that the Workflows and External Agents extractions left in `or3-chat`. Each bridge hands one named plugin a private bag of host internals. Replace them with general trusted-tier SDK capabilities that any trusted plugin can request through grants and features. Move the External Agents legacy storage keys into plugin-scoped storage. Afterwards `or3-chat` contains no runtime code that recognizes either plugin by ID, and both plugins depend only on the public `@or3/plugin-sdk` contract.

## Context

Inspected on 2026-10-06: `or3-chat` branch `or3-cloud` at `513f4fb9` (clean), plus the sibling `or3-plugin-external-agents` and `or3-plugin-workflows` directories (not Git repositories).

- `app/plugins/02-trusted-v2-clients.client.ts` (`pluginContext()`) branches on `descriptor.id`. For `or3-external-agents` it attaches `context.externalAgentHost`. For `or3-workflows` it attaches `context.ui.workflowHostIntegrations`. Neither property is in the SDK types, so both plugins cast the context to reach them.
- The bridges are:
  - `external-agent-host-bridge.ts` (208 lines) and `external-agent-staging-bridge.ts` (129 lines).
  - `workflow-host-bridge.ts` (317 lines) and `workflow-records-compat.ts` (96 lines).
  - Together they expose Nuxt UI and app components, Nuxt composables, the multi-pane and sidebar APIs, raw workspace KV, `localStorage`, Dexie writes, the OpenRouter client and user key, background-job internals, the tool registry, and host hooks.
- The trusted host context (`trusted-host-context.ts`) already implements sidebar, pane, card, action, command, activity, tool, renderer, editor, hook-subscription, mediated `http`/`network`, `secrets`, `files` and `posts` clients. These gaps remain:
  - `storage` and `settings` are memory-only and are cleared on dispose.
  - `ui.toast`, `ui.confirm` and `ui.progress` return `unsupported`.
  - `workspace.connections.*` and `commands.run` are unsupported.
  - Multipart HTTP bodies are typed but throw "require a host file adapter".
- Plugin secrets are plaintext `localStorage` entries named `or3.plugin.secret.<key>`. They have no plugin or user namespace, and they are never cleared at sign-out.
  - `trusted-production-stores.ts` passes `or3.external-agents.credentials.v1` through unprefixed.
  - `logout-cleanup.ts` and `00-workspace-db.client.ts` carry `preserveExternalAgentCredentials` for that key alone.
- When a pane app is unregistered, panes already showing it are not reset. Both bridges therefore ship a per-plugin `clear*Panes()` function.
- The External Agents plugin requests the `storage.*`, `secrets.*` and `files.*` grants but uses none of them:
  - It stores connections in workspace KV `external-agents.connections.v1`. KV syncs to Cloud through `app/core/sync/hook-bridge.ts`.
  - It stores its own AES-GCM PIN vault in `localStorage` key `or3.external-agents.credentials.v1`.
  - Its destination approvals come from the bridge reading that KV entry.
- The workflow bridge passes `nuxtApp.$workflowSlash`, which nothing provides any more. The plugin overrides it.
- Core still emits and consumes `workflow.execution:action:*` hooks (`ChatContainer.vue`, `useAi.ts`, `backgroundJobWorkflowEvents.ts`). This is part of the background-job contract that core retains (unified extraction assumption A5).
- `@or3/plugin-sdk` is at 2.0.0. Both plugins are `private`, at version 0.1.1, and absent from `create-or3-chat/first-party-versions.json`. External Agents has not been submitted to the marketplace. Workflows is uploaded to central staging but unpublished. The installed base is local package installs only.

Related plans:
- `planning/plugin-host-sdk/` is the general SDK roadmap. This plan delivers the trusted-tier subset of its tasks 2.3–2.6, 3.3, 3.6, 4.2–4.5, 5.3, 5.9, 7.2, 7.6–7.8.
- `../planning/unified-plugin-extraction/` performed the extraction. This plan deliberately reverses its assumption A4 ("zero data migration") and task 6.5 for External Agents.

## Assumptions

- The scope is the trusted-host tier. Trusted plugins execute in the host JavaScript realm. Here the SDK boundary is a versioned contract and an install-review boundary, not a sandbox. Handing a trusted plugin real Vue components or a configured client is acceptable when it sits behind a declared grant or feature.
- This is a hard cutover. The host release that removes the bridges ships together with new plugin versions that require the new features. No period with both bridges and SDK paths is planned, because neither plugin has a published install base. An old plugin on a new host fails activation with its existing "requires host contracts" error. A new plugin on an old host is refused by `features.required`.
- External Agents data (connections and the encrypted vault) must survive the upgrade without user action. Workflows data already lives in core `posts` and `messages` rows and needs no migration.
- The `OR3_WORKFLOWS_*` environment variables keep working for existing deployments.
- This deliverable is a plan. It does not authorize implementation, version bumps, publication or production changes.

## Out of Scope

- The portable/isolated tier, host-rendered transcript DTOs (`plugin-host-sdk` 6.2), and contained custom UI.
- Moving OR3 Connect server code, the Connect page copy, the `external-agent.*` icon tokens, plugin-component CSS in core themes, and `ChatComposerShell` drag styles. These are separate cleanup items. Icon tokens remain a core theme contract per unified extraction task 4.2.
- Core's `workflow_state` background-job contract and the `workflow.execution:action:*` hook names.
- Changing `or3-workflow-core` or `or3-workflow-vue` beyond adapting their host ports.
- Marketplace submission or publication of either plugin.

## Requirements

### R1: No plugin-specific host runtime code

**User Story:** As a maintainer, I want core to treat every trusted plugin the same way, so that installing, removing or replacing a plugin never depends on host code written for it.

**Acceptance Criteria:**
- R1.AC1: WHEN a trusted plugin activates THEN the host SHALL build its context only from its effective grants and declared features. No code path SHALL branch on its plugin ID.
- R1.AC2: WHEN cutover completes THEN `external-agent-host-bridge.ts`, `external-agent-staging-bridge.ts`, `workflow-host-bridge.ts`, `workflow-records-compat.ts`, `EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY` and `preserveExternalAgentCredentials` SHALL no longer exist.
- R1.AC3: WHEN `check-imports` runs THEN it SHALL fail if `app/`, `server/` or `shared/` contains `or3-external-agents`, `or3-workflows`, `externalAgentHost` or `workflowHostIntegrations` outside a short reviewed allowlist. The allowlist holds the Minimal Chat profile hidden-ID list, the `OR3_WORKFLOWS_*` config translation, and the time-boxed legacy data table (R7).
- R1.AC4: WHEN either plugin is absent THEN build, type-check, `check-imports` and the core test suite SHALL pass, with no dangling references.

### R2: Shared trusted UI kit

**User Story:** As a trusted plugin author, I want the host's standard components and theme helpers through the SDK, so that my UI matches the app without importing host internals.

**Acceptance Criteria:**
- R2.AC1: WHEN a plugin declares the required feature `or3-trusted-ui-kit-v1` THEN `context.ui.kit` SHALL provide the union of components and helpers both plugins use today (design C2), with SDK types.
- R2.AC2: WHEN the host lacks the declared kit feature THEN activation SHALL fail before `setup()` with a stable unsupported-feature error.
- R2.AC3: WHEN the active theme changes THEN kit components and theme helpers SHALL reflect it without plugin reactivation. `ChatMessage` SHALL resolve the theme's override as the agents bridge does today.
- R2.AC4: WHEN a plugin calls `context.ui.toast()` THEN the host SHALL show the toast. The call SHALL no longer return `unsupported`.
- R2.AC5: WHEN a plugin calls `context.ui.sidebar.show(pageId)` or `closeIfMobile()` THEN the host SHALL activate that registered page or close the mobile sidebar. Unregistered page IDs SHALL return `not-found`.

### R3: Complete pane control

**User Story:** As a plugin author, I want to inspect and target panes through the SDK, so that I can restore sessions and route records without the multi-pane API.

**Acceptance Criteria:**
- R3.AC1: WHEN a plugin calls `context.panes.list()` THEN it SHALL receive each pane's ID, app, record ID and active flag. `onChange` SHALL deliver updates until disposed.
- R3.AC2: WHEN a plugin opens a record with `target: { pane: id }` or `'replace-active'` THEN the host SHALL load the record into that pane.
- R3.AC3: WHEN a pane app registration is disposed THEN the host SHALL reset every pane showing that app to an empty chat pane. No plugin cleanup code SHALL be required for this.

### R4: Persistent plugin storage and settings

**User Story:** As a plugin author, I want storage and settings that survive reloads and follow the workspace, so that I do not need private KV access.

**Acceptance Criteria:**
- R4.AC1: WHEN a trusted plugin writes `context.storage` THEN the value SHALL persist in the active workspace under a host-derived namespace containing the plugin ID. It SHALL survive reload and plugin reactivation, and it SHALL follow the workspace's existing KV sync behavior.
- R4.AC2: WHEN two plugins or two workspaces use the same key THEN their values SHALL stay separate. A workspace switch SHALL never read or write the previous workspace.
- R4.AC3: WHEN `set` is called with `ifRevision` THEN a stale revision SHALL return `conflict` without writing.
- R4.AC4: WHEN a plugin reads `context.settings` THEN it SHALL receive persisted values over manifest defaults over host-configured defaults. Existing `OR3_WORKFLOWS_*` values SHALL appear as Workflows setting defaults.
- R4.AC5: WHEN a plugin is uninstalled THEN its storage and settings SHALL remain until the existing data-removal action is used. Disable or replace SHALL NOT delete them.

### R5: Scoped plugin secrets with one sign-out policy

**User Story:** As a user, I want plugin credentials isolated per plugin and handled consistently at sign-out, so that one plugin cannot collide with another and stale credentials do not linger.

**Acceptance Criteria:**
- R5.AC1: WHEN a plugin calls `context.secrets` THEN entries SHALL be stored device-locally under a namespace derived from the plugin ID. They SHALL never be written to synced KV.
- R5.AC2: WHEN two plugins use the same secret key THEN they SHALL not see each other's values.
- R5.AC3: WHEN startup cleanup runs for a stale session THEN plugin secrets SHALL be preserved, matching today's vault behavior. WHEN an observed sign-out or account change occurs THEN all plugin secrets SHALL be removed.
- R5.AC4: The secret store SHALL contain no key special-cased for a named plugin.

### R6: Governed networking, connections and profiles

**User Story:** As a user, I want plugins to reach only hosts I approved, and to manage Cloud connections and workspace profiles through host-owned flows.

**Acceptance Criteria:**
- R6.AC1: WHEN a plugin calls `context.network.requestAccess({ origins, purpose })` THEN the host SHALL show one host-owned confirmation listing the origins that are not yet approved. It SHALL persist the approved origins for that plugin and workspace in host-owned storage that the plugin cannot write. Only HTTPS origins and loopback HTTP origins SHALL be accepted.
- R6.AC2: WHEN `http.fetch` or `network.stream` targets an origin THEN it SHALL succeed only for manifest-declared destinations, user-approved origins, or the plugin's own `/api/plugins/<id>/` routes on the host origin. `revokeAccess(origin)` SHALL remove an approval.
- R6.AC3: WHEN a plugin sends a multipart body THEN the host SHALL upload it with bounded total size and SHALL honor cancellation. Parts can be file references or in-memory byte parts.
- R6.AC4: WHEN Connect is enabled THEN `workspace.connections.list()` SHALL return the user's Connect environments, and `remove(id)` SHALL perform the existing intent-checked removal. When Connect is disabled, both SHALL return `unsupported`.
- R6.AC5: WHEN a plugin with the `ui.workspace-profile.register` grant registers a profile THEN it SHALL appear with plugin provenance and SHALL be withdrawn on dispose. The existing fallback after removal SHALL apply.

### R7: Legacy External Agents data moves without loss

**User Story:** As an existing Agents user, I want my saved hosts and encrypted credentials to carry over automatically, so that upgrading needs no re-pairing.

**Acceptance Criteria:**
- R7.AC1: WHEN External Agents at the new state version activates and legacy data exists THEN, before `setup()`, the host SHALL:
  - copy `external-agents.connections.v1` into the plugin's storage key `connections`, per workspace;
  - copy `or3.external-agents.credentials.v1` into its secret key `vault`, per device.
- R7.AC2: WHEN a copy is read back byte-for-byte THEN, and only then, the host SHALL remove that legacy key. On any failure the legacy key SHALL remain, activation SHALL fail with an actionable error naming the key, and a retry SHALL be safe.
- R7.AC3: WHEN migration has completed THEN rerunning it SHALL be a no-op, because the legacy key is absent. Rollback to 0.1.x SHALL be refused through the existing `stateCompatibility` preflight.
- R7.AC4: WHEN the upgraded plugin first runs THEN it SHALL request access for its migrated host origins in one prompt. Afterwards the user's hosts SHALL connect with no re-pairing or credential re-entry.
- R7.AC5: The migration table SHALL be data-only, SHALL cover only these legacy keys, and SHALL carry a removal task.

### R8: Workflows on public capabilities

**User Story:** As a maintainer, I want Workflows to run on the same SDK as any other trusted plugin, so that host changes cannot silently break it.

**Acceptance Criteria:**
- R8.AC1: WHEN Workflows reads or writes its records THEN it SHALL use `context.posts` and `context.chat.messages`. Writes SHALL be limited to the post type of its registered pane and the message type of its registered renderer.
- R8.AC2: WHEN Workflows executes THEN models, favorites, the provider client, tools, background jobs, HITL responses, generated-image persistence, composer prefill, send interception and workflow hooks SHALL come from SDK capabilities (design C8). It SHALL NOT import host composables.
- R8.AC3: WHEN a plugin emits a host hook THEN only names on the reviewed emit allowlist SHALL be accepted.
- R8.AC4: Existing `workflow-entry` posts and terminal or in-flight `workflow-execution` messages SHALL load, stop and retry unchanged.

### R9: Parity, release and documentation

**User Story:** As a maintainer, I want proof that users see no change, and correctly ordered releases.

**Acceptance Criteria:**
- R9.AC1: WHEN both plugins are installed THEN the installed E2E specs and screenshot comparisons SHALL match the pre-change baseline, within the thresholds recorded in the phase 5–6 receipt.
- R9.AC2: WHEN versions are cut THEN they SHALL follow `docs/releasing.md`:
  - new never-used SDK and plugin versions, with the SDK published first if it is published at all;
  - the plugins require the new features and raise their `engines` floors.
- R9.AC3: WHEN public behavior changes THEN the plugin authoring guide, `public/_documentation/` (via `docmap.json`) and both plugin READMEs SHALL describe the new capabilities, grants and features, and SHALL no longer mention bridges.
