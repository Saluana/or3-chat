# Implementation verification

Implemented on `feat/plugin-host-bridge-retirement`. Both sibling package directories were edited directly; their reviewable source patches, original-file hashes and application instructions are in `package-patches/`.

## Results

| Gate | Both plugins installed | Both absent, isolated clean checkout |
| --- | --- | --- |
| SDK build | Passed | Passed |
| SDK compatibility ledger/snapshots | Passed | Passed |
| Full host tests | 654 files; 5,562 passed, 1 skipped | 654 files; 5,562 passed, 1 skipped |
| Nuxt typecheck | Passed | Passed with fixed production profile |
| `check-imports` | Passed | Passed |
| `check:docs` | 109 files, 97 routes, 20 examples | Same, passed |
| Production build | Passed with the admitted runtime extension store | Passed with an empty extension store |
| Installed E2E | Five passed: Agents UI/disable/re-enable, saved credential upgrade, browser SDK records/storage, Workflows editor/routes/disable/re-enable, background HITL/result persistence | Not applicable |
| Additional SDK browser contracts | Mounted UI kit reacts to actual theme changes without remounting; multipart delivery, size/cancellation, record ownership/CAS/rollback, file references and workspace fencing | Same host capabilities tested directly |

External Agents: 16 files / 142 tests passed; typecheck, SDK validate, build and pack passed. Workflows: route tests, continuity tests (2 tests / 25 assertions), typecheck, SDK validate, build and pack passed. Both validations reported `conformant`, with no host aliases or private context properties. Source patches passed `git apply --check` against the original snapshots and their underlying source diffs passed whitespace checks. Stored patch files retain Git’s required blank context markers; host source whitespace checks exclude those artifact markers. The fixed-profile npm lock drift check passed; clean Bun installation used `--frozen-lockfile` and its own dependencies.

Builds use Basic Auth with managed registration, SQLite sync and filesystem storage. The clean checkout has no `.env`, ignored sibling source, shared `node_modules` or local-provider aliases. Existing production-build output conservatively labels trusted ModuleV2Loader UI qualification as rebuild-required; the actual installed package admission/browser canaries and development-host E2Es passed. This PR does not claim a new production release or production deployment qualification.

After coherent final repairs, affected checks are rerun rather than repeating every unrelated suite. The last configured-limit repair is additionally exercised by the real multipart/browser contract. Development flags are not allowed to choose the clean build/typecheck profile.

## Repeatable browser checks and artifacts

Use a disposable SSR host with the reviewed 0.2.0 packages enabled. Supply `OR3_AGENT_INSTALLED_TEST_EMAIL`, `OR3_AGENT_INSTALLED_TEST_PASSWORD`, `OR3_AGENT_INSTALLED_TEST_USERNAME` and the corresponding `OR3_WORKFLOW_INSTALLED_TEST_*` values. Set `PW_PORT` and `PW_SKIP_WEB_SERVER=true`, plus:

```sh
OR3_AGENT_INSTALLED_TEST_HARNESS=true \
OR3_WORKFLOW_INSTALLED_TEST_HARNESS=true \
OR3_WORKFLOW_NO_MODEL_SMOKE=true \
OR3_PLUGIN_HOST_RETIREMENT_HARNESS=true \
node node_modules/@playwright/test/cli.js test \
  tests/e2e/external-agent-visual.spec.ts \
  tests/e2e/workflows-installed.spec.ts \
  tests/e2e/plugin-host-upgrade.spec.ts \
  tests/e2e/plugin-host-retirement.spec.ts \
  --workers=1 --reporter=line --trace=on
```

The upgrade spec owns saved-host/PIN-vault migration at the installed boundary: one approval, unchanged encrypted bytes, authenticated requests with the existing token, verified removal of legacy keys and no repeated approval after reload. Normal PIN unlock remains required; the token is never re-entered.

The no-model workflow pauses for human input and uses the real Skip control to bypass its model node, then completes through the background job/HITL routes and survives reload. It makes no paid model call. This fixture produces no image; actual paid image generation was not exercised. The package retains raster MIME/byte checks and the six-image cap, while browser SDK contracts independently exercise attachment provenance, duplicate hashes and failed/stale reference release.

Artifacts are produced under `output/playwright/`. `baseline-summary.json`, `contracts.json`, `ui-kit.json` and `upgrade.json` preserve compact evidence in this plan folder; screenshots and Playwright traces remain local artifacts. `baseline.md` records the exact parity comparison.

## Repairs caught by verification

- PR compatibility CI exposed a bundled V1 test runtime missing its `onCleanup` method. The registration fixture now implements that method; all 31 compatibility files / 183 tests pass without weakening activation cleanup.
- Background job access now checks user, workspace, job kind and current membership before reads or mutation; authorization regressions failed before this repair.
- Sign-out removes both scoped secrets and leftover legacy vault bytes; the failing legacy-key regression passed after repair.
- Stale activation disposal releases unconsumed file references; the browser ref-count check failed before the repair.
- Post creation captures its database and rechecks activation authority across async hooks; a real workspace-switch fixture previously wrote into the wrong workspace and now refuses the write.
- Storage refuses non-finite/invalid JSON; settings use a bounded JSON record with safe own-key writes.
- The Workflows approval watcher initializes its icon before running immediately; the installed waiting-state fixture previously crashed and now stays usable.
- A host factory without Nuxt services now retains its configured multipart/file limits instead of replacing them with defaults.

## Simplification and test ownership

Removed all four client host files and the plugin-ID context augmentation, plus the server Workflows-specific service file. The staging protocol and its tests now belong to External Agents. Its transport uses `workspace.connections` directly; the optional raw-fetch compatibility branch was removed. Its persistence adapters use `connections` and `vault`; encryption verifier/AAD bytes remain unchanged.

The former test `scopes captured records and conditionally updates message data in one transaction` in `trusted-host-context.test.ts` was the sole remaining caller of `createScopedRecordStore` after the old bridge was removed. That helper and its fixture were deleted. The real-browser SDK contract retains its independent risks: clock/data conditional writes, batch rollback, record type ownership, captured-workspace fencing and reference release. Existing extraction history explains the old seam; no production caller remained. This also avoids adding a test-only export to preserve dead code.

The plan's persistence, UI and multipart checks run at the browser boundary instead of adding post-implementation unit tests. The existing integration suite still passes. Final source searches find none of `externalAgentHost`, `workflowHostIntegrations`, `preserveExternalAgentCredentials` or `setDestinationAuthorizer` in host/package runtime source. The plugin-ID gate permits only builtin profiles, deployment setting defaults and the temporary migration table.

## Pre-existing limitations

Repository-wide lint exhausts its 4 GiB heap on both the starting commit and this branch. This is recorded separately from introduced failures. Changed TypeScript source lint passes with zero errors; existing lint configuration excludes Vue/templates and tests. The passing typechecks, browser checks and final diff inspection cover those changed files. No lint rule or memory gate was weakened.

An unprofiled clean typecheck initially selected Clerk/Convex and correctly refused missing configuration; the fixed Basic Auth/SQLite/filesystem profile passed. Playwright is run with Node, since Bun's HTTP cookie handling rejects a relative response URL in the installed version.

## Release and migration retirement

Prepared versions: SDK 2.1.0; External Agents 0.2.0, state version 2 with rollback unsupported; Workflows 0.2.0, state version 1 retained. Exact npm queries returned 404 for all three on qualification, and no matching SDK 2.1.0 tag existed. Both private plugin manifests require SDK API ^2.1.0, host engine ^0.3.0 and their new trusted features.

Task 4.4 is a separate coordinated release after PR review, following `docs/releasing.md`: qualify an unused host version from its exact clean commit; publish/verify the SDK first if published, then the host, then distribute the rebuilt private plugin packages. No npm publication, immutable tag or production mutation was performed by this implementation PR.

Task 5.1 deliberately remains pending until that release and confirmation that known installs upgraded. Removing the copy/readback/delete migration earlier would discard the only upgrade path for saved hosts and credentials. Delete its loader call, tests and gate allowlist entry together when that condition is met.
