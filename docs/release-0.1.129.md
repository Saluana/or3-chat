# OR3 Cloud 0.1.129

Qualification pending. Supersedes 0.1.128, whose artifacts published but whose
post-publication dashboard check correctly caught an installed-bundle defect.

The installed lifecycle bundle now retains this release's qualified schema-2
writer when it runs outside npm without a package manifest. Unknown future state
schemas remain refused. Candidate qualification now probes the real installed
schema-2 lifecycle controller before tagging. Registry dashboard qualification
uses the declared compatibility bridge; deployments already on 0.1.127/0.1.128
must use the pinned 0.1.129 CLI because their old dashboard controller cannot
start an update after state reaches schema 2.

Includes the 0.1.128 pending-handoff repair, settings role-refresh preservation
and first-binding startup-write fix. Keep one full CLI run, exact tarball and
lifecycle checks, security scans, ARM and S3 parity. No provider versions change.

| Component | Changed? | Notes |
| --- | --- | --- |
| Cloud CLI | yes | Bundled writer capability and pending-handoff repair. |
| application image | yes | Version rebuild with the prior settings/first-binding repairs. |
| lifecycle asset | yes | Embedded schema-2 writer without an npm manifest. |
| Compose/Caddy/operator source | no | Existing mounts/protocol retained. |
| provider versions | no | SQLite 0.0.31, Convex 0.0.27, FS 0.0.18, S3 0.0.15. |

Use `npx --yes @or3/cloud@0.1.129 recover --dry-run` from the existing deployment.
Reconcile only a recorded handoff with `recover --finish`, wait until no handoff
is pending, run doctor, take a fresh authenticated backup, then run
`npx --yes @or3/cloud@0.1.129 update --to 0.1.129`. Preserve rollback material.
The 0.1.127 rollback policy remains unchanged; no provider/wire migration is added.
