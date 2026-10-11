# Workspace isolation audit — synthetic local fixtures only

Base: `df1be2c8213477a9ee7c41c2cc0d4fb48b7f2cf5` (latest fetched `origin/or3-cloud`, 2026-10-11).
Branch: `audit/workspace-isolation-20261011`. Current source/test head: `e13346dffc066208c25035ca6c97bbe8eb3f1745`.
Nothing pushed, merged, deployed or released. PRs #234–#238 are already merged in this base. No dormant generation cleanup activation, approval bridge edits, document/editor persistence edits, PageShell.vue changes or ChatInputDropper.vue changes.

## Architecture and core-entry rationale

Existing host caches, UI asynchronous continuations and server dispatch own these boundaries. Configuration/themes cannot fence asynchronous ownership; plugins cannot invalidate host-owned URLs reliably; storage providers cannot invalidate browser caches. These changes stay at those existing boundaries. Optional clipboard ownership assertions preserve other callers; canonical read-only tools retain `workspace.read` defaults. GalleryGrid and ImageViewer share the preview singleton.

## Verified findings and source fixes

Every finding first failed a canonical regression assertion before its source fix. `reproduce.ts` repeats those assertions against the exact base in a disposable worktree, with current regression tests copied in and no source fixes. It rejects suite-setup failures as evidence. All databases, accounts, files, model messages and signing secrets are synthetic.

| Finding | Verified boundary and final behavior | Commit |
| --- | --- | --- |
| Cached/pending image previews outlive their workspace | Switching invalidates shared cached URLs and pending reads; stale viewer/grid successes and failures cannot publish; current-workspace reuse remains supported. | `9450ef8b0dfd6192c2d658ab0c6e0ff0c2b2cf84` |
| Multi-file upload crosses workspaces between completions | Retains original DB/generation; stops after switching, including A→B→A. An already committed first file stays in A; B remains untouched. | `9450ef8b0dfd6192c2d658ab0c6e0ff0c2b2cf84` |
| Demoted recovered jobs and tool-loop continuations dispatch another model request | Current originating-workspace write permission is required before dispatch and after awaited canonical ownership reads. Removed members also fail; viewer read-only history tools remain permitted. | `c462d1fb4a60f361a594ec652289b28f40d92345` |
| Detached completion hands former-account detail/action to another account | Fences both notification hook and service delivery before/after the mute lookup; preserves same-account cross-workspace notification behavior. Logout during the lookup also fences an initially authenticated delivery. | `8e712ce623681ee4996ccdb165cae897b98dd925`, `e13346dffc066208c25035ca6c97bbe8eb3f1745` |
| File selection arrives after its picker workspace changes | Picker captures owner when opened. Late selection is rejected; cancel/empty selection permit a fresh action. | `807df495e0e7f3c96cdf406f23b5f9b188c3cc08` |
| Download/clipboard deliver old-workspace bytes after awaited reads | Fences delivery after blob reads and PNG conversion; stale completion feedback is discarded. Same-workspace actions continue. | `918d4154342d3af36b55c496f07617ca26a9b6a3` |
| Palette lookup reopens a viewer after A→B→A | Captures workspace generation, rather than checking only DB identity after metadata lookup. | `918d4154342d3af36b55c496f07617ca26a9b6a3` |

`1df6fd07ac4fc9e23bb696c9745c9a5151591066` adds suspended canonical-read cases with membership removal, demotion and retained owner access. It changes tests only.

## Integration / changed-file ownership

Image ownership: `app/composables/core/usePreviewCache.ts`, `app/pages/images/{index,GalleryGrid,ImageViewer}.vue`, `copy-image-to-clipboard.ts`, their existing canonical tests, and `public/_documentation/database/files-select.md`.

Shared authorization commit `c462d1fb` changes `server/utils/chat/{canonical-history-context,project-policy}.ts`, `server/utils/background-jobs/{stream-handler,plugin-server-services}.ts` and existing tests. **Exact behavior:** background model/workflow dispatch explicitly requests originating-workspace `workspace.write`; project-policy authorization is repeated after canonical ownership reads. Default read-only tool authorization remains read permission. No approval bridge internals or broad tool-loop redesign.

Shared notification commits `8e712ce6` and `e13346df` change only `app/utils/chat/useAi-internal/backgroundJobNotifications.ts`, the existing reattachment/notification suite, and notification documentation. **Exact behavior:** outgoing completion detail/actions cannot be handed to a different current account, or to an identity cleared by logout during the mute lookup. Delivery starting with no available session keeps the existing tracker-scoped fallback contract.

Parent was informed of both shared areas and accepted their narrowly reproduced isolation checks. Public background/notification docs and docmap summaries describe the changed boundaries. Integration/auth harness source, DB files, transfer queue, document/editor saves and other workers' files were left untouched. A temporary Linux qualification wrapper adapts only temp paths, system Chromium and evidence destination; it removes itself and its disposable profile.

## Permissions and provider boundaries

No production access, real credentials, external scans, customer messaging, paid requests or publication. Network was used for repository fetch and Bun installation. Model calls in job tests are mocked fetch responses. Actual gallery browser tests deny non-loopback requests. Authenticated browser tests use loopback BasicAuth with disposable SQLite and filesystem stores, blank model keys and background streaming disabled; provider profiles are removed after testing.

Installed qualification: SQLite `0.0.15`, filesystem `0.0.11`; `authenticated-provider-browser/profile.json` records exact installed paths, successful exit and temporary-data removal. This browser receipt ran at `807df495` before the later gallery-only and logout refinements.

## Validation and reproduction

Use Bun 1.3.14; in this container `PATH=/workspace/.bun/bin:$PATH`.

- `bun audit-evidence/workspace-isolation-20261011/verify.ts`: **32 files / 514 tests passed** at `e13346df`; exact commit/command/status are in `final-verification.txt`. Includes job endpoint direct identifiers/SSE revocation, sync boundaries, filesystem signed-link lifetime, canonical ownership/tools, persistence/recovery, real Dexie gallery, sidebar/image/command-palette search, leases/refcounts and account notifications.
- `bun audit-evidence/workspace-isolation-20261011/reproduce.ts`: **24 failing assertions / 7 passing supported controls** against the frozen base, in `baseline-regressions.txt`; expected assertion failure exit is successful reproduction. Never checks out or changes the working source branch.
- `bun audit-evidence/workspace-isolation-20261011/authenticated-browser.ts`: **2 authenticated browser scenarios passed** in `authenticated-browser.txt`. Includes fresh-device canonical search and original bytes, viewer read/write distinction, direct stale-workspace snapshot 403, membership removal and denied download signing, local offline queue/reconnect.
- `bun run test:e2e:cloud --config=audit-evidence/workspace-isolation-20261011/playwright.config.ts`: **6 passed / 1 opt-in stress case skipped**; `browser-cloud-system-chromium.txt`.
- `bun run test:e2e:cloud:stress --config=audit-evidence/workspace-isolation-20261011/playwright.config.ts`: **4 passed**, including 64 workspace switches, intermittent adapter faults and circuit recovery; `browser-stress.txt`.
- Actual `/images` browser qualification: **5 scenarios have passing evidence**, with download and mocked-clipboard continuation cases in `gallery-browser-delivery.txt`, the two preview/recovery scenarios in `gallery-browser.txt` and the corrected chooser scenario in `gallery-browser-picker.txt`; command below; result and synthetic screenshots/traces are in `gallery-browser.txt` and `gallery-browser-artifacts/`. This adds real file chooser, IntersectionObserver previews, modal lifecycle, revoked object URLs, held preview reads and recovery, using Chromium IndexedDB. Initial harness failures (wrong Vite path, pre-hydration action, incorrect expected toast text) are setup evidence, not product defects.
- `bun run type-check` with the synthetic environment below: **passed** on the final source/test head `e13346df`; result is `typecheck.txt` (exit 0).
- Configured changed TypeScript source lint: `source-lint.txt`, exit 0; two preexisting optional-chain warnings. Repository ESLint intentionally excludes Vue and test files. Forced legacy notification-test lint exposes preexisting unsafe-any errors (`logout-notifications-lint.txt`); these unrelated existing lines were not rewritten. Vue is checked by typecheck and canonical/browser compilation.

```sh
PATH=/workspace/.bun/bin:$PATH \
SSR_AUTH_ENABLED=false OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false \
OR3_STORAGE_ENABLED=false OR3_CLOUD_STORAGE_ENABLED=false \
OR3_BACKGROUND_STREAMING_ENABLED=false PW_PORT=3121 \
bun x playwright test --config=audit-evidence/workspace-isolation-20261011/gallery-playwright.config.ts --reporter=line

PATH=/workspace/.bun/bin:$PATH AUTH_PROVIDER=basic-auth OR3_AUTH_PROVIDER=basic-auth \
OR3_BASIC_AUTH_JWT_SECRET=synthetic-typecheck-secret-20261011 \
OR3_SYNC_PROVIDER=sqlite SYNC_PROVIDER=sqlite OR3_STORAGE_PROVIDER=fs STORAGE_PROVIDER=fs \
OR3_SYNC_ENABLED=false OR3_CLOUD_SYNC_ENABLED=false OR3_STORAGE_ENABLED=false \
OR3_CLOUD_STORAGE_ENABLED=false OR3_BACKGROUND_STREAMING_ENABLED=false bun run type-check
```

Focused before/after logs preserve individual failing assertions. `verify.ts` lists the entire canonical coverage rather than claiming every repository test. Evidence runners never print credentials. Nuxt's dev harness sometimes leaves a lock referencing its own defunct process; only confirmed stale locks from these local runs were removed. That integration-harness issue was reported to its owner, without source changes.

## Deliverables

`workspace-isolation-source.patch` contains only the source/test/docs changes through `e13346df`. `workspace-isolation-source.bundle` carries the seven local commits as `HEAD`, with the exact base as a prerequisite. `git bundle verify` passed; SHA-256 checksums are in `artifact-checksums.txt`. These artifacts and browser traces stay local and are excluded from the evidence commit. They can be imported or reviewed without remote publication.

## Remaining limits and rollback

No live Convex/S3 qualification, paid model execution, production traffic, multi-replica load or external exploit scans. The explicit legacy Workflow SDK branch in `createOpenRouterClient` accepts no run origin and directly delegates fetch; its existing canonical compatibility test preserves that behavior. Origin-aware workflow dispatch is covered, but this audit does not remove or redefine the older-package contract. This limitation was reported for the integration owner. OS/browser clipboard writes already accepted before a workspace change cannot be recalled; subsequent writes and UI feedback are fenced. The preexisting no-session notification fallback remains intentional; this audit does not redefine guest/unavailable-session policy.

Dormant `useThreadSearch.ts` has a global legacy index without workspace fencing, but repository search found no active app/official plugin/SDK/documentation callers. Active sidebar search is a different guarded implementation and passes canonical tests. This is a latent-consumer risk, not a reproduced active product defect; no dormant helper or cleanup system was activated.

All changes are local reversible commits without migrations. To undo source/test changes, revert `e13346df`, `1df6fd07`, `918d4154`, `807df495`, `8e712ce6`, `c462d1fb`, then `9450ef8b` in reverse order. Baseline behavior and the passing supported-operation controls are available in the evidence. No remote publication was authorized or performed.
