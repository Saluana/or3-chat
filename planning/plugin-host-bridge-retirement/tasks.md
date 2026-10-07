# Tasks

Tasks are ordered by dependency and each should take about 1–4 hours. Check boxes mark implementation work; creating this plan does not complete them.

There are three slices:
- Slice 1 is the shared foundation.
- Slice 2 is External Agents. It can release on its own.
- Slice 3 is Workflows.

Each slice deletes its bridge in the same change that ports its plugin. No period with both bridges and SDK paths is planned. Where a task touches destructive, credential or authorization behavior, write its failure list as test cases before writing the code.

Work happens in `or3-chat`, `../or3-plugin-external-agents` and `../or3-plugin-workflows`.

## 0. Baseline

- [ ] 0.1 Capture the installed-package parity baseline.
      Components: C10. Requirements: R9.AC1.
      Done when: both plugins at 0.1.1 are installed on a disposable host built from the starting commit. `external-agent-visual.spec.ts` and `workflows-installed.spec.ts` must pass. Their screenshots, package digests and a JSON summary are saved under `output/playwright/` and listed in `baseline.md` in this folder.

## 1. Shared foundation

- [ ] 1.1 Declare the new contract in the SDK.
      Components: C1. Requirements: R1.AC1, R2.AC2.
      Done when:
      - `@or3/plugin-sdk` types exist for `ui.kit`, `ui.sidebar`, `panes.list/onChange/target`, `files.limits`, `network.requestAccess/revokeAccess`, multipart `parts`, `workspace.connections.status/remove`, `ui.registerWorkspaceProfile`, and the C8 clients.
      - The five new grants are in `PluginGrant` and in `OR3_PLUGIN_V2_GRANT_REGISTRY`, with review copy.
      - The test host returns `unsupported` for each new method.
      - The SDK builds, and `plugin-runtime:compatibility:check` passes with refreshed snapshots.
      - No host feature is advertised yet.

- [ ] 1.2 Persist plugin storage in workspace KV.
      Components: C4. Requirements: R4.AC1–R4.AC3, R4.AC5.
      Done when: the trusted context's `storage` uses `or3.plugin.<id>.storage.<key>` in the activation database. Cases are added to `trusted-host-context.test.ts` for:
      - survival across reload and reactivation;
      - two-plugin and two-workspace isolation;
      - `stale-context` after a workspace switch;
      - CAS `conflict`;
      - prefix listing;
      - retention after disable.

- [ ] 1.3 Persist settings and add host-configured defaults.
      Components: C4. Requirements: R4.AC4.
      Done when:
      - Settings resolve in the order persisted, then manifest default, then `pluginSettingDefaults[<id>]`.
      - `resolve-config` maps the existing `OR3_WORKFLOWS_*`, `features.workflows.*` and `workflowSlashCommands` values into the `or3-workflows` entry.
      - `resolve-config.test.ts` and `config-metadata.test.ts` cover existing env-driven deployments.

- [ ] 1.4 Scope plugin secrets and unify the sign-out policy.
      Components: C5. Requirements: R5.AC1–R5.AC4.
      Done when:
      - The failure list is written first as test cases: cross-plugin key collision; preserve on stale-session startup; remove on observed sign-out and account change; removal of leftover legacy `or3.plugin.secret.*` keys; no `localStorage`.
      - Secrets use `or3.plugin.<id>.secret.<key>`, and `preservePluginSecrets` replaces `preserveExternalAgentCredentials`.
      - `logout-cleanup.test.ts` and `workspace-db-logout.test.ts` pass.
      - The vault key constant still exists here and is removed in 2.8.

- [ ] 1.5 Implement the UI kit, toast and sidebar navigation.
      Components: C2. Requirements: R2.AC1–R2.AC5.
      Done when:
      - `ui.kit` exposes the C2 union, and `ChatMessage` follows a theme switch without reactivation.
      - `ui.toast` shows a toast, and `ui.sidebar.show` returns `not-found` for unknown pages.
      - Trusted-context tests mount one kit component under two themes.

- [ ] 1.6 Complete pane control.
      Components: C3. Requirements: R3.AC1, R3.AC2.
      Done when: `panes.list`, `panes.onChange`, `target: { pane }` and the core `chat` / `doc` targets work. Tests cover listing two panes, routing a record into a specific pane, and disposing a listener with its activation.

- [ ] 1.7 Reset panes when a pane app is disposed.
      Components: C3. Requirements: R3.AC3.
      Done when: unregistering a pane app resets every pane in that mode to an empty chat pane, and a no-plugin test shows unrelated panes are untouched. `clearAgentPanes` and `clearWorkflowPanes` are still called but are now redundant; they are deleted in 2.8 and 3.8.

## 2. External Agents cutover

- [ ] 2.1 Add network access approvals and own-route authorization.
      Components: C6. Requirements: R6.AC1, R6.AC2.
      Done when:
      - The failure list is written first as test cases:
        - an unapproved origin is denied;
        - `http:` on a non-loopback host is rejected;
        - credentials or a query string in the origin are rejected;
        - path containment is enforced;
        - a declined origin is omitted from the result;
        - revocation takes effect immediately;
        - `/api/plugins/<other-id>/` is denied while the plugin's own prefix is allowed;
        - a Connect origin is allowed only while it is listed;
        - the plugin's `storage` cannot address the approvals namespace.
      - `requestAccess` shows one host modal per call, and approvals persist in `or3.plugin-host.<id>.network-approvals`.

- [ ] 2.2 Implement multipart parts and `files.limits()`.
      Components: C6. Requirements: R6.AC3.
      Done when: multipart bodies combining `files` refs and in-memory `parts` upload through `http.fetch`. The size bound and `signal` cancellation are tested, and `files.limits()` returns the configured limits.

- [ ] 2.3 Implement Connect connections.
      Components: C6. Requirements: R6.AC4.
      Done when:
      - `workspace.connections.status/list/remove` call the existing routes, with the intent header on removal.
      - All three return `unsupported` when Connect is disabled.
      - `connect.vue` emits `connections.changed` instead of `or3:external-agents:refresh-cloud-hosts`.
      - The connect API tests still pass.

- [ ] 2.4 Implement workspace profile registration.
      Components: C6. Requirements: R6.AC5.
      Done when: `ui.registerWorkspaceProfile` registers with host-derived plugin provenance and is withdrawn on dispose. A test shows the existing active-profile fallback after removal.

- [ ] 2.5 Implement the time-boxed legacy data migration.
      Components: C7. Requirements: R7.AC1–R7.AC3, R7.AC5.
      Done when:
      - Every C7 failure-list case is a test.
      - The table-driven migration runs before `setup()` for state version ≥ 2. Legacy keys are deleted only after a matching read-back, and a failure leaves legacy data with `legacy-migration-failed`.
      - A second run is a no-op.
      - `stateCompatibility` preflight refuses rollback to state version 1.

- [ ] 2.6 Advertise `or3-trusted-ui-kit-v1` and `or3-trusted-host-v2`.
      Components: C1. Requirements: R2.AC2.
      Done when: the loader advertises both features. A fixture package that requires an unadvertised feature is refused before `setup()`.

- [ ] 2.7 Port External Agents to the SDK.
      Components: C9. Requirements: R1.AC1, R6, R7.AC4.
      Done when:
      - In `or3-plugin-external-agents`:
        - `AgentHostPorts` and the `externalAgentHost` cast are deleted, and `ClientOnly` is local;
        - the host UI port is built from `ui.kit`, `ui.toast`, `ui.sidebar`, `panes` and `files.limits`;
        - connections use `storage`, and the vault adapter loads the `vault` secret during setup and writes through;
        - the staging protocol lives in `src/client`, with the former host tests moved there;
        - `transport.ts` uses `workspace.connections`.
      - Migrated host origins are requested once.
      - The manifest requires both features and state version 2, uses a new unused version, and raises the `engines` floor.
      - Package `test`, `typecheck` and `or3-plugin validate` pass, the last with no host aliases.

- [ ] 2.8 Delete the External Agents host code.
      Components: C1, C5. Requirements: R1.AC2, R1.AC4.
      Done when:
      - These are deleted: `external-agent-host-bridge.ts`, `external-agent-staging-bridge.ts` and its test, the `or3-external-agents` branch, `AGENT_BRIDGE_GRANTS` and `setDestinationAuthorizer` in `02-trusted-v2-clients.client.ts`, and `EXTERNAL_AGENT_CREDENTIAL_VAULT_KEY`.
      - With the plugin absent, build, type-check and `check-imports` pass.

- [ ] 2.9 Run the External Agents installed upgrade E2E.
      Components: C9, C10. Requirements: R7.AC4, R9.AC1.
      Done when: `external-agent-visual.spec.ts` seeds 0.1.1 connections and an unlocked vault, then installs the new version. It must prove:
      - one access prompt;
      - hosts that connect with no re-entry;
      - removal of the legacy keys;
      - the sidebar, pane, settings and four commands;
      - disable resetting open panes;
      - re-enable.
      The screenshots and the JSON parity report must match the baseline thresholds from 0.1.

## 3. Workflows cutover

- [ ] 3.1 Implement the posts client with write scoping.
      Components: C8. Requirements: R8.AC1.
      Done when: `posts.get/list/create/update/delete/onChange` work. Writes to a post type not declared by a pane registered in the activation return `permission-denied`.

- [ ] 3.2 Implement the chat messages client.
      Components: C8. Requirements: R8.AC1, R8.AC4.
      Done when:
      - `chat.messages` reads, `upsert`, `updateData` and `attachFile` reuse the bridge's transactions verbatim, including clocks and ref-count release on failure.
      - Tests cover type scoping, stale-workspace rejection, a duplicate-hash attach, and ref release when an attach fails.

- [ ] 3.3 Implement composer prefill, send handling and hook emission.
      Components: C8. Requirements: R8.AC2, R8.AC3.
      Done when: `chat.composer.prefill` and `chat.send.markHandled` behave as their bridge equivalents do. `hooks.emitAction` accepts only the four allowlisted workflow hooks, and core listeners (`ChatContainer.vue`, `useAi.ts`) still receive them.

- [ ] 3.4 Implement the AI provider and model updates.
      Components: C8. Requirements: R8.AC2.
      Done when: `ai.models()` includes `favorite` flags, `ai.onModelsChange` fires when favorites change, `ai.provider()` returns `not-signed-in` without a key, and `ai.requestSignIn()` dispatches `openrouter:login`. The grant's review copy states that the key is exposed.

- [ ] 3.5 Implement tools and background jobs.
      Components: C8. Requirements: R8.AC2.
      Done when: `tools.list/execute` respect the enabled-tool state and cancellation, and `jobs.available/track/abort/status` match the bridge behavior. A tracked job updates its message through the existing tracker.

- [ ] 3.6 Advertise `or3-trusted-chat-records-v1`.
      Components: C1. Requirements: R8.
      Done when: the loader advertises the feature, and the C8 contract tests in `tests/integration/trusted-plugin-contracts.test.ts` pass.

- [ ] 3.7 Port Workflows to the SDK.
      Components: C9. Requirements: R1.AC1, R8.
      Done when:
      - In `or3-plugin-workflows`:
        - `requireHostIntegrations` is removed;
        - the host and execution ports are built from SDK clients;
        - the `workflow-records-compat.ts` logic and `parseHashes` live in the plugin;
        - feature flags come from `settings`, and caption completion uses `ai.provider()`;
        - the pane and renderer are registered before `reconcileInterruptedRuns`.
      - The manifest requires all three features and the new grants, uses a new unused version, and raises the `engines` floor.
      - Package `test:routes`, `test:continuity` and `or3-plugin validate` pass.

- [ ] 3.8 Delete the Workflows host code and enforce the gate.
      Components: C1. Requirements: R1.AC1–R1.AC4.
      Done when:
      - `workflow-host-bridge.ts`, `workflow-records-compat.ts`, `WORKFLOW_BRIDGE_GRANTS` and the whole of `pluginContext()` are deleted.
      - The `check-imports` plugin-ID rule (C1) is active with its allowlist.
      - With the plugin absent, build, type-check and `check-imports` pass.

- [ ] 3.9 Run the Workflows installed E2E.
      Components: C9, C10. Requirements: R8.AC4, R9.AC1.
      Done when: `workflows-installed.spec.ts` passes. It must cover creation and the editor, slash run, a background run with HITL, generated-image attachment where a no-model fixture allows it, disable resetting open panes, and re-enable. Saved 0.1.1 workflows and execution rows must load and retry, and screenshots must match the baseline thresholds.

## 4. Documentation, release and verification

- [ ] 4.1 Update the documentation.
      Components: C10. Requirements: R9.AC3.
      Done when: the plugin authoring guide, the affected `public/_documentation/` pages (via `docmap.json`, including `architecture/activity-external-agents.md`) and both plugin READMEs describe the new capabilities, grants and features, and none mentions bridges. `check:docs` passes.

- [ ] 4.2 Do a simplification pass and inspect the final diff.
      Components: all. Requirements: R1.
      Done when: unused SDK types, options and adapters added during the work are removed. The final diffs of all three directories have been inspected, and `grep` finds no `externalAgentHost`, `workflowHostIntegrations` or `preserveExternalAgentCredentials`.

- [ ] 4.3 Run final verification in both configurations.
      Components: all. Requirements: R1.AC4, R9.AC1.
      Done when: the verification commands below pass once with both plugins installed and once with both absent. Results are recorded in `verification.md` in this folder. Pre-existing failures, such as the repository-wide lint debt noted in the unified extraction receipts, are listed separately from failures this change introduced.

- [ ] 4.4 Release in order.
      Components: C10. Requirements: R9.AC2.
      Done when:
      - The steps in `docs/releasing.md` are followed from a clean worktree.
      - New `@or3/plugin-sdk` and plugin versions are confirmed absent from tags and npm before tagging.
      - The SDK is published and verified first, if it is published; then the host; then the plugin packages.
      - A receipt records the versions, commits and digests.

## 5. Follow-up

- [ ] 5.1 Remove the legacy migration table.
      Components: C7. Requirements: R7.AC5.
      Done when: after the cutover release and confirmation that the known installs have upgraded, `legacy-plugin-data.ts`, its loader call, its tests and its `check-imports` allowlist entry are deleted.

## Verification commands

While working, run the relevant existing suites: `app/composables/plugins/__tests__/`, `app/utils/__tests__/logout-cleanup.test.ts`, `app/plugins/__tests__/workspace-db-logout.test.ts`, `tests/integration/trusted-plugin-contracts.test.ts`, the config tests and the plugin package suites.

For final integration (4.3), run these once in each configuration, then rerun only the affected checks after fixes:

```sh
bun run plugin-runtime:compatibility:check
bun run --cwd packages/plugin-sdk build
bun run test
bun run type-check
bun run check-imports
bun run check:docs
bun run build
```

Also run, in the plugin packages:

```sh
bun run --cwd ../or3-plugin-external-agents test
bun run --cwd ../or3-plugin-external-agents typecheck
bun run --cwd ../or3-plugin-workflows test:routes
bun run --cwd ../or3-plugin-workflows test:continuity
```

The two installed E2E specs run against a disposable host with `OR3_AGENT_INSTALLED_TEST_HARNESS=true` and `OR3_WORKFLOW_INSTALLED_TEST_HARNESS=true`. Do not substitute a broad Playwright run. Run `lint` and record its result; a strict lint pass is required only for files this change touched.

## Traceability Matrix

| Requirement | Components | Tasks |
| --- | --- | --- |
| R1 No plugin-specific host code | C1, C9 | 1.1, 2.6, 2.7, 2.8, 3.7, 3.8, 4.2, 4.3 |
| R2 Shared trusted UI kit | C2 | 1.1, 1.5, 2.6 |
| R3 Pane control | C3 | 1.6, 1.7 |
| R4 Persistent storage and settings | C4 | 1.2, 1.3 |
| R5 Scoped secrets | C5 | 1.4, 2.8 |
| R6 Networking, connections, profiles | C6 | 2.1, 2.2, 2.3, 2.4, 2.7 |
| R7 Legacy data migration | C7 | 2.5, 2.7, 2.9, 5.1 |
| R8 Workflows on public capabilities | C8 | 3.1–3.7, 3.9 |
| R9 Parity, release, documentation | C10 | 0.1, 2.9, 3.9, 4.1, 4.3, 4.4 |

## Definition of Done

- Every acceptance criterion in `requirements.md` passes.
- The traceability matrix has no gaps.
- `or3-chat` has no runtime code that recognizes either plugin by ID, except the reviewed allowlist. The allowlist's migration entry is tracked by 5.1.
- Both plugins activate from the public SDK alone, and `or3-plugin validate` reports no host aliases or private context properties.
- Existing Agents users keep their hosts and credentials after one access prompt. Existing Workflows rows load, stop and retry unchanged.
- The installed E2E parity reports match the baseline. Both configurations pass the verification commands, and the receipts are recorded in this folder.
