# Migration dry-run and forward-repair runbook

Use a copy of the production database or export for every dry run. Never test a
repair command first against the only copy of user data.

## Required verification sequence

1. Record table counts, active workspace counts, and migration/version markers.
2. Run the migration against the copy and capture changed-row counts.
3. Run the same migration command again. The second run must either report no
   pending migration or produce the same normalized values without new rows.
4. Run the relevant contract suite and compare materialized row/tombstone,
   reservation, and transfer counts with the pre-run inventory.
5. If validation fails, keep the migrated copy isolated and use the forward
   repair below. Do not restore an older schema over writes produced by a newer
   application version.

## Dexie v13 transfer leases

- Dry run: open an exported/copy v12 database with `Or3DB`, then inspect every
  `running` and `queued` transfer.
- Repeat evidence: reopening the v13 database leaves `attempts`, `retry_at`,
  `lease_owner`, and `lease_expires_at` unchanged.
- Forward repair: set an invalid running lease to `lease_owner: ''` and
  `lease_expires_at: 0`. The normal transactional claim path will recover it;
  do not delete the transfer row.

## SQLite snapshot revisions and upload intents

- Dry run: copy the SQLite file, run `runMigrations`, and compare live rows,
  tombstones, server versions, and active reservation bytes before/after.
- Repeat evidence: Kysely's migration ledger makes the second
  `runMigrations` call a no-op. Snapshot backfill IDs are derived from exact
  matching change-log revisions and therefore remain stable.
- Forward repair: repair snapshot revision metadata only when the exact
  materialized row/tombstone and change-log operation agree. Expire overdue
  upload reservations in bounded batches; never mark an intent committed from
  object existence alone.

## Convex legacy tombstones

- Dry run: invoke the bounded internal `repairLegacyTombstones` mutation against
  a copied/staging deployment and record `scanned`, `repaired`, `ambiguous`, and
  `unresolved` counts.
- Repeat evidence: repaired tombstones are skipped on subsequent runs and the
  cursor is safe to replay.
- Forward repair: populate HLC, operation ID, server version, and server delete
  time only from an exact matching delete-log entry. Ambiguous equal-clock
  tombstones stay surfaced and ineligible for destructive retention.

## Derived file references and canonical chat transcript

- Dry run: compute `file_meta.ref_count` from canonical message/post edges and
  project legacy chat/tool records into canonical turns without writing.
- Repeat evidence: identical edges and stable message/tool-call IDs produce the
  same counts and transcript upserts.
- Forward repair: replace invalid derived counts only after a complete canonical
  scan. Preserve ambiguous legacy chat records as readable, mark interrupted
  pending generations explicitly, and rebuild UI/provider projections from the
  canonical transcript rather than deleting source records.

## Evidence registry

The machine-checked registry lives in
`shared/testing/contracts/migrations.ts`. Provider migration tests and the
shared contract-harness suite must remain green before release.
