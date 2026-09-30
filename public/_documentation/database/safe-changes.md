# Make safe database changes

Use entity helpers for application writes. They coordinate schemas, hooks, revisions, deletion rules, and sync capture. Raw Dexie calls are appropriate for carefully scoped internal work, not a shortcut around those contracts.

## Workspace-safe operations

Resolve `getDb()` when an operation begins, not once at module load. The active workspace can change while the app remains mounted. The barrel's legacy `db` export is not a live workspace selector.

For a short UI action, normal entity helpers resolve the active database. For an operation that awaits a network call or spans a workspace switch, capture the database and use the corresponding `InDb` helper for the whole operation. Where the workflow should be cancelled on a switch, check its admission/revocation guard as well; a captured handle alone is not authorization.

```ts
import { getDb } from '~/db/client';
import { createDocumentInDb } from '~/db/documents';

export async function saveGeneratedNote(
  generateText: () => Promise<string>,
  assertCurrent: () => void,
): Promise<string> {
  const targetDb = getDb();
  const text = await generateText();
  assertCurrent();
  const document = await createDocumentInDb(targetDb, {
    title: 'Generated note',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  });
  return document.id;
}
```

The caller supplies a real guard for the admitted workspace/session. Do not re-resolve the destination after generation and accidentally save workspace A's work into workspace B. A closed or evicted handle can still fail; report that result instead of retrying in the currently active workspace.

## Transactions and hooks

Read/prepare data before entering a write transaction. Dexie transactions should not contain unrelated network requests or long UI waits. Use existing batch/entity helpers when available; their transaction rules are more specific than a generic example.

Internal writes that participate in sync must include capture tables in the same transaction. `getWriteTxTableNames(db, primary, options)` from `~/db/util` includes `pending_ops` when present; `includeTombstones: true` adds deletion history when present. Additional related tables belong in `include` or the primary list. Adding the tables alone does not validate a row or supply entity hooks/revision semantics.

Do not suppress remote-apply guards, overwrite outbox operation IDs, reset revision clocks, or sync derived fields. See [sync internals](/documentation/cloud/sync-layer). Sparse ordering is intentional; use message move/insert helpers rather than renumbering an entire thread after every edit.

## Errors must affect the outcome

`dbTry` reports errors and **swallows them by default**, returning undefined. An undefined result can mean a suppressed error or a legitimate missing record. When failure must roll back a transaction or fail a save, use `{ rethrow: true }` and let the caller handle it.

A closed-database error is quiet unless rethrow is requested. Quota failures receive storage guidance and are not automatically retryable. Do not clear workspace data as an automatic quota recovery step. Export a backup and let the user choose what to remove.

## Deletion and file ownership

Soft delete keeps a row; hard delete removes it and can be destructive. Relationship handling differs by helper: do not infer a cascade from the function name. For example, hard thread deletion removes its messages, whereas URL attachment deletion does not delete blobs.

Use [message-file helpers](/documentation/database/message-files) when attaching or removing message files. They reconcile references; decrementing again afterward is incorrect. A zero reference count does not automatically delete a blob. Counts are derived state, not a synchronized authority to garbage-collect data across devices.

`hardDeleteMany` in `~/db/files` removes metadata and blobs for the supplied hashes without checking live references. Callers must check ownership/reference policy first; it is not a safe automatic cleanup of arbitrary files. Soft deletion also has visible effects, so cleanup needs the application's existing policy.

## Schema changes and recovery

Only change indexes through a new Dexie schema version, with a transactional upgrade when existing rows need repair. Existing browser databases must migrate without deleting saved data or queues. Validate upgrades against representative old data before shipping.

Inspect the actual active database name in browser developer tools and export **Workspace Backup** before destructive recovery. A backup's replace mode removes current data; merge has different semantics. Keep local records, binary blobs, and sync/transfer state distinct when assessing recovery.

See [client/indexes](/documentation/database/client), [schema](/documentation/database/schema), and [validation/error utilities](/documentation/database/utilities).
