# Neckbead review — uncommitted `or3-chat` changes

Review date: 2026-07-31

The findings below are ordered by severity. Each item is a concrete defect or release blocker in the current tracked/untracked change set.

## [P0] Workspace owners can mutate deployment-global package state

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/promote.post.ts:38-58`, `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/rollback.post.ts:35-54`, `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/uninstall.post.ts:14-40`, `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-pointer-store.ts:182-195`

Evidence:

```ts
allowWorkspaceAdmin: true
```

The three routes then replace, roll back, or clear the pointer stored at the deployment-global `.active/<pluginId>.json` path. The API snapshots or disables only the requesting workspace before changing that global pointer.

Why this is bad: a workspace owner is being authorized to mutate state that is explicitly package-wide. The operation is not tenant-scoped, and the contract test at `/Users/brendon/Documents/or3/or3-chat/server/api/admin/__tests__/route-policy.contract.test.ts:44-69` currently locks in the wrong policy.

Consequence: an owner of workspace A can change or remove the package used by workspace B, without migrating or restoring B’s settings/state. This is a cross-tenant outage and state-integrity boundary failure.

Fix: make canary/promote/rollback/uninstall deployment-admin-only, or redesign package selection as workspace-scoped. Do not grant workspace-owner access to a global pointer mutation.

## [P1] Direct V2 route dispatch bypasses the runtime eligibility gates

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/[pluginId]/[...path].ts:209-252`; the gates it fails to reuse are in `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/runtime-manifest.get.ts:328-427`.

Evidence:

```ts
if (!v2Policy(session.workspace?.id).allowed) throw ...;
if (!(await getEnabledPlugins(...)).includes(pluginId)) throw ...;
requireCan(session, workspacePermission, ...);
const resolved = await serverModuleResolver.resolveHandler(...);
return await resolved.handler(event);
```

Why this is bad: the manifest path checks grant review, host compatibility, trust, dependency resolution, and the full package policy. The direct dispatcher checks only the rollout flag, workspace enablement, route permission, and ordinary plugin access before importing code.

Consequence: revoking a grant, disabling a required dependency, or making a package incompatible can make its descriptor `blocked` while the route remains executable through the direct SSR endpoint.

Fix: centralize a server-authoritative selected-package readiness check and call it before route resolution, asset reads, and handler import. The dispatcher and manifest must make the same decision.

## [P1] Legacy V2 archives still execute through the V1 dispatcher

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/[pluginId]/[...path].ts:94-137`, with the legacy archive explicitly marked blocked at `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/runtime-manifest.get.ts:248-259`.

Evidence:

```ts
const packageCatalog = v2Enabled
    ? await packageRouteCatalog.readSelected(pluginId)
    : { status: 'inactive' as const, pluginId };

// When the package is inactive, scan the legacy extension inventory.
const installed = await listInstalledExtensions();
const plugin = installed.find((entry) => entry.kind === 'plugin' && entry.id === pluginId);
```

The fallback never rejects `manifestVersion: 2` before resolving and importing `plugin.runtime.server.routes`.

Why this is bad: the V2 kill switch and immutable candidate/promotion boundary are bypassed whenever the package pointer is inactive, corrupt, or simply disabled by configuration.

Consequence: an old V2 archive can continue executing as if it were a legacy plugin, even though the runtime manifest reports `legacy-v2-reinstall-required`.

Fix: the legacy branch must accept only V1 manifests. A legacy V2 ID must return a stable blocked/404 response and must never enter the V1 resolver.

## [P1] V1 installation does not enforce exclusive V1/V2 plugin IDs

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/admin/extensions/install.post.ts:263-275,321-326` and `/Users/brendon/Documents/or3/or3-chat/server/admin/extensions/install.ts:396-399`.

Evidence:

```ts
// V2 preflight checks the legacy extension inventory.
const legacyConflict = (await listInstalledExtensions()).some(...);
...
const manifest = await installExtensionFromZip(...);
```

The V1 path checks only `extensions/plugins/<id>`. It does not check `.active` V2 pointers or candidate/previous package slots. The V2 path also has no shared cross-lane lock around its preflight.

Why this is bad: the documented identity contract says V1 and V2 cannot own the same ID, but only one direction is enforced.

Consequence: a V1 archive can be installed after a V2 package is promoted. Runtime manifest construction then writes both lanes into `runtime[id]`, and execution becomes dependent on which lane happens to be selected or enabled.

Fix: use one authoritative bidirectional ID check under a shared per-plugin lock, immediately before either lane publishes. Reject every current/candidate/previous V2 ownership conflict.

## [P1] Invalid V2 selections disappear instead of producing stable blocked descriptors

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-pointer-store.ts:408-415`, `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-route-catalog.ts:47-84`, `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/runtime-manifest.get.ts:127-130`.

Evidence:

```ts
if (!selection.selected) {
    return Object.freeze({ status: 'inactive', pluginId });
}
...
if (!parsed.success) {
    return Object.freeze({ status: 'inactive', pluginId });
}
```

Why this is bad: `readStartupSelection()` distinguishes `blocked` and records issues, but `readSelected()` throws that information away. The manifest then filters every non-`ready` catalog out. The declared `package-pointer-unavailable` and `package-manifest-invalid` block codes are consequently not emitted.

Consequence: clients and operators see an absent plugin rather than a recoverable reason. A bad selection can also trigger an all-or-nothing `Promise.all` failure in the catalog path during a read race.

Fix: preserve typed pointer/manifest failure reasons through the route catalog, catch failures per package, and emit one blocked entry per affected plugin with a stable recovery code.

## [P1] Required dependencies can be blocked while their dependents are advertised as ready

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/runtime-manifest.get.ts:262-283,284-365,368-413`.

Evidence:

```ts
const availableDependencies = selectedPackages.map(...);
const dependencyGraph = resolvePluginV2DependencyGraph(selectedPackages.map(...));
```

The graph is built from all globally selected packages before workspace enablement, grant review, access policy, compatibility, or trust checks. The `configured` check is applied only to the package currently being resolved.

Why this is bad: structural existence is being treated as runtime availability.

Consequence: plugin A can receive a ready descriptor and a dependency digest for plugin B even when B is disabled, grant-unreviewed, denied by policy, incompatible, or otherwise blocked in that workspace. The dispatcher also checks only A’s enablement.

Fix: resolve readiness bottom-up using the same workspace-specific gates. A required dependency that is not ready and enabled must recursively block its dependents and their routes.

## [P1] The “canary” validates package bytes, not executable server routes

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/canary.post.ts:41-63` and `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-promotion.ts:137-158`.

Evidence:

```ts
serverDryRun: async (dryRun) => {
    await packages.verifyStoredPackage(dryRun.pluginId, dryRun.packageDigest);
    return { status: 'passed' as const };
},
```

Why this is bad: immutable-tree verification proves that bytes match a digest. It does not import declared route modules, check that their exports are callable, or exercise the same resolver used by production dispatch.

Consequence: a missing handler, invalid JavaScript module, or non-function export can pass canary and promotion, then fail with HTTP 500 on the first real request.

Fix: preflight every declared server route through the production resolver/import/export checks in an isolated canary process. Add a malformed-handler promotion test.

## [P1] Promotion can publish a package that requires state migration without migrating it

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-promotion.ts:160-177` and `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/promote.post.ts:55-75`.

Evidence:

```ts
if (state.status === 'migration-required' || input.migrateState) {
    await input.migrateState?.({ from, to, snapshot });
}
```

The new promote route supplies no `migrateState` callback. `migration-required` therefore falls through as success, and the pointer is swapped.

Why this is bad: the state compatibility preflight detects that migration is required, then the operation treats the absent migration implementation as a no-op.

Consequence: an incompatible package can become current with old persisted state, causing data corruption or runtime failures after promotion.

Fix: reject `migration-required` unless an approved migration transaction is supplied and completes atomically before the pointer swap.

## [P1] Canary evidence is replayable across workspace/state changes

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-candidate-canary.ts:39-50,237-260` and `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-promotion.ts:137-158`.

Evidence:

```ts
return resolve(this.#evidenceRoot, pluginId, `${packageDigest}.json`);
```

Evidence records a pointer revision and state snapshot digest, but promotion validates only plugin ID, candidate digest, manifest digest, and blocked status. It never compares the recorded revision or snapshot with current state, and the evidence path contains no workspace ID.

Why this is bad: a canary is being treated as a timeless boolean for a package digest even though its inputs include mutable pointer and workspace state.

Consequence: evidence created for workspace A or an older pointer/state can authorize promotion from workspace B or after the candidate/state changed.

Fix: bind evidence to workspace ID, pointer revision, candidate digest, grant/config revisions, and exact state snapshot digest. Promotion must compare all of them and invalidate stale evidence.

## [P1] Rollback/restore merges settings instead of restoring the snapshot

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/promote.post.ts:66-73`, `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/rollback.post.ts:62-69`, `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/workspace-plugin-store.ts:188-207`.

Evidence:

```ts
const current = await getPluginSettings(store, workspaceId, pluginId);
const merged = { ...current, ...parsed.data };
await store.set(..., JSON.stringify(merged));
```

Why this is bad: restore uses the ordinary merge-oriented setter. It cannot remove keys that were introduced by a failed migration, and it cannot restore keys that the migration deleted.

Consequence: a failed promotion or rollback leaves workspace settings different from the captured snapshot.

Fix: add an exact replace operation for rollback/restore and test both added and deleted keys.

## [P1] Pointer write failure after rename can restore state while selecting the new package

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-pointer-store.ts:306-322` and `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-promotion.ts:200-208`.

Evidence:

```ts
await fs.rename(temporaryPath, targetPath);
await options.fault?.('after-rename');
await fsyncDirectory(this.#activeRoot);
```

The promotion catch restores workspace state and returns `pointer-write` failure for any error after `writePointerWithinOperation()` begins. The rename is already the new pointer at that point; the code does not reconcile or roll it back.

Why this is bad: the pointer swap is the commit point, but the error path treats all later failures as pre-commit.

Consequence: the API can report a failed promotion while the new package is selected and the old state has been restored, leaving code and state out of sync.

Fix: make post-rename failures a committed/reconcile path, or explicitly write the old pointer back before restoring state. Add promotion-level fault-injection tests, not only pointer-store restart tests.

## [P1] V2 ZIP staging bypasses unpacked-size and file-count limits for ignored entries

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/extensions/install.ts:265-305,312-327`.

Evidence:

```ts
if (prefix && !entryKey.startsWith(prefix)) return null;
...
if (!writeRel) {
    file.start();
    return;
}
```

Why this is bad: an archive prefix is used to identify the package root, but entries outside that prefix are decompressed without incrementing `fileCount` or `totalBytes`. A small ZIP can therefore contain a very large ignored payload.

Consequence: the owner-only upload path remains vulnerable to ZIP-bomb CPU/time pressure and decompression work beyond the advertised 2,000-file/200 MB limits.

Fix: count and cap every archive entry and decompressed byte before filtering what gets written, or reject archives containing entries outside the selected package prefix.

## [P1] The admin UI advertises a V2 lifecycle it cannot operate

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins-page.get.ts:45-59`, `/Users/brendon/Documents/or3/or3-chat/app/pages/admin/plugins.vue:247-253,289-294`, and `/Users/brendon/Documents/or3/or3-chat/server/api/admin/plugins/packages/[pluginId]/status.get.ts:27-43`.

Evidence:

```ts
plugins: extensions.filter(i => i.kind === 'plugin'),
```

The page API lists only legacy installed extensions. After upload, the UI displays “Run its canary, promote it, then activate it,” but it does not load package candidates or call status, canary, promote, rollback, or V2 uninstall endpoints.

Why this is bad: the new install result creates a package-store candidate while the page’s inventory and controls remain V1-only.

Consequence: a V2-only package is invisible in the product UI and cannot be activated, inspected, rolled back, or safely removed without manually constructing API calls.

Fix: return V2 package status in the page API, render candidate/current/blocked states, and wire the lifecycle actions and grant-review controls.

## [P1] Workspace owners see enabled upload controls that the install endpoint rejects

Location: `/Users/brendon/Documents/or3/or3-chat/app/pages/admin/plugins.vue:51-55,262-269` and `/Users/brendon/Documents/or3/or3-chat/server/api/admin/extensions/install.post.ts:152-156`.

Evidence:

```ts
const isOwner = computed(() => pageData.value?.role === 'owner');
...
:disabled="!isOwner"
```

The page API maps a workspace owner to `role: 'owner'`, but the install endpoint calls `requireAdminApiContext` without `allowWorkspaceAdmin: true`. The request therefore still requires a super admin.

Why this is bad: authorization advertised by the page and authorization enforced by the endpoint disagree.

Consequence: workspace owners can click Add from URL or Add from .zip and receive 403 responses, including for the new V2 workflow.

Fix: either hide/disable site-wide installation for workspace owners and expose a super-admin-only capability, or define and enforce a workspace-owner-safe package operation explicitly.

## [P1] The accepted server entrypoint can be reported ready but is never executed

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/extensions/types.ts:126-159` and `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/runtime-manifest.get.ts:431-455`.

Evidence:

```ts
if (!value.entry && value.routes.length === 0) { ... }
```

The schema accepts a server `entry` with zero routes, but the runtime descriptor stores only `serverRoutes`. The route catalog and dispatcher import only declared route handlers; no active V2 server manager imports the entrypoint.

Why this is bad: the validation contract accepts an executable form that the activation path does not implement.

Consequence: an entry-only server package can be promoted and reported ready/enabled while its server bootstrap code never runs.

Fix: reject entry-only server packages in the current supported profile, or add an explicit server bootstrap lifecycle and include the entrypoint in the descriptor.

## [P1] Runtime-manifest polling rehashes every selected package tree

Location: `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/runtime-manifest.get.ts:112-120`, `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-pointer-store.ts:372-386`, and `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-store.ts:146-163`.

Evidence:

```ts
packageCatalog.listSelected()
// readStartupSelection verifies current, candidate, and previous packages
// verifyStoredPackage -> verifyPackageTree(...)
```

Why this is bad: every workspace manifest request walks and hashes the bytes for every non-null pointer slot. This is independent of whether the package or pointer changed.

Consequence: manifest polling becomes O(total package bytes) per request. Several clients or large packages can turn a normal runtime poll into sustained disk/CPU pressure and high latency.

Fix: cache verified metadata by digest and pointer revision, invalidate it on package/pointer mutation, and reserve full re-verification for startup or explicit integrity checks.

## [P2] Package assets have no declared-client allowlist

Location: `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/package-assets.ts:103-163` and `/Users/brendon/Documents/or3/or3-chat/server/api/plugins/packages/[pluginId]/[digest]/[...path].get.ts:65-104`.

Evidence:

```ts
const relativePath = normalizePackageAssetPath(request.requestPath);
const assetPath = resolve(packageRoot, relativePath);
...
const bytes = await handle.readFile();
```

Why this is bad: authorization checks workspace access and selection, but the reader accepts any regular file in the selected package, including route modules, manifests, source maps, and server-only implementation files.

Consequence: any user with package access can download package internals that are not declared as browser assets. The new digest asset route makes this an exposed product boundary.

Fix: derive an allowlist from the declared client entry and explicit public assets. Deny server handlers, manifest/metadata files, source maps, and undeclared paths.

## [P2] File-upload failures escape the page without user feedback or cleanup

Location: `/Users/brendon/Documents/or3/or3-chat/app/pages/admin/plugins.vue:387-409` and `/Users/brendon/Documents/or3/or3-chat/app/composables/admin/useAdminExtensions.ts:62-67,95-112`.

Evidence:

```ts
async function installPlugin() {
    const installed = await install(...);
    // no try/catch, busy state, finally, or input reset
}
```

The composable throws blocked/API errors after converting the structured V2 response to an `Error`; the file-input handler does not catch them. The URL path has a catch/finally, but the file path does not.

Why this is bad: the primary upload interaction has a failure path that is invisible to the user and can race with another selection.

Consequence: blocked candidates, 403s, network failures, and repeated selection of the same file can leave the UI apparently idle with no toast or reset.

Fix: add an upload-in-progress state, disable controls, catch and display the parsed error, reset the input value, and clear state in `finally`.

## [P1] The documented production V2 flow has no built SSR release gate

Location: `/Users/brendon/Documents/or3/or3-chat/public/_documentation/plugins/runtime-v2-overview.md:9-14,46-54` and `/Users/brendon/Documents/or3/or3-chat/planning/v2-production-activation/tasks.md:93-109`.

Evidence: the public documentation now claims upload → canary → promotion → authorized SSR route execution, while the required built-server fixture and operational canary tasks remain unchecked. The existing promotion E2E at `/Users/brendon/Documents/or3/or3-chat/server/admin/plugins/__tests__/package-promotion-e2e.test.ts:131-206` injects mocks for the dry-run/import/resolver boundaries.

Why this is bad: unit tests of pointer and service classes are being used as evidence for a built Nuxt SSR lifecycle that is not actually exercised.

Consequence: auth, upload, workspace enablement, route dispatch, asset serving, rollback, and residual-denial regressions can ship while the documented production claim remains green.

Fix: add a built SSR fixture covering the complete lifecycle and run it in CI/release qualification before calling the server-only path production-supported.

## [P1] The new skills package fails its own documentation-drift gate

Location: `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/scripts/check-doc-drift.ts:11-16`, `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/tests/context-and-drift.test.ts:20-24`, and `/Users/brendon/Documents/or3/or3-chat/public/_documentation/plugins/runtime-v2-overview.md:9-14`.

Evidence:

```ts
text: 'not yet perform the immutable V2 candidate/promotion workflow'
```

That text was removed from the public document, which now describes the candidate/canary/promotion flow. `bun run check:drift` and the package test therefore fail on this checkout.

Why this is bad: the new package is committed in a state where its declared `test:all` command cannot pass.

Consequence: the skills package cannot qualify its own contract, and a fresh contributor receives a red validation gate immediately.

Fix: replace the obsolete sentinel with explicit checks for the supported server-only path and blocked client-entry path, then make `bun run test:all` pass.

## [P1] CI does not discover or run `@or3/skills`

Location: `/Users/brendon/Documents/or3/or3-chat/.github/workflows/tests.yml:7-29` and `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/package.json:11-17`.

Evidence: the workflow path filters contain `app/**`, `server/**`, `shared/**`, `tests/**`, and root scripts, but not `packages/or3-skills/**`. The package is not a root workspace and its `test:all` script is never invoked by the workflow.

Why this is bad: the new package is outside the repository’s normal discovery and validation lanes.

Consequence: package-only changes do not trigger CI, and the known failing drift gate can be merged without detection.

Fix: add `packages/or3-skills/**` to PR/push filters and run `bun run test:all` from that directory in CI.

## [P2] Skills guidance contradicts the newly documented server-only V2 path

Location: `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/README.md:36-42` and `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/skills/or3-plugin-development/SKILL.md:44-49`.

Evidence:

```md
The normal production workspace does not yet activate a V2 package end-to-end.
```

The public documentation now says promoted server-only V2 packages can serve authorized SSR routes, while client-entry packages remain blocked.

Why this is bad: the skill gives a single “V2 is unactivated” instruction for two different states that now have different support levels.

Consequence: skill-driven work can incorrectly report a supported server-only package as unactivated, or send operators away from the implemented lifecycle.

Fix: document the supported server-only SSR lifecycle separately from the still-blocked browser/client-entry lifecycle.

## [P2] The skills package claims portability while linking outside its package root

Location: `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/README.md:3-5` and `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills/architecture.md:36-37`.

Evidence:

```md
... can be extracted without changing their layout.
[`planning/skills_v1`](../../../planning/skills_v1/)
```

The relative link resolves only because the monorepo happens to contain `/Users/brendon/Documents/or3/planning/skills_v1`. Extracting `packages/or3-skills` removes that target, and `validate-skills.ts:128-135` does not reject links that escape the package root.

Why this is bad: the package’s portability claim and its validator disagree.

Consequence: the package validates in-tree but ships a broken link when extracted.

Fix: move the referenced material inside the package, link to a public stable URL, or make the validator reject external relative links and remove the portability claim.

## Verification

- `bun run validate` in `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills`: passed.
- `bun run eval` in `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills`: passed.
- Focused V2 server tests and changed admin/manifest tests: passed (37 tests, plus focused package/runtime suites).
- `bun run type-check` from `/Users/brendon/Documents/or3/or3-chat`: completed successfully after the sandbox IPC permission required elevation.
- `git diff --check`: passed.
- `bun run check:drift` and `bun test tests` in `/Users/brendon/Documents/or3/or3-chat/packages/or3-skills`: failed on `v2-activation-status-changed` as described above.
