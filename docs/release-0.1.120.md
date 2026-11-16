# OR3 Cloud 0.1.120

Release preparation; candidate qualification and publication are pending.

Candidates 0.1.117–0.1.119 remained unpublished after qualification exposed legacy
verification, source-ledger and asynchronous browser-onboarding assumptions.
The disconnected owner's welcome is now qualified through its public dismissal
control before account access, with a retained full owner-journey trace.
This candidate verifies
the exact published 0.1.116 rollback image, whose migration history ends at 032,
with an explicit protection warning. Current and unknown images retain strict
history-incarnation checks.

| Component | Changed? | Notes |
| --- | --- | --- |
| `@or3/cloud` CLI | yes | Schema-2 recovery journal, immutable health-only update admission, history reset and immediate qualified legacy-snapshot rollback. |
| application image | yes | Sync poison containment, durable unavailable evidence, incarnation fencing, held-intent recovery, isolated browser storage, bounded retry/GC and maintenance. |
| generated assets (Compose/Caddy/operator) | yes | Managed update/recovery installs authenticated generated assets and uses the exact candidate validation container before opening admission. |
| dependencies / image rebuild | yes | Exact SQLite 0.0.31 and Convex 0.0.27; Basic inspection/reset binds the published SQLite runtime to migrations 001–036. FS 0.0.18 and S3 0.0.15 are unchanged. |

Fixes the 2026-11-14 malformed `op_id` sync jam: background tool-result writes
use UUIDs, the supported pre-033 startup repair tolerates malformed incident
payloads, and corrupt stored records are retained as evidence while healthy
siblings progress. The host/provider hardening covers write admission, checked
pull/snapshot coverage, replay intent, cursor/history fencing and saved-work
recovery. Convex requires the matching deployed 0.0.27 templates and initialized
history; installing the package alone does not upgrade backend functions.

This release changes browser storage and sync history identity. Managed rollback to the qualified 0.1.116 image restores the pre-update application snapshot, configuration and generated assets; it discards server changes made after that snapshot. The previous image runs with legacy sync behavior and is not incarnation-certified: old bundles can resume old pending changes without the new held-intent protection. A verified copy of abandoned live data is retained for an explicit rollback. Use this release's exact Cloud CLI for recovery and restart, even while the older application image is running.

Updates first start the candidate with user admission and background work disabled.
A health failure in that verified phase automatically restores the previous image
and snapshot. Once normal startup may have admitted work, failure leaves an explicit
recovery choice. `rollback --yes` or `recover --restore --yes` accepts loss of newer
server changes after preserving current data. Re-upgrade preserves the restored
server's changes and creates a new history identity; abandoned-history browser
work remains held for deliberate review.

Qualification is limited to the exact Basic Auth/SQLite/filesystem image and
allowlisted published 0.1.116 complete-032 source. Native image, browser downgrade
fence, failed validation, exposed recovery, rollback, re-upgrade and restart must
pass together before promotion. Clerk/SQLite/S3 and D1 service lifecycle are not
qualified by this release preparation. Vault custody and external storage retain
their documented limits.

Publication receipt: record the exact source commit, candidate workflow/receipt,
application and operator multi-architecture digests, CLI tarball hash, npm
integrity/shasum and clean-cache invocation after publication. Production deployment,
rollback ID and operator acceptance are separate pending evidence. See
[releasing](releasing.md) and [the recovery policy](cloud-updates.md).
