# Snapshot staging plan

## Goal

Reduce memory spikes during initial sync and rescans by staging snapshot pages in IndexedDB. Preserve atomic installation, unsynced local changes, and existing provider APIs.

**Current path:** `subscription-manager.ts` retains every page; `snapshot-applier.ts` adds validation arrays/sets before transactional installation. Rescans reapply pending operations afterward in a separate transaction. Close that crash window too.

## Implementation

- [ ] **1. Record a baseline.** Measure browser heap, long UI tasks, local-save latency, and sync time for small and large snapshots. Include long messages and pending local puts/deletes. Set comparison budgets before implementation; reduced memory alone does not prove smoother installation.

- [ ] **2. Add staging storage.** Add typed, local-only stores in the next Dexie schema version in `app/db/client.ts`: a run manifest, ordered records, and token tracking. Bind runs to workspace/scope, provider, requested tables, snapshot identity, watermark, and owner/generation. Index ordered reads and unique logical keys. Exclude staging from sync capture and backup/restore.

- [ ] **3. Stage each page.** Replace `pages.push()` with incremental validation and storage. Preserve scope, identity, watermark, ordering, duplicate/contradictory-key, payload-normalization, and token checks. Persist records and page progress together; release each page before fetching another. Keep growing token/key tracking on disk. Only a validated terminal page makes a run ready. Preserve empty snapshots and existing progress hooks.

- [ ] **4. Install atomically.** Read staged records in indexed batches bounded by count and payload size. Keep live-table replacement, tombstones, pending-operation protection, and watermark publication inside **one read/write transaction in the same database**, including staging and `pending_ops`. Reapply current unsynced puts/deletes before commit using existing rules; retain their queue entries. Coordinate outbox responses and other-tab recovery, and recheck ownership before publication. Preserve normalization, file metadata rules, hook suppression, and replay strictly after the watermark, including reconciliation after catch-up. Bound tombstone cleanup and pending-operation reads too. Await only database work during installation: no per-batch commits or timer/network waits.

- [ ] **5. Handle interruption and cleanup.** Invalid pages, quota failure, cancellation, or workspace/account changes must leave live data and cursor untouched. Clean completed/abandoned staging in bounded operations without deleting active runs. Restart interrupted downloads initially. Installation crashes must roll back; post-commit crashes must retain pending work and permit replay. Update sync-layer and schema documentation.

## Verification and completion

Extend existing snapshot-applier, subscription-manager, bootstrap, and recovery suites: page boundaries, empty replacement, schema upgrade, rollback/reopen, quota failure, scope switching, concurrent local edits/outbox responses, and competing tabs. Verify rows, tombstones, pending operations, and cursor.

Make `snapshot-bootstrap.perf.ts` generate pages lazily. Assert bounded application-owned buffers and compare real-browser memory/responsiveness; fake IndexedDB cannot establish browser heap behavior. Measure temporary disk usage and installation contention. Revisit installation if responsiveness budgets fail; preserve atomicity.

During implementation, run affected `core-app`/`app-integration` suites, `bun run sync:snapshot:benchmark`, typecheck, targeted lint, and build. Done when failure cases preserve data/cursors, payload buffers are bounded by a page plus a batch, staging is reclaimed, and responsiveness meets the budgets.
