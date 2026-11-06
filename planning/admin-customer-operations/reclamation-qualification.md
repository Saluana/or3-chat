# Reclamation inventory and failure gate

Scope: immutable generations explicitly enrolled by the trusted provider protocol. Existing mutable hash-only filesystem/S3 objects, legacy MD5 identities, uncertain references, incomplete ready manifests, and pre-ready allocations remain excluded. No runtime cleanup capability or scheduler is registered by this implementation.

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

- SQLite canonical generation/upload lane: **87 tests pass**, including read-only candidate pagination, live-reference control, retention, irreversible claims, admission and once-only release.
- FS pairing: test imports repaired to the actual sibling checkout. Node execution correctly refuses `bun:sqlite`; Bun execution reaches the Linux pinned-directory prerequisite and refuses on macOS. No pairing qualification is claimed.
- Docker Desktop's engine endpoint is unavailable (`docker --context desktop-linux version` returns EOF). No application deployment was stopped or recreated.
- Recovered Hippius configuration passed the standalone protocol probe and **10 installed-provider integration tests**: versioned publication, exact version deletion, conditional races, stale uploads, retry fences, canonical accounting/restore and refusal of an unversioned bucket before publication. All disposable buckets were removed. Pairing: S3 0.0.15 + the recorded local unpublished SQLite 0.0.27 tarball. Full installed backup/rollback/restart qualification remains outstanding; no runtime cleanup capability is advertised.
- Until installed-artifact filesystem and S3 lifecycle gates pass independently, destructive preview/confirmation and retention automation remain unavailable. Expired-account purge is not implemented or enabled.
