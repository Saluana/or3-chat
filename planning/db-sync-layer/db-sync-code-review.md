# DB Sync Code Review

1. **Verdict**
   High

2. **Executive summary**
   - Server-side `push` accepts payloads that can overwrite `workspace_id`, letting a member move data into other workspaces.
   - `push` writes `change_log` entries even for unknown tables, enabling log pollution and cursor drift.
   - Rescan staging bypasses payload normalization/validation, so `posts` can be restored with `post_type` instead of `postType` and other invalid shapes.
   - Pending ops replay during rescan is unordered, so the local overlay can diverge from LWW intent.

3. **Findings**

- **Workspace ID can be overwritten during sync updates**
  - Severity: High
  - Evidence: `convex/sync.ts:158-166`
    - `await ctx.db.patch(existing._id, { ...(payload ?? {}), clock: op.clock, updated_at: payloadUpdatedAt ?? nowSec() });`
  - Why: The server accepts client payload fields as-is, so a malicious client can include `workspace_id` to reassign a record into a workspace they do not control. This is a cross-tenant write and violates workspace scoping.
  - Fix: Strip `workspace_id` (and any tenant-scoped fields) from payloads before patching. Enforce `workspace_id` from the server only.
  - Tests: Add a Convex mutation test that pushes a payload containing a different `workspace_id` and asserts the stored record keeps the original workspace.

- **Unknown table ops still increment server version and pollute `change_log`**
  - Severity: High
  - Evidence: `convex/sync.ts:119-123` and `convex/sync.ts:284-299`
    - `if (!tableInfo) { console.warn(...); return; }`
    - `await ctx.db.insert('change_log', { table_name: op.table_name, ... });`
  - Why: `applyOpToTable` bails out, but `push` still inserts the op into `change_log`, allowing clients to spam unknown tables, advance cursors, and grow retention without affecting data tables.
  - Fix: Validate `op.table_name` against the allowlist before `getNextServerVersion`, and return a failed result for invalid tables without writing to `change_log`.
  - Tests: Add a Convex mutation test that pushes `table_name: "bogus"` and asserts the result is `success: false` with no change_log insert.

- **Rescan staging skips payload normalization and schema validation**
  - Severity: Medium
  - Evidence: `app/core/sync/subscription-manager.ts:380-386`
    - `const payload = (change.payload ?? {}) as Record<string, unknown>;`
    - `const record: StagedRecord = { ...payload, [pkField]: pk, clock: change.stamp.clock, hlc: change.stamp.hlc };`
  - Why: Rescan bypasses the normalization/validation logic used by `ConflictResolver` (e.g., `post_type` -> `postType`, schema checks). This can restore invalid rows and break clients after rescan.
  - Fix: Extract a shared `normalizeSyncPayload(tableName, payload)` that mirrors `ConflictResolver` logic (snake/camel conversion + schema validation) and use it in both paths.
  - Tests: Add a rescan test where a `posts` payload uses `post_type` and assert the staged dataset writes `postType` correctly.

- **Pending ops replay order is nondeterministic**
  - Severity: Medium
  - Evidence: `app/core/sync/subscription-manager.ts:255-74`
    - `const pendingOps = await this.db.pending_ops.where('status').equals('pending').toArray();`
    - `for (const op of pendingOps) { ... }`
  - Why: `toArray()` returns by primary key, not by `createdAt` or logical order. If multiple pending ops target the same record, replay order can invert LWW intent after a rescan.
  - Fix: Sort by `createdAt` and/or reuse the OutboxManager coalescing logic before reapplying pending ops.
  - Tests: Add a rescan test with two ops for the same record (put then delete) and assert replay yields the correct final state.

4. **Diffs and examples**

```ts
// convex/sync.ts
const sanitizedPayload = payload ? { ...payload } : undefined;
if (sanitizedPayload && 'workspace_id' in sanitizedPayload) {
    delete sanitizedPayload.workspace_id;
}

// use sanitizedPayload for patch/insert
await ctx.db.patch(existing._id, {
    ...(sanitizedPayload ?? {}),
    clock: op.clock,
    updated_at: payloadUpdatedAt ?? nowSec(),
});
```

```ts
// convex/sync.ts (inside push loop)
if (!TABLE_INDEX_MAP[op.table_name]) {
    results.push({ opId: op.op_id, success: false, error: 'Unknown table' });
    continue;
}
```

```ts
// app/core/sync/subscription-manager.ts
import { normalizeSyncPayload } from './sync-payload-normalizer';

const payload = normalizeSyncPayload(tableName, change.payload);
if (!payload) return;
const record: StagedRecord = {
    ...payload,
    [pkField]: pk,
    clock: change.stamp.clock,
    hlc: change.stamp.hlc,
};
```

```ts
// app/core/sync/subscription-manager.ts
const pendingOps = await this.db.pending_ops
    .where('status')
    .equals('pending')
    .sortBy('createdAt');

for (const op of coalesceOps(pendingOps)) {
    // apply in order
}
```

5. **Performance notes**
   - `workspaceDbCache` retains DB instances indefinitely (`app/db/client.ts:123-155`). If users switch workspaces frequently, memory usage will creep upward. Consider evicting and closing inactive DBs when the sync engine stops.

6. **Deletions**
   - None.

7. **Checklist for merge**
   - Add the tests listed above in the sync/Convex suites.
   - Verify `convex/sync.ts` strips `workspace_id` before patching.
   - Ensure invalid `table_name` ops are rejected without `change_log` inserts.
   - Run the sync unit/integration suite with `bun run test` (or the repo’s standard Vitest command).
