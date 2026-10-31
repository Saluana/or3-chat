# SQLite delegation: stuck-drain review

Status: read-only diagnostics and a source follow-up to host 0.1.97 / SQLite provider 0.0.25. The restart-accounting follow-up below is not yet published. No database repair or data mutation is authorized by these diagnostics.

## Inspect without changing data

1. Cancel the waiting dashboard restart. Confirm that this is a native SQLite provider with migration `029_delegation_wait`; this query is not compatible with older SQLite providers or D1. Use the documented deployment backup procedure in `docs/cloud-updates.md` to obtain a consistent snapshot, including SQLite WAL state. Keep the snapshot protected: it contains private data and potentially encrypted credentials. Do not copy a live database file alone and assume it is consistent.
2. With a local, access-controlled copy of the database from that snapshot, run from the source checkout:

   ```sh
   sqlite3 -readonly -json "$OR3_SQLITE_SNAPSHOT" < planning/durable-chat-delegation/sqlite-drain-diagnostics.sql
   ```

   `OR3_SQLITE_SNAPSHOT` is the path to that database copy, not an archive or a directory. A missing file or unsupported schema must fail; do not create a database to make the query succeed. Results contain job identifiers and are private operational data. The query does not select prompts, results, credentials or raw checkpoint bytes.
3. The first 100 rows are a bounded snapshot of active jobs, pending history, waits and quarantined evidence. `missing_wait`, `invalid_json`, `invalid_wait`, `quarantined` and `unsupported_version` indicate states that need investigation; `wait_present` only means a superficially valid versioned wait was found. A pending history phase can have several causes, including temporary storage or authorization problems. None of these labels proves why work is blocked or that it is safe to discard. An empty result on a stale backup does not establish that the running server is clear; use its own restart accounting.
4. If the original writer's legitimate access was temporarily interrupted and can be restored through the existing authority, restore it and allow normal reconciliation; do not grant access solely to bypass authorization. On matching versions with the opt-in accounting below, restart can proceed once execution has stopped even while evidence remains unresolved. An unavailable or permanently deleted workspace and corrupt or unsupported evidence still have no automatic repair here. Preserve the backup and compatible provider version, and do not edit rows, remove evidence or roll back to an unaware worker.

## Persisted evidence does not require a running process

The host opts into `getShutdownBlockerCount({ allowPersistedDelegation: true })`.
Native SQLite excludes only chat jobs with a durable delegation-wait marker or
terminal delegation recovery state, and no live or indeterminate worker lease.
The controller still waits for tracked execution/reconciliation, active model
jobs and request draining. New work remains paused throughout preparation.

This changes only a read-only count. There is no new job state, migration,
manual hold operation, permission bypass, retention change or automatic repair.
Existing rows, raw quarantine bytes and child receipts remain in the same store.
After boot, existing authorization, fixed deadlines and replay fences still
apply. Restoring legitimate access allows normal delivery; permanent loss or
damaged evidence remains retained without making the server unrestartable.
Database/accounting failures still cancel restart preparation.

Older providers may ignore the optional argument. Native SQLite 0.0.25, D1 and
other providers without this support keep their conservative counts. The host
and updated provider must be delivered together to activate the new behavior.

Regression coverage extends the canonical provider suite for denied and
permanently removed access, missing waits, active/indeterminate leases and D1
fallback. The real host/provider integration pauses admission during preparation,
drains the saved wait, reopens SQLite and resumes only after returning to running.

Verification performed: the query ran read-only against a temporary database created by candidate migrations 001–029 and selected a pending job and a retained wait while excluding a settled job. A separate temporary fixture exercised malformed JSON, unsupported/missing waits, quarantined bytes and a missing database; it checked that raw evidence was not printed and the input database bytes were unchanged. This does not test an actual deployment or implement recovery.
