---
artifact_id: ef53a052-8c32-467d-bc7f-0ae6edfaefed
title: tasks.md
status: draft
owner: or3-chat
date: 2026-02-21
---

# tasks.md

## 1. Define runtime plugin contracts
- [ ] Create shared workspace plugin runtime types (`Or3WorkspacePlugin`, `Or3WorkspacePluginApi`). (Requirements: 4.1, 7.1)
- [ ] Define explicit registration API surface for dashboard/sidebar/pane/message/tools. (Requirements: 4.1, 8.1)
- [ ] Add compatibility notes for additive API evolution. (Requirements: 4.1)

## 2. Add config-driven plugin registration model
- [ ] Extend `or3Config` schema/types to support `extensions.plugins.modules` and `extensions.plugins.defaultEnabled`. (Requirements: 4.1, 8.1)
- [ ] Add optional helper API for technical setup (e.g. `withOr3Plugins(...)`) to reduce config boilerplate. (Requirements: 4.1)
- [ ] Wire `extensions.plugins.modules` into Nuxt module activation with safe missing-package warnings. (Requirements: 5.1, 7.1)
- [ ] Add first-workspace bootstrap logic for `defaultEnabled` plugin IDs. (Requirements: 2.1, 5.1)
- [ ] Add `or3CloudConfig` operational toggles for plugin runtime loader and zip-install policy. (Requirements: 5.1, 6.1)

## 3. Implement workspace plugin runtime manifest endpoint
- [ ] Add `GET /api/plugins/runtime-manifest` with SSR auth gating. (Requirements: 1.1, 2.1, 7.1)
- [ ] Resolve active workspace and read `plugins.enabled` from workspace settings store. (Requirements: 2.1)
- [ ] Intersect enabled IDs with installed plugin inventory. (Requirements: 1.1, 5.1)
- [ ] Return deterministic manifest payload with revision token. (Requirements: 8.1)

## 4. Implement client workspace plugin loader
- [ ] Add new client loader plugin (`workspace-plugins.client.ts`). (Requirements: 1.1, 7.1)
- [ ] Discover installable plugin modules via `import.meta.glob('~~/extensions/plugins/*/plugin.client.ts')`. (Requirements: 1.1, 4.1)
- [ ] Load only enabled plugins from runtime manifest and invoke `register(api)`. (Requirements: 1.1, 8.1)
- [ ] Add per-plugin fault isolation (continue on error). (Requirements: 1.1, 5.1)
- [ ] Add cleanup handling for workspace changes and HMR disposal. (Requirements: 1.1, 8.1)

## 5. Add dedupe and precedence guard
- [ ] Implement plugin instance registry keyed by plugin id with source metadata. (Requirements: 3.1)
- [ ] Enforce single active instance per id. (Requirements: 3.1)
- [ ] Implement deterministic source precedence (`extension` over `builtin` when enabled). (Requirements: 3.1)

## 6. Refactor built-in tasks plugin for extraction safety
- [ ] Extract tasks registration logic into shared internal module. (Requirements: 3.1)
- [ ] Convert `tasks-pane.client.ts` into a thin compatibility wrapper using shared module. (Requirements: 3.1)
- [ ] Wire wrapper through dedupe registry so extension tasks can replace it cleanly. (Requirements: 3.1)

## 7. Create standalone Tasks plugin project
- [ ] Scaffold standalone plugin repository/package (`or3-plugin-tasks`). (Requirements: 3.1, 4.1)
- [ ] Add `or3.manifest.json` with stable `id: or3-tasks`. (Requirements: 3.1, 4.1)
- [ ] Add `plugin.client.ts` that registers pane/sidebar/tools with existing IDs/tool names. (Requirements: 3.1)
- [ ] Add Bun build/pack script to produce admin-installable zip artifact. (Requirements: 4.1, 5.1)

## 8. Admin plugin operations UX hardening
- [ ] Extend admin plugin page to show `Installed`, `Enabled`, and `Loaded` states. (Requirements: 5.1)
- [ ] Add non-sensitive runtime error/status hints for operators. (Requirements: 5.1)
- [ ] Ensure enable/disable flows reflect workspace-scoped settings accurately. (Requirements: 2.1, 5.1)
- [ ] Add UI hints for config-registered npm plugins (`installed via package + rebuild required`). (Requirements: 5.1)

## 9. Security and boundary validation
- [ ] Verify loader and extracted tasks plugin avoid server-only imports in client path. (Requirements: 7.1)
- [ ] Verify SSR plugin route guidance continues to require plugin access checks + `can()`. (Requirements: 6.1)
- [ ] Ensure admin install/enable mutations remain owner-only and rate-limited. (Requirements: 6.1)
- [ ] Verify cloud toggles can disable runtime loader and zip install routes independently. (Requirements: 6.1, 7.1)

## 10. Testing

### Unit
- [ ] Add tests for runtime manifest filtering/intersection logic. (Requirements: 2.1, 9.1)
- [ ] Add tests for loader diffing and duplicate guard precedence. (Requirements: 3.1, 9.1)
- [ ] Add tests for plugin contract validation and failure isolation. (Requirements: 4.1, 9.1)
- [ ] Add tests for `or3Config.extensions.plugins` parsing/validation/defaulting. (Requirements: 4.1, 9.1)
- [ ] Add tests for config-module resolution warnings on missing packages. (Requirements: 5.1, 9.1)
- [ ] Add tests for `or3CloudConfig` plugin operation toggles. (Requirements: 6.1, 9.1)

### Integration
- [ ] Add install -> enable -> manifest -> runtime load integration tests. (Requirements: 1.1, 5.1, 9.1)
- [ ] Add disable/uninstall cleanup tests (registrations removed, no stale UI). (Requirements: 1.1, 9.1)
- [ ] Add workspace-switch tests for plugin set changes. (Requirements: 2.1, 9.1)
- [ ] Add config-registered npm plugin module integration test (requires rebuild/restart path). (Requirements: 4.1, 9.1)

### Regression
- [ ] Add tasks parity tests covering pane/sidebar/tool behavior built-in vs extracted. (Requirements: 3.1, 9.1)
- [ ] Add data compatibility tests to verify existing `or3-task-list` records remain valid. (Requirements: 3.1, 9.1)

## 11. Rollout and documentation
- [ ] Add feature flag for workspace plugin runtime loader rollout. (Requirements: 9.1)
- [ ] Document plugin package contract and installable entrypoint conventions. (Requirements: 4.1, 5.1)
- [ ] Document config-first plugin setup flow (`bun add` + `config.or3.ts` module registration). (Requirements: 4.1, 5.1)
- [ ] Document cloud-side operational toggles and their impact. (Requirements: 5.1, 6.1)
- [ ] Document tasks extraction migration and rollback procedure. (Requirements: 3.1, 9.1)
- [ ] Update cloud/admin planning notes to mark runtime loader gap as resolved when completed. (Requirements: 1.1, 9.1)
