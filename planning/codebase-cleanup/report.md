# Codebase cleanup report (2026-10-07)

Read-only subagent sweeps covered the whole repository: components, composables and
utils, server, shared and packages, legacy code and dependencies, docs and planning,
and assets, scripts and tests. Every candidate was then re-checked by hand before
anything was removed. This PR removes only what was proven dead. Everything below
is **not** removed: it is worth doing, but each item carries some risk or needs an
owner's decision.

## What this PR removed

85 files changed, about 4,630 lines deleted.

- **Dead files (17):** 4 unmounted components (`PluginCapabilities`, `ChatContextMeter`,
  `PaneHeader` and its CSS block, the `docs` layout), 3 orphan barrels
  (`app/core/search/command-palette/index.ts`, `app/core/notifications/index.ts`,
  `shared/sync/index.ts`), a no-op Nitro plugin shim, a re-export shim
  (`server/utils/webhooks/store/sqlite-store.ts`), unused modules
  (`app/utils/capability-guards.ts`, `app/utils/files-constants.ts`,
  `app/composables/documents/useDocumentEditorToolbar.ts`, root `utils/date.ts`,
  `shared/plugins/isolation/iframe-runtime.ts`), and two test-only modules with their
  tests (`useAdminAuth`, `iframe-runtime`).
- **Unused exports (about 60):** functions, constants, type aliases and test seams that
  nothing calls, across `app/`, `server/` and `shared/`.
- **Artifacts (9):** root review outputs (`dumb-issues.md`, `di-july-31.md`), an orphaned
  deployment template (`convex-akash.yml`), a stale evidence receipt with local paths,
  an unread fixture (`or3-scroll-0.0.3-baseline.json`), a stale manual test guide, an
  unreferenced image, and two planning scratch files.

How each removal was verified:

- Searched by every name form: path, alias paths, basename, and Nuxt auto-import and
  component names.
- Checked against the plugin compatibility ledger and the public API snapshot.
- Checked against the 139 host symbols and 79 host module paths that the provider
  packages import (from their generated `or3-chat-contract.ts` shims).
- Searched every sibling OR3 repository.
- CI-profile Nuxt typecheck; every vitest lane except `live` (6,239 tests, 0
  failures); ESLint with `--max-warnings=0` on every modified file; ledger and
  snapshot checks; `check:docs`.

## Important: things that look dead but are not

These came up as removal candidates and must stay:

- **Host symbols the provider packages import.** The SQLite, Convex, Clerk, fs and S3
  providers build against host modules such as `shared/chat/background-history`,
  `shared/cloud/admin-identity`, `shared/sync/types` and `shared/sync/schemas`.
  Symbols like `backgroundHistoryDeviceId` and `ADMIN_IDENTITY_ISSUER` have no caller
  in this repo but are used by providers. Before removing anything under `shared/` or
  `server/`, check the providers' `src/shims/or3-chat-contract.ts`.
- **`scripts/release/check-create-or3-chat.mjs`.** No reference in the repo, but the
  release audit runs it as the creator registry qualification
  (`bun run scripts/release/check-create-or3-chat.mjs --registry`). Consider adding a
  `package.json` script so it is discoverable.
- **`package-lock.json` and `bun.lock`.** Both are load-bearing (Dockerfile `npm ci`,
  release workflows, `check-lock-drift.mjs`, frozen bun installs).
  `package-lock.json` is listed in `.gitignore` despite being tracked, which is
  misleading. Remove that line or add a comment.
- **The legacy V1 registry paths (`registerLegacy`, `useV2Surface`).** The
  `OR3_PLUGIN_CONTRIBUTION_V2_SURFACES` allowlist defaults to empty, so the legacy
  path is the live default. A milestone check asserts that it stays empty.
- **Ledger-listed aliases.** `UnifiedStreamingState` and `AI_SETTINGS_STORAGE_KEY` have
  no callers but are in the plugin compatibility ledger. They need a contract
  retirement, not a deletion.
- **Machine-read files.** `planning/complete/plugin-runtime-v2/**` (ledger and
  snapshot generators), `planning/project-memory-classification/`,
  `examples/plugins/{dashboard-insights-v2,selected-document-utility}`,
  `official-plugins/`, the docs read by `check-docs.mjs`, and the
  `tsconfig.eslint.*.json` files (built by string in `eslint.config.mjs`).

## 1. Unwired or possibly missing enforcement (decide: wire it up or delete it)

These are unused today. Each one might be dead code, or might be a check that was
meant to run and never got wired in. Deleting them is runtime-neutral, but it would
hide the gap if they were meant to run.

| Item | Location | Note |
| --- | --- | --- |
| `authorizePluginAction` | `server/utils/plugins/ai/plugin-invocation.ts:265` | Documented as the "RT14 boundary" for AI-initiated actions. Live enforcement calls `checkActionApproval` directly in `connections/dispatch.ts`. |
| `revokeHostActivationsForWorkspace` | `server/utils/plugins/isolation/activation-registry.ts:241` | Doc says "(workspace switch)" but nothing calls it. Live activations may survive a workspace switch. |
| `evaluateCapability` | `server/auth/capability-gate.ts:73` | Test-only parallel authz gate with a `wrong_workspace` check that `can()` lacks. |
| `createConnectionDispatchMethod` | `server/utils/plugins/connections/broker-binding.ts:75` | Test-only duplicate of the live `connections.dispatch` handler. |
| `installPortableUnloadTeardown` and `stopAllPortableClients` | `app/composables/plugins/portable-client-runtime.ts:1587` | The pagehide teardown is never installed. |
| `evaluateContainmentAttempt`, `sha256CspHash` | `shared/plugins/isolation/containment-policy.ts:232`, `shared/plugins/digest.ts:100` | Containment helpers that production never calls. |
| `validateCardHostMessage` | `shared/plugins/isolation/tool-card-protocol.ts:148` | Unused tool-card message validator. |
| `canAdvanceAcquisitionStage`, `shouldResumeDownload` | `shared/plugins/acquisition/contracts.ts:249,269` | Acquisition state-machine guards with no caller. |
| `withHostSession` | `shared/plugins/isolation/rpc-envelope.ts` | Session-binding helper with no caller. |
| `CONTAINED_VIEW_CONTAINMENT` | `shared/plugins/isolation/contained-view-policy.ts:30` | Policy object nothing applies. |
| `MAX_SYNC_GC_CONTINUATIONS`, `MAX_SYNC_GC_BATCH_SIZE`, `computePullRetention` | `shared/sync/history-gc-policy.ts` | Limits from the sync hardening requirements that GC never enforces. |
| `isolated-server-runtime.ts` and its test | `server/admin/plugins/isolation/` | About 1,200 lines. Plugin-runtime task 8.11 is marked complete, but nothing spawns the runtime. |
| `useClientSessionRecovery` | `app/composables/auth/useClientSessionRecovery.ts` | No provider registers a recovery handler, so `recoverClientSession` always returns false. |
| `verifyAdminStoreProviderContract` | `shared/testing/contracts/admin.ts:42` | Provider contract suite that no provider runs. |
| `transitionRuntimeStatus` and the related machinery | `shared/plugins/runtime-state.ts:84` | The plugin runtime state machine is only exercised by tests. |
| `stream-protocol.ts` | `shared/plugins/isolation/` | Unwired stream module. Planning task 5.4 cites it as evidence. |

## 2. Large removals that need an owner's yes

| Item | Size | Benefit | Risk |
| --- | --- | --- | --- |
| Dev sync harness: `app/pages/tests/sync-harness.vue`, `TestItem.vue`, `app/composables/tests/syncHarnessRunner.ts` | ~1,560 lines | Removes two dev-only routes and a test runner. | Only reachable in dev by URL. Confirm nobody still uses it. |
| Unmounted project tree: `SidebarProjectTree.vue`, `useProjectTreeActions.ts`, `app/plugins/examples/project-tree-actions.client.ts`, `docs/UI/project-tree-actions.md` | ~460 lines | Removes a never-mounted host and its registry. | The registry is documented as an extension point. Decide whether to delete the feature or re-mount it. |
| Write-only metrics: `server/utils/storage/metrics.ts`, `server/auth/metrics.ts` | ~200 lines | Nothing reads the counters, and several are always 0. | Touches the session hot path and three storage routes. Alternatively, expose `getMetrics` in admin status. |
| No-op `logBgStream`/`warnBgStream` stubs | 73 call sites | About 80 lines of calls that do nothing. | Check each argument for side effects before deleting. |
| Legacy `db` singleton and unused `~/db` barrel members (`app/db/index.ts`) | ~25 members | Removes a stale-reference hazard and an unused API surface. | `SideBar.vue` uses `db` 12 times and needs a workspace-switch test after moving to `getDb()`. |
| Theme `app.config.ts` loader (`theme-manifest.ts`, both `90.theme.*` plugins) | loader plus two maps | The glob matches nothing for any shipped theme. | Forked third-party themes that add `app.config.ts` would lose their overrides. |

## 3. Deprecated code that still has callers (migrate, then delete)

- `requireAdminApi` (`server/admin/api.ts`): 11 admin routes still use it. Migrate them to
  `requireAdminApiContext` and keep the session shape for the three callers that read it.
- Legacy 2-argument `registerDocumentEditorSession` overload: only a test uses it.
- `DOCUMENT_EDIT_TOOL` alias: one caller and one test.
- `formatAdminError`: one caller. Inline `parseErrorMessage(error, 'Unknown error')`.
- `SendMessageParams.online`: never set to `true`. `modelVariant` replaced it.
- Duplicate `images` field in the chat send payload (`ChatInputDropper.vue`,
  `ChatContainer.vue`): it carries the same array as `attachments`.
- `addAccessDecisionFilter` adapter (`server/auth/hooks.ts`): an advertised extension
  point. Check external extensions first.
- `app/pages/admin/workspace.vue` redirect page: replace with a `routeRules` redirect.
- `listAllImageMetas`, `useThemeClasses` (dev-only warning shim),
  `PORTABLE_WORKER_CONTAINMENT`, and the `useUserApiKey` compatibility re-export in
  `app/utils/index.ts`.

## 4. Duplicates to consolidate

- `isAbortError` (4 copies), `truncate` (2), `isRecord`/`asRecord`/`isPlainObject` (5 in
  `app/`, 4 in `server/`), `isMissingConvexFunctionError` (3), `utf8Bytes` (4).
- Security-relevant: `isInside` has 4 copies, two of which use `startsWith` and accept
  unnormalized paths. `PORTABLE_FRAME_SANDBOX` is defined twice. Keep the
  `relative()`-based `isInside`, and keep one sandbox definition.
- Rate-limit stores: three hand-rolled maps (`server/utils/rate-limit.ts`, admin login
  lockout, webhooks) next to the shared sliding-window store.
- App and server `contribution-surface-selection` factories, about 17 one-line
  `useV2Surface()` wrappers, and the local `sha256` hex in `revision-codec.ts` versus
  `app/utils/hash.ts`.
- Cross-package: `serializeInitialCredentials` and `detectPackageManager` are duplicated
  between `shared/cloud/wizard` and `packages/or3-cloud` / `create-or3-chat`.
- `forkThread` in `app/db/threads.ts` and `app/db/branching.ts`: two functions with the
  same name and different semantics.
- Thin wrappers: `ResizeHandle`/`PaneResizeHandle` around `BaseResizeHandle`, the
  `DocumentationPageShell` pass-through, and the marketplace uninstall confirm dialog
  (duplicated in Discover and Installed).
- `requireAdminEnabled` is unused, while the same guard is copied inline in 20 routes.

## 5. Misplaced or accidental surface

- `app/pages/images/GalleryGrid.vue` and `ImageViewer.vue` are components inside
  `pages/`, so Nuxt also serves them as `/images/GalleryGrid` and `/images/ImageViewer`.
  Move them to `app/components/images/`.
- Non-route helpers inside the route tree (`server/api/**/_helpers.ts`,
  `route-factories.ts`). Move them to `server/utils`.
- `shared/plugins/connections/fake-provider.ts` is a test fixture in production `shared/`.
- Endpoints to confirm and remove: the static `server/api/admin/workspaces/soft-delete.post.ts`
  and `restore.post.ts` (they always return 400; the UI uses the `[id]` routes),
  `server/api/plugins/protected.get.ts` (a demo route), the unreferenced
  `server/api/admin/auth/change-password.post.ts`, and `update-pin.post.ts` with
  `writeUpdatePin` (no UI caller).

## 6. Unused exports kept because providers import their module

These exports are unused, but they live in modules the providers import, so removing
them is a contract decision:

- `shared/sync/schemas.ts`: 13 `*Z` type aliases.
- `shared/sync/types.ts`: `SyncEngineConfig`, `SyncEngineStatus`.
- `shared/cloud/provider-ids.ts`: `LIMITS_PROVIDER_ID_LIST`, `BACKGROUND_PROVIDER_ID_LIST`,
  `CONVEX_GATEWAY_PROVIDER_ID`.
- `shared/plugins/connections/contracts.ts`: `ConnectionRequirement`,
  `ConnectionResolution`, `ConnectionSecretDigest`.
- Registry read helpers with no caller (`getConnectStore`, `getConnectRelay`,
  `listProviderAdminAdapters`, `getEntitlementResolver`, and others). The register side
  is used by providers.

## 7. Test-only modules (delete with their tests, or keep as specs)

`shared/plugins/transactional-plugin-scope.ts` and `shared/hooks/hook-shadow.ts` are
cited by qualification records. Also: `inspectServerToolOwnership`,
`setPluginAccessPolicy` (the write side was never wired), `describeConnectionFailure`,
`getModelVariantDescription`, and `host-esm-facade-proof.ts`. The last one exercises
the live `host-esm-facade.ts`, so deleting it loses coverage.

## 8. Types, config and dependencies

- Type shims outside every tsconfig program: `types/orama.d.ts`, `route-meta.d.ts`,
  `pwa.d.ts`, `editor-hooks.d.ts` and `pane-plugin-api.d.ts`. They are only in ESLint's
  program. `types/theme-generated.d.ts` is regenerated on every theme compile but still
  tracked. Delete the shims, or wire them in and fix the docs that describe them.
- Barrels: `app/composables/index.ts` (about 60 `export *` lines; Nuxt already
  auto-imports these) and `app/core/sync/index.ts` (cited by a doc snippet).
- Dependencies: `@tiptap/extension-image` and `reka-ui` have no direct imports and
  duplicate `@nuxt/ui`'s own pins. `vite-bundle-visualizer` and the `analyze` script are
  broken (nothing writes `dist/stats.html`). Verify `@types/better-sqlite3` with a
  typecheck. Each removal needs `bun.lock` and the fixed-profile `package-lock.json`
  regenerated.
- `nuxt.config.ts:743` ignores `app/pages/_test.vue`, which no longer exists.
  `app/theme/cyberpunk/or3.manifest.json` duplicates `theme.ts` metadata.

## 9. Assets and artifacts

- Logos: `logo-512.png` and `logo-1024.webp` were PWA icons until 2026-10-05, so
  installed apps may still request them. `logo-8bit-raw.png` (988 KB), `logo-xl.png` and
  `logo-1024.png` are kept online on purpose (`globIgnores`). The `app-icon*.svg` files
  are regeneration outputs. Remove these once external links are ruled out.
- About 8.5 MB of used PNGs could be recompressed: the README and wizard screenshots
  and the cyberpunk theme backgrounds. They are not removal candidates.
- Agent tooling: `.agent/docs/*.txt` (vendored llms.txt files, cited from a `/.llms/`
  path that does not exist) and `.agent/skills/plugin-development/references/`
  (about 420 KB, drifted copies of the public docs). Also duplicate skills (`.agent`
  versus `.codex` neckbead-review; `doc-maker` versus `documentation-architect`), the
  stale `.opencode/` tree, the v1 retro-agent prompts in `.github/`, and the personal
  `or3-chat.code-workspace`.
- `repomix.*.config.json` (7 files): no script runs them, and their include lists are stale.
- Kept on purpose: `tests/manual/notification-tests.ts` (cited by planning),
  `scripts/compaction/capture-presentation.ts` (recent, so ask its author),
  `tests/plugin-runtime/evidence/containment-probe-*.json` (rewritten by the spec), and
  `examples/plugins/weather-card` (blocked on planning task 6.5).

## 10. Docs and planning

- Finished, abandoned or contradictory planning folders to archive or delete:
  - `planning/complete/provider-decoupling/` (19 files whose statuses conflict)
  - `planning/plugin-host-bridge-retirement/` (finished; about 115 KB of patches)
  - `deployment-experience/`
  - `or3-mobile-runtime/` (0 of 80 tasks done; no Capacitor in the repo)
  - `workspace-tabs/implementation-notes.md` (78 KB)
  - the two duplicate wizard-UX folders
  - `v2-production-activation/` and `admin-auth-hardening/` (no task ever ticked)
  - `global-command-palette/`, `or3-cloud/admin-dashboard/`, `hook-system-v2/`,
    `component-review/`
  - dated `di-*`, review and investigation files
  - loose top-level notes (`snapshot-staging.md`, `streaming-markdown-cache.md`,
    `mixed-runtime-chat-tools.md`, `custom-plugin-icons.md`, `or3-tactics/`)
- `docs/planning/documentation-audit.md` and `duplicate-unused-code.md` are completed
  audits. `docs/README.md` links to their directory, and `check-docs` reads
  `docs/README.md`, so update the link along with them.
- Six `docs/` redirect stubs and two dated decision records. Deleting them only breaks
  external links.
- Fix rather than delete: `public/_documentation/cloud/background-execution.md:232-236`
  describes retired bridge files. Dangling links to planning folders that moved under
  `planning/complete/` appear in `AGENTS.md:14-17,116-118,211`,
  `app/core/sync/index.ts:8`, `shared/cloud/wizard/{catalog,index,types}.ts`, the
  skills, and `planning/unified-plugin-extraction/tasks.md:16-17`.
