# OR3 Cloud 0.1.128

Release preparation. Publication and production verification remain pending.

Fixes completed dashboard updates whose operator handoff remains pending because
the helper cannot write its lease and receipt through a read-only deployment
mount. The helper gains write access only to `.or3-cloud`; configuration and
assets remain read-only. Use the exact corrected CLI to reconcile the recorded
handoff before a fresh backup and upgrade. Wait for recovery to report no pending
handoff; a running successor or succeeded job alone is insufficient.

Also preserves selected dashboard settings through a session role refresh and
preserves startup writes when a fresh browser first binds an existing workspace.
First-binding adoption happens only after successful snapshot commit with durable
local-only birth proof. Failed installs stay unbound; later history replacement
continues to reject stale writers.

| Component | Changed? | Notes |
| --- | --- | --- |
| `@or3/cloud` CLI | yes | Writable managed-state submount for operator handoff acknowledgement and accurate asynchronous recovery guidance. |
| application image | yes | Dashboard role-refresh preservation and proven first-binding startup-write repair. |
| generated assets (Compose/Caddy/operator) | no | Existing operator script works with the corrected helper mounts. |
| dependencies / image rebuild | yes | Images rebuilt from this source; provider versions remain SQLite 0.0.31, Convex 0.0.27, FS 0.0.18 and S3 0.0.15. |

Qualification must include the published 0.1.116 operator handoff, a matching
verified receipt, unchanged application/configuration/rollback state, idempotent
recovery, the Basic Auth/SQLite/filesystem update/backup/rollback lifecycle,
restart, browser checks, and both image architectures before tagging. Dashboard
qualification now requires a verified receipt and a reachable successor.

The 0.1.127 history-replacement and rollback policy remains in effect: a managed
rollback restores the recorded snapshot and discards newer server writes after
preserving current data. No provider migration or server/wire schema change is
introduced here. Keep existing backups and vault custody intact.

Record the exact source commit, workflow, npm integrity, application/operator
index digests and production verification in the release receipt after publication.
See [releasing](releasing.md) and [the update/recovery guide](cloud-updates.md).
