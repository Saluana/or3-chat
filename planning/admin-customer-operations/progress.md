# Implementation progress receipt

Updated 2026-11-06. **68/74 tasks complete.** Stages A–C and E are implemented and locally qualified. Stage D has canonical barriers/accounting, read-only preview and real Hippius pairing evidence; runtime physical cleanup is unavailable pending the full lifecycle gate. Six qualification-dependent tasks remain unchecked in [tasks.md](tasks.md).

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
| **11.2, 11.6–11.7** | Independent physical bytes/hash/accounting receipts and installed SQLite + filesystem crash/restart/backup/restore lifecycle on Linux. Dormant code and canonical tests do not satisfy this gate. FS integration imports now resolve the actual sibling SQLite checkout; execution reaches the Linux descriptor-pinned-directory requirement and refuses macOS. |
| **11.10–11.12** | Qualified provider pairings above, then destructive UI, opt-in retention and the full installed update/backup/rollback/restart gate. No cleanup capability, scheduler, legacy purge or expired-account purge is registered. |

Docker Desktop is installed but its engine endpoint returns EOF, so no disposable Linux container could run. No healthy deployment was stopped or recreated. Task 11.2 is intentionally unchecked because authored lifecycle coverage has not produced the required physical receipts here. The private configuration was subsequently recovered in place from the `hippius-storage` worktree. Neither credential file was copied into the development checkout or the reports. Both external-service gates now pass; the remaining blocker is the full filesystem/installed lifecycle qualification.

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
