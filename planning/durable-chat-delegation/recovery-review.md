# SQLite delegation: stuck-drain review

Status: candidate-only investigation; this does not qualify production enablement or authorize a database change. The host and provider artifacts are still unreleased.

## Inspect without changing data

1. Cancel the waiting dashboard restart. Confirm that this is the candidate native SQLite provider with migration `029_delegation_wait`; this query is not compatible with older SQLite providers or D1. Use the documented deployment backup procedure in `docs/cloud-updates.md` to obtain a consistent snapshot, including SQLite WAL state. Keep the snapshot protected: it contains private data and potentially encrypted credentials. Do not copy a live database file alone and assume it is consistent.
2. With a local, access-controlled copy of the database from that snapshot, run from the source checkout:

   ```sh
   sqlite3 -readonly -json "$OR3_SQLITE_SNAPSHOT" < planning/durable-chat-delegation/sqlite-drain-diagnostics.sql
   ```

   `OR3_SQLITE_SNAPSHOT` is the path to that database copy, not an archive or a directory. A missing file or unsupported schema must fail; do not create a database to make the query succeed. Results contain job identifiers and are private operational data. The query does not select prompts, results, credentials or raw checkpoint bytes.
3. The first 100 rows are a bounded snapshot of active jobs, pending history, waits and quarantined evidence. `missing_wait`, `invalid_json`, `invalid_wait`, `quarantined` and `unsupported_version` indicate states that need investigation; `wait_present` only means a superficially valid versioned wait was found. A pending history phase can have several causes, including temporary storage or authorization problems. None of these labels proves why work is blocked or that it is safe to discard. An empty result on a stale backup does not establish that the running server is clear; use its own restart accounting.
4. If the original writer's legitimate access was temporarily interrupted and can be restored through the existing authority, restore it and allow normal reconciliation; do not grant access solely to bypass authorization. Retry the dashboard restart only after normal accounting drains. An unavailable or permanently deleted workspace and corrupt or unsupported evidence have no qualified automatic recovery here. Preserve the backup and candidate version, and do not edit rows, remove evidence or roll back to an unaware worker.

## Decision needed for permanent loss

The design currently requires both retaining unresolved history/evidence and counting it as a drain blocker. When current authorization cannot ever be restored, those requirements have no automatic route to a safe drain. A backup alone does not make it safe to clear the blocker, nor does it authorize delivering data to another user.

One possible change for review is an explicit **offline evidence hold** operation: after normal workers have been stopped under the supported maintenance procedure, identify one parent and its linked children, verify a restorable protected snapshot, and atomically mark that exact group as held so no worker can claim, deliver, replay, or prune it. A later authorized repair would operate on the retained evidence; the operation would exclude only that held group from restart accounting and would record who approved it and why. It would need a bounded, verifiable selection, race/fencing checks, preserved raw evidence and credentials, repeatable crash recovery, and tests for old-worker rollback and cross-workspace isolation. It must not manufacture a completion or change workspace access. This changes the current drain-accounting invariant and introduces a new retained state; it is a proposal, not implemented or approved. It also leaves evidence retention and an eventual authorized repair policy to be designed.

The alternative is to retain the current invariant: the dashboard restart stays blocked until authorized recovery is possible, and the feature remains unqualified for production when recovery is impossible. Restoring an older deployment snapshot is a separate destructive operation that can discard newer writes; follow the documented backup/restore process and obtain the required approval rather than treating it as an automatic fix.

Verification performed: the query ran read-only against a temporary database created by candidate migrations 001–029 and selected a pending job and a retained wait while excluding a settled job. A separate temporary fixture exercised malformed JSON, unsupported/missing waits, quarantined bytes and a missing database; it checked that raw evidence was not printed and the input database bytes were unchanged. This does not test an actual deployment or implement recovery.
