# Reclamation inventory and failure gate

Scope: immutable generations explicitly enrolled by the trusted provider protocol. Existing mutable hash-only filesystem/S3 objects, legacy MD5 identities, uncertain references, incomplete ready manifests, and pre-ready allocations remain excluded. Linux filesystem cleanup has a qualified, explicit, default-disabled namespace opt-in. Normal installed registration and the managed lifecycle passed with the recorded candidate artifacts. The optional scoped scheduler uses the same batch operation.

## Canonical writers and barriers

| Writer | Owner | Barrier |
|---|---|---|
| Foreground sync push, file metadata materialization, restore/upsert and change-log append | SQLite `sync/sqlite-sync-gateway-adapter.ts` | Database triggers on INSERT/UPDATE/REPLACE of `s_messages`, `s_posts`, `s_file_meta`; exact managed storage identity and size required; claimed/deleted heads reject new references |
| Background chat materialization and generation-history recovery | SQLite `background-jobs/sqlite-provider.ts` | Same canonical table triggers, including raw SQL paths |
| Upload reservation, commit, expiry and retained quota | SQLite generation upload coordinator and migration 031 | Permanent generation/intent bindings, retention activity, atomic quota admission, no time-only release |
| Filesystem PUT/publication/download | FS `fs-generation-gateway.ts`, `fs-generations.ts` | Authenticated workspace/subject grants, descriptor-pinned immutable slot, independently rehashed publication receipt, permanent payload removal fence |
| S3 PUT/commit/download | S3 `s3-generation-gateway.ts`, `s3-generations.ts` | New namespace key, conditional create, versioning required, verified exact VersionId, permanent non-delete-marker fence |
| Restore of managed bytes | `reserveRestore` in the generation upload coordinator | Source identity and materialization proof; fresh quota reservation; cannot restore claimed/deleted generations |
| Workspace soft-delete/restore and ownership changes | Canonical auth/workspace store | No generation identity reset or accounting release; owner admission reads canonical ownership. Hard purge remains unsupported for enrolled generations |
| Tombstone/change-log GC | SQLite gateway | Managed activity and permanent generation guards survive history pruning; unknown or oversized references block proof |
| Backup restore/rollback | Managed CLI plus canonical backup inspector | Must preserve database and bytes/fences consistently. No runtime activation until an installed-artifact lifecycle receipt proves this pairing |

Direct canonical SQL is covered by guards validated against their exact expected trigger definitions. A missing/changed guard, unsafe SQLite durability, unsupported D1/Turso driver, or outer transaction refuses coordination.

## Failure matrix

| Interruption or race | Required outcome | Existing repeatable lane |
|---|---|---|
| Live metadata/message/post; malformed or oversized reference graph | Block claim; retain bytes and charge | SQLite generation coordinator tests |
| Active upload or retention not elapsed | Block; expiration alone never releases charge | SQLite generation upload tests |
| Claim then process death, delete then lost response, complete replay | Permanent barrier survives reopen; charge decreases once only after verified physical absence | SQLite + FS process integration / S3 paired integration |
| Delayed PUT or publisher after claim | Cannot republish the retired identity or recreate its payload | FS paused real publisher; S3 retained fence |
| Replacement generation, stale claim or wrong namespace | Old cleanup cannot select replacement bytes | Exact-generation provider tests |
| Partial filesystem unlink, unexpected entry, symlink/hardlink/traversal | Pending/refused; retain charge and permanent slot | FS generations tests (Linux required) |
| S3 delete marker, versioning disabled, unsupported conditional create, unknown VersionId | Refuse qualification; no release | S3 paired integration and disposable protocol probe |
| Two cleanup workers, retry after restart | Same durable claim; idempotent exact completion | FS process integration / S3 paired integration |
| Backup missing canonical state, fence, key escrow or billing sidecar | Unknown/invalid coverage; no activation or successful recovery claim | Backup inspector and managed lifecycle gate |
| Dry-run pagination/repetition | No generation state, byte or accounting mutation; bounded canonical scope | SQLite `inspectCandidates` test |

## Current gate evidence

- SQLite generation/upload coverage passed **88 tests** on Debian, including normal adapter opt-in, read-only candidate paging, live-reference controls, retention, irreversible claims, admission and once-only release. Real FS/SQLite integration passed **51 tests**; filesystem generation/transfer coverage passed **62 tests**.
- Installed provider process-kill checks passed after claim, physical deletion and accounting completion. Later module-hash comparison confirmed the generation/reclamation primitives remained identical while normal registration changed. Transient concurrent SQLite writer contention was recoverable on retry; it is not reported as immediate successful contention-free execution.
- Normal registered providers passed admin HTTP preview/cleanup/retry/audit and real browser confirmation/progress/reinspection in an isolated workspace. Two targets disappeared, their accounting was released once and the live reference remained blocked (VPS `962434f4/REPORT.md`, usage 160 → 51 bytes). Task 11.10 is complete.
- The actual retention callback passed physical execution, bounded pages, explicit workspace scope, preserved out-of-scope/live data and durable claim recovery. The callback was byte-identical across tested bundles; only its timer was accelerated in disposable tests. Host tests cover default-off, non-overlap, pending cursor retry and shutdown. Task 11.11 is complete.
- Managed restart and independently compiled-image update/rollback preserved live content/hash, canonical reference/accounting and absent deleted targets. Legacy HTTP upload/download also passed. The outdated live-generation inspector was repaired. The final exact bundle passed certified backup/restore/restart and distinct compiled-image update/rollback, preserving the live canonical reference, hash, charge and absent deleted targets. Prior backup copies are retained outside pruning scope. Tasks 11.7/11.12 are complete; update safety snapshots retain their documented authenticated/checksum-verified prior-state guarantee, separate from ordinary backup completeness certification.
- Migration 032 now resumes after interrupted table/index creation using the existing schema validator. Regressions failed before repair; Mac migration/registration/generation/admin checks passed 120 tests with one Linux-only skip. Provider type/build and full host build pass. Linux migration/registration validation passed 24 tests, and Cloud backup/restore passed 56 tests without platform skips. The final receipt is VPS `8d975483/REPORT.md`.
- Hippius passed the real protocol probe and **10 installed-provider tests** using disposable versioned/unversioned buckets, with exact-version deletion, races, stale uploads, retry fences, accounting and restore. No existing user bucket was targeted. Filesystem evidence is not reused for S3 qualification.
- Cleanup remains default-disabled and applies only to explicitly enrolled generations. Legacy-file and expired-account purge remain unavailable. No publication or production deployment occurred. Detailed cumulative receipts and exact VPS paths are in [progress.md](progress.md).
