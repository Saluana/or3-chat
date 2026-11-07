# Implementation progress receipt

Updated 2026-11-07. **74/74 implementation tasks complete.** All stages A–E have the development qualification required by [tasks.md](tasks.md). Final Debian checks passed certified live-generation backup/restore/restart and distinct compiled-image update/rollback, with independent payload hashes, canonical references, accounting, sign-in and cleanup refusal. Cleanup remains default-disabled and explicitly scoped. Nothing was published or deployed to production.

The earlier entries below are chronological evidence. Their then-current blockers are superseded by the later follow-ups where explicit passing receipts are recorded.

Follow-up: filesystem cleanup now composes durable claims, exact removal and accounting completion with bounded passes and retry. Nine Mac integration tests use the real SQLite coordinator and a simulated physical remover, including closing/reopening SQLite after interruption. The default-disabled generation gateway exposes the cleanup entry point, and the host provides qualified-provider-gated confirmation, audited execution, per-batch progress, retry and history links. Automatic cleanup is wired into a host maintenance plugin via `OR3_STORAGE_RETENTION_WORKSPACES`: explicit workspace scope, seven-day retention, 25-generation batches, hourly cadence, non-overlap and shutdown waiting. The production providers intentionally do not advertise cleanup until their installed lifecycle gate passes. The real filesystem lane still refuses macOS because descriptor-pinned directory access is unavailable; Docker's engine is unavailable. No production deletion has been enabled.

Linux follow-up: a checksum-verified snapshot of the current development sources was tested on Debian 13.6 x86-64. The filesystem/SQLite integration suite passed 51 tests, filesystem generation/transfer tests passed 62, SQLite generation/upload tests passed 87, host generation coordination passed 37, and host cleanup/retention passed 7. SQLite tests used Node 24.22.1; the snapshot test configuration required local Zod alias adjustments. Logs and the snapshot are on the VPS at `/home/brendon/.t3/scratch/linux-snapshot-test-20261106/`. These are source-snapshot tests, not the installed-artifact update, backup, rollback and restart lifecycle required to enable cleanup.

Installed-artifact follow-up on Linux: an unpublished local FS/SQLite pairing passed real-file deletion and accounting replay, plus controlled process-kill recovery after claim, physical deletion and completion. A live-generation copy/restore retained the blob hash but failed closed with `payload directory substituted` because the restored directory's device/inode changed. Concurrent claims produced one success and one `SQLITE_BUSY`; retry returned `claim_conflict`. Backup/restore of an already-deleted generation passed but does not prove live-generation recovery. The managed lifecycle and installed admin/scheduler paths remain unqualified. The disposable harness and logs are on the VPS under `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-05142f0b/` and the installed smoke under `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-c45df7d1/`.

Restore investigation: the managed archive's actual tar extraction commands reproduced the changed inode with the installed artifacts. Verified reads, publication replay, inspection and reclamation all refused the restored live payload even though its SHA-256 matched; a claim and charge remained intact. This did not exercise the full managed CLI. A held SQLite writer also caused `SQLITE_BUSY`, and a later manual retry completed safely; the admin path surfaces the error and the scheduler can revisit the page later. Reproduction evidence is on the VPS under `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-6bcde19e/`. A subsequent regression-test task was rejected by automatic cybersecurity review; no fix or passing restore regression is claimed.

Baseline: `or3-chat` `827da946`, `or3-provider-sqlite` `9dababf`; see [baseline.md](baseline.md). Existing edits were preserved. Changes remain uncommitted in `or3-chat`, `or3-provider-sqlite`, `or3-provider-fs` and `or3-provider-s3`. No release, live Stripe change, cleanup run or production operation occurred.

## Completed in this continuation

- Capacity warning/critical thresholds, existing upload-policy controls and resource-policy grouping. Resolved consumer values, supported application boundaries and hosted personal-key policy are explicit. Empty/hidden credentials are not evidence of a valid key.
- Completed server sync observations, stored by SQLite migration 032. Contact, completed operation and classified failure remain separate; diagnostic failure preserves the owning request's result.
- Independent bounded provider probes, stale/unknown states and process-local background recovery observations. The fixed read-only operator recovery projection marks unverified backup components unknown and gives manual guidance when unavailable.
- Bounded managed-generation candidate inspection with exact identities, shared canonical eligibility proof, pagination and no claim, deletion or accounting mutation. Legacy mutable objects remain excluded.
- Billing schema v4: accepted historical/retired offers, cohort allowances, frozen existing trial deadlines, current-offer Checkout attempts and review holds for ambiguous/unknown prices. The management implementation includes validation, preview, revision checks and atomic audit, and is now enabled after the real Stripe API and HTTP/browser gates passed. Explicit validation/preview/reason/revision checks still apply; no live price was changed.
- Current-cohort allowance changes require preview/reason and commit their audit record atomically. Failure rolls back settings and revisions. Browser verification independently reads the persisted audit in a separate process.
- Public documentation/docmap, provider READMEs, [reclamation qualification](reclamation-qualification.md) and [rollout/recovery notes](rollout.md).

## Verification

The current Mac cleanup follow-up receipt is [mac-cleanup/receipt.json](../../output/admin-customer-operations/mac-cleanup/receipt.json), with a Chromium trace, desktop progress screenshot and mobile confirmation screenshot. It records 9 real-SQLite orchestration tests, 29 transport/default-disabled checks, 16 host HTTP/pairing/scheduler checks, the disposable browser scenario, both relevant typechecks, both builds and changed-production-file lint. Browser cleanup results are explicit UI fixtures; real HTTP checks prove unauthenticated/forged requests and an unqualified provider cannot start deletion. It does not claim physical filesystem qualification.

Saved logs, 35 screenshots, three Playwright traces, audit attachments, provider provenance and the local provider tarball are in [`output/admin-customer-operations/final-installed/`](../../output/admin-customer-operations/final-installed/). The original machine-readable receipt is [`qualification.json`](../../output/admin-customer-operations/final-installed/qualification.json). The follow-up using recovered private configuration is [`network-qualified/qualification.json`](../../output/admin-customer-operations/network-qualified/qualification.json), with Stripe/Hippius receipts, 36 new screenshots, three browser traces and extracted audit receipts. Reports and decompressed traces passed a private-credential-value scan.

| Check | Result |
|---|---|
| Targeted core/config/auth/sync/admin tests | **162 pass, 21 files** |
| `bun run test:hosted-billing` | **74/74 pass**, including historical offers, support expiry, review races, audit rollback and current-cohort allowances |
| SQLite admin + generation + upload suites | **96/96 pass**; provider typecheck/build pass |
| Cloud operator security + backup CLI suites | **83 pass, 4 platform skips, 0 fail**; skips require cross-filesystem behavior unavailable on this macOS host |
| Host and hosted-billing typechecks | **0 errors** |
| Changed-file ESLint: host, SQLite, FS | **clean** |
| Clean installed-provider hosted admin E2E | **3/3 pass together**: inspection/privacy, support/pauses/audit/health/recovery, local accepted-offer reads and the qualified real Stripe offer-editor flow |
| Clean installed-provider private Cloud E2E | **6/6 pass**, without payment requirement |
| Clean hosted, private Cloud and static production builds | **pass**; optional server/billing boundary checks pass |
| Real Stripe sandbox API gate | **19/19 pass**, including current/historical/retired prices, frozen trials, renewals/refunds and unpaid authentication; test-clock fixtures removed and created price archived |
| Hippius installed S3/SQLite pairing | **10/10 pass**, including unversioned refusal before publication; standalone conditional/versioning protocol probe also passes; all disposable buckets removed |
| FS generation-lane typecheck | **pass**; physical execution remains unqualified on macOS |
| 50,000-user installed-provider directory probe | **pass**: 20 pages, 1,000 distinct users, 50-row bounds, **3.78 ms**; index-only ordering with no temporary sort |

The directory probe originally measured 118.65 ms and a temporary sort. Migration 032 adds the measured `(created_at DESC, id DESC)` index; the installed local artifact uses that index. Reproduce with `OR3_SQLITE_ARTIFACT_ROOT=<installed-package-path> bunx tsx scripts/test/qualify-admin-directory.ts` (writes `output/admin-customer-operations/directory-scale.json`).

Browser screenshots cover the six planned screens plus Activity at 1440px and 390px in light/dark media, with horizontal overflow assertions. Supplemental captures show resource policy, service pauses, provider checks and recovery guidance. Compared against all six saved mockups: the implementation retains the existing shell/components and visual hierarchy while using real USD $40/year terms, canonical IDs, measured counts and explicit unknown states.

A fixture cleanup fault was reproduced during the combined browser run: closing its direct SQLite writer removed a WAL file still open in the dev server. The fixture now retains that connection through the file's scenarios. The final combined run passes, including the independent audit read; this did not require a production persistence change.

## Installed-artifact provenance and repeatability

The clean snapshot has its own fresh `bun install --frozen-lockfile`, its own billing-package Stripe 23.1.0 installation, no local `.env`, no sibling provider aliases, and an installed SQLite tarball. The SQLite artifact is **local and unpublished**, still carrying development version 0.0.27; its SHA-256 is recorded. This is not qualification of an immutable npm release. FS 0.0.16 and Basic Auth 0.0.19 are installed artifacts. Exact paths/versions, source base SHAs and working-tree digests are in the receipt.

From the clean snapshot, the relevant harness commands are:

```sh
OR3_TRUST_PROXY=false bun scripts/test/run-workspace-cloud-e2e.ts --billing --grep 'admin customer|operational pauses|accepted offers'
OR3_TRUST_PROXY=false bun scripts/test/run-workspace-cloud-e2e.ts
OR3_TRUST_PROXY=false bun scripts/test/run-workspace-cloud-e2e.ts --billing --build
OR3_TRUST_PROXY=false bun scripts/test/run-workspace-cloud-e2e.ts --build
bun run generate:static
```

The runner removes its temporary databases after each run. The general `--build` path now supports the private Cloud profile as well as hosted billing. Existing source profile/stress evidence remains in earlier output folders.

## Remaining tasks and blockers

| Tasks | Required proof / prerequisite |
|---|---|
| **11.2, 11.6–11.7** | Linux source-snapshot filesystem/SQLite tests now pass, including interruption and replay cases. Independent installed-artifact physical bytes/hash/accounting receipts and the SQLite + filesystem crash/restart/backup/restore lifecycle remain outstanding. |
| **11.10–11.12** | Qualify the actual installed provider execution and update/backup/rollback/restart lifecycle. The gated admin workflow and opt-in host scheduler are implemented; production cleanup capability advertisement remains deliberately disabled. Legacy purge and expired-account purge remain unavailable. |

Docker Desktop is installed but its engine endpoint returns EOF, so no disposable Linux container could run on the Mac. The later VPS source-snapshot results are recorded above; they do not replace the installed lifecycle gate. No healthy deployment was stopped or recreated. Task 11.2 remains unchecked pending the required independent lifecycle receipts. A broader filesystem provider test run on macOS passed 132 tests and failed 41 where descriptor-pinned directory operations were unavailable; it is not a passing provider gate. The private configuration was subsequently recovered in place from the `hippius-storage` worktree. Neither credential file was copied into the development checkout or the reports. Both external-service gates now pass. Automatic scheduling and the dormant gateway bridge are now implemented. Activation requires the planned provider pairing and installed lifecycle qualification.

## Recovered configuration follow-up

The existing `hippius-storage` worktree contained `.env.billing-local` (Stripe test mode) and `.env.hippius-test` (Hippius S3). Reusing those private files removed the service-credential blockers. The standalone Stripe harness initially exposed an unresolved Nuxt alias and then exceeded Stripe's three-customer test-clock limit after adding the new-offer fixture. A relative core import restores standalone execution; reusing the expired-Checkout customer preserves both declined and authentication-required cases within the limit. All 19 real API checks pass afterward.

The browser harness now accepts its existing `--stripe-env` option for automated qualification as well as watch mode, refusing live keys. The real editor flow rejects mismatched cents, validates/previews/confirms the current offer, rejects a stale revision, retires the historical offer, preserves account facts and records both changes atomically. Independent read-only Stripe checks confirmed both API/UI fixture prices are archived and the original configured price remains active; see `stripe-price-cleanup.json` in the follow-up evidence. The hosted build, 74 billing tests, both typechecks and changed-file lint pass after removing the completed stage-E activation barrier.

The Hippius paired lane uses installed S3 0.0.15 and the recorded local SQLite tarball. Ten cases plus the standalone protocol probe pass. Only newly created fixture buckets are used, including a separate unversioned control. No existing storage bucket was selected for deletion. This does not replace Linux filesystem or managed backup/rollback/restart qualification.

## Known baseline limitations

- The original hosted-billing E2E (`trial, editable admin allowances…`) fails at its first trial status assertion: since `827da946`, a trial requires client network identity, while the source dev server reports `socket.remoteAddress = null`. The new admin scenarios deliberately seed diagnostic trial fixtures or use real support grants. The final receipt does **not** claim the entire original hosted E2E file passes.
- Bun loads the development checkout's `.env`, which sets `OR3_TRUST_PROXY=true`. Disposable runs explicitly override it to `false`; clean installation excludes `.env`.
- Full-project lint has existing generated `.nuxt-e2e-*` errors and an existing unsafe assignment in billing `trial.ts`; provider-wide lint has an existing escape warning in `sqlite-sync-gateway-adapter.test.ts`. All changed-file lint checks pass.

## Release dependency

New SQLite optional reads and migration 032 require a new unused provider version and an exact host pin. The current backup-inspection profile still names published SQLite 0.0.27 / FS 0.0.16; release engineering must update that profile/pins alongside new provider publication, and qualify the exact version under `docs/releasing.md`. The inspector accepts both the existing 31-migration published history and the new 32-migration candidate. Do not reuse an npm version or deploy this unpublished tarball as a released artifact.

## Offline generation restore repair — in verification

The managed restore and data-volume replacement update paths now authenticate the backup again and validate the restored generation namespace, canonical SQLite identities, payload hashes and remaining removal state before atomically rebinding directory identities. Runtime inode checks are unchanged. Local regression cases cover directory rebinding/replay, corrupt payload refusal, and partially removed claims; the pre-repair behavior failed the first two. CLI typecheck and build pass; the local restore/backup/lifecycle suites passed 80 tests with four existing cross-filesystem skips, and CLI security checks passed 45 tests. Installed Linux verification and the remaining Stage D gate are still pending; no task or capability is enabled by this change.

The installed Linux repair scenario passed inspection, verified read/open, publication replay and reclamation of a restored live payload, ending with zero charge. Its completeness review found missing readiness files could escape traversal. The repair now derives required permanent fences from canonical generation/upload records and refuses missing readiness files, slots or namespaces. All six focused local restore tests pass, and typecheck/build pass; the revised installed and full managed lifecycle checks remain pending.

Candidate host build: VPS frontend compilation was stopped under memory/swap pressure. A fresh Mac source snapshot with installed local FS/SQLite tarballs subsequently built the fixed Basic Auth/SQLite/filesystem profile successfully in 66 seconds. It includes Linux x64/arm64 SQLite prebuilds and the updated Cloud CLI. Build workspace: `/var/folders/1d/hmmp5gtj3pd8bwyqgpzbh5d00000gn/T/or3-linux-host-build-klq0bl9t`. FS tarball SHA-256 `c587e3db1b9a31c8223b1d5b769a224a54aa50829ee559891462cc755f31d2c2`; SQLite tarball SHA-256 `3f1cf3c785e83f1bef2590c80bae2f3bf46ff857283503639d180ea598563951`. This is an unpublished development build, not a release. Candidate-host Linux lifecycle qualification is still pending.

Tasks 11.2 and 11.6 are now checked: existing failure coverage has run on Linux, and installed artifacts have independently verified real bytes/hash/accounting, live-reference refusal, interrupted claim/delete/complete processes, and idempotent replay. This completes the coverage/implementation slices, not the activation gate. The candidate host subsequently passed managed backup/restore/restart with a 48-byte generation preserved; direct fixture wiring did not enable production generation admission. Evidence: VPS `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-45d3912e/REPORT.md`. Tasks 11.7, 11.10, 11.11 and 11.12 remain open for full pairing and admin/scheduler qualification plus candidate update/rollback.

Installed eligible cleanup and managed update/rollback: active upload and live-reference controls refused deletion; after real materialization/tombstoning, installed cleanup removed a 50-byte payload and reduced usage 166 → 116 bytes, with replay unchanged. A local synthetic version using the same candidate bits passed managed update and rollback, sign-in/deep health and retained/deleted-generation checks. This qualifies lifecycle mechanics, not an independently published release. Evidence: VPS `45d3912e/CONTINUATION-REPORT.md` workspace noted above. A separate qualification-only Nitro build now includes scoped installed-provider registration for real admin/scheduler execution; it is not in the user's source checkout or a release image.


## Browser and normal registration follow-up

The disposable installed-provider browser flow passed: preview showed two eligible/already-claimed generations, cleanup reported 25 examined / 2 completed / 0 blocked / 0 pending, and reinspection showed both deleted. Independent payload hashes matched before deletion; both payloads were absent afterward and usage fell from 237 to 116 bytes. VPS evidence: `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-6faad6c6/` (`02-review.png`, `03-progress.png`, `04-reinspection.png`, `after.txt`). Prior real retention callback evidence covers bounded batches, selected-workspace scope, audit and claim recovery. These receipts used disposable registration wiring.

The normal Linux adapters now have an explicit cleanup namespace opt-in and require SQLite FULL/EXTRA durability. Construction is lazy; normal uploads remain on the existing path. Managed environment validation accepts the namespace and retention workspace settings. A clean candidate host build without the disposable registration plugin passed. Its archive SHA-256 is `a220fb65a6a585a4f6c1033480861312644db98b942420afc7d1a0edec100fb3`; Debian verification is running against the normal installed registration. Tasks 11.7 and 11.10–11.12 remain open until those results are reviewed. No production deployment or package publication occurred.


## Normal installed registration verified

VPS report `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-1845f376/REPORT.md` verifies the normal providers without a replacement plugin: 88 SQLite generation/upload tests, 51 real FS/SQLite integration tests and four scheduler tests pass. FULL plus the existing namespace enables cleanup; unset configuration and NORMAL reject cleanup while preserving the target blob and charge. Real admin preview/cleanup/retry completed an eligible and a claimed generation; independent usage returned from 224 to 116 bytes. Managed backup/restore/restart preserved eligible and active-upload generations, with archive checksums and independent hashes. The actual scoped scheduler removed a separate eligible generation, preserved the active upload and restored usage to 116 bytes.

Task 11.11 is now complete using the cumulative scheduler evidence: the prior installed run verified bounded pagination and other-workspace preservation; the new run verifies normal registration. Browser acceptance with normal registration, a live-reference recovery check, and update/rollback using the new candidate are running as a finite final acceptance pass. Previous provider-level crash/admission evidence is reusable for unchanged implementation modules; it does not imply a published release gate.

The successful CLI backup applied retention and pruned one older disposable backup (`backup-2026-11-07T04-00-54-989Z-6a0ec57d`). Its test logs remain, as do the later prior backup and new backup. Further lifecycle checks preserve verified copies outside the retention directory. Production data and backups were untouched.


## Migration validation repaired

All seven reported migration-integrity failures reproduced on Mac. Their final failure was the leftover `sync_observations` table: rollback fixtures removed later ledger entries without reversing migration 032. The injected 029 index-name collision was an expected test step, not an additional production defect. Fixtures now reverse 032 before 031/030/029 and include 032 in the expected migration history.

Two new interruption boundaries, after 032 table and index creation, then reproduced a real startup-retry defect (2 failed / 10 passed before repair). Migration 032 now uses the existing `ensureMigrationSchema` helper to validate and reuse completed DDL. It rejects incompatible definitions and does not change released migration 029 or the resulting schema. After repair, migration/registration/snapshot/generation suites pass 111 tests with one Linux-only skip; admin-store coverage passes nine tests. Standalone provider typecheck and build pass. Logs: `/tmp/or3-migration-integrity-before.log`, `/tmp/or3-migration-integrity-regression.log`, `/tmp/or3-migration-integrity-fixed.log`, `/tmp/or3-sqlite-migration-admin.log`, `/tmp/or3-sqlite-migration-types.log`, `/tmp/or3-sqlite-migration-build.log`. A fresh candidate host build includes this repair; its final result is recorded in the next verification receipt.

The repaired candidate host build passed in 66 seconds. Archive: `/var/folders/1d/hmmp5gtj3pd8bwyqgpzbh5d00000gn/T/or3-migration-replay-transfer-bi4icwvl/candidate.tar.gz`; SHA-256 `6c205a93345bf7785117fa358ed7fb477279be8f1059b7a503750999e55fcabc`. It contains the repaired SQLite tarball, compiled host, unchanged filesystem tarball, CLI and regression receipts. Linux lifecycle checks on the previous normal-registration image continue independently; the only new runtime change is resumable migration 032.


## Normal-registration browser acceptance completed

Task 11.10 is complete. VPS `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-962434f4/REPORT.md` records real browser confirmation and execution in an isolated workspace. Two fresh eligible/claimed targets were deleted, the live reference remained blocked and accounting fell from 160 to 51 bytes. Authenticated retry completed zero and preserved the live file. Restart passed health, sign-in, installed open/hash/accounting and normal legacy HTTP upload/download. Independent-image update/rollback also preserved the live generation and absent deleted targets; the older host correctly lacked normal cleanup registration.

Current-image verified backup was blocked by its older inspector resolving all live metadata through legacy hash paths. The current checkout already contains the generation-aware inspector and its regression test; the tested bundle predates those changes. The updated bundle will include that repair, the resumable migration 032 fix, and the latest managed restore code. A fresh verified backup/restore remains required before completing 11.7/11.12. Existing backup copies and prior evidence are retained.

The repaired inspector was checked against the old transferred bundle: the same immutable-generation regression fails there with the original missing-payload error and passes in the current checkout. Local backup/restore checks passed 52 tests with four platform-dependent skips; CLI typecheck/build pass. Updated archive SHA-256 `51a2a4f7f023e4081ff5c482fa5eb4c86ddd34423488ba63ff72849aebb44ce6` includes the latest inspector/CLI, repaired migration 032 provider and compiled host. Debian verification is running against this exact archive.


## Final acceptance — 74/74

The final Debian receipt is `/home/brendon/.t3/scratch/2026-11-07-act-as-the-test-sub-8d975483/REPORT.md`. Exact archive SHA-256: `51a2a4f7f023e4081ff5c482fa5eb4c86ddd34423488ba63ff72849aebb44ce6`; installed candidate image: `sha256:0e99cda37c799871d2bcce45e18096b8f531585cc39058b2247d436b72450492`. SQLite tarball: `abc6a6a7eb730c2be44df25e5fc30e0b1905e11a476c557096c9441161ba91ae`; filesystem tarball: `ed3cbc64c9d49384bc5b1fc94326baa9a017c8aa5881460519fe7af1e51ae4c1`. All 66 transferred source files still match the current checkout.

Debian Node 24.22.1 migration/registration: 24/24 passed. Transferred Cloud backup/restore: 56/56 passed (including the four Mac platform skips). Prior relevant generation, admission, physical cleanup, process-kill, UI, audit and scoped scheduler checks remain in the cumulative receipts. Mac provider/CLI typechecks and builds and the fixed-profile host build passed. No introduced failure remains unresolved. Known unrelated baseline limitations remain listed above.

The repaired CLI produced a canonically certified ordinary backup, verified data/vault archive hashes, restored that backup and restarted. Independent installed-provider reads confirmed the live 51-byte generation SHA-256 `9a6c4708f7088c98aa975a57b68e734a1b4db9beaee7a6353342b448ae60aa11`, its nondeleted canonical reference and 51-byte charge; the two deleted targets remained absent. Health, customer/admin sign-in and live-file cleanup refusal passed. Task 11.7 is complete.

Actual update and rollback between distinct compiled fixture images also passed health/sign-in, installed read/hash, canonical accounting and refusal checks. The baseline image used the earlier compiled host with only the repaired inspector/profile and local fixture label; target used the new compiled host. Both compositions and hashes are recorded in the remote report. Local labels did not publish or consume immutable versions.

The delegated report called 11.12 partial because its brief additionally requested canonical certification of update safety snapshots. Final review of the actual task, repository policy, existing implementation, tests and operations guide confirms that this is not its contract: ordinary requested backups/restores require canonical completeness; update rollback snapshots deliberately preserve the exact previous state, including pre-existing missing files. They remain authenticated, checksum-verified and integrity-checked. The final snapshot was independently checked for live bytes, and successful rollback preserved them. No guarantee has been waived or changed; the stronger certification request in the testing brief was unnecessary. With the separate certified backup/restore and required update/rollback/restart checks all passing, 11.12 is complete.

The fixture is stopped. Verified backup copies, screenshots, commands, hashes and logs are retained; production services were untouched. Future publication must use new package versions, exact pins and the repository release/deployment gates. This implementation receipt does not authorize or claim that release.
