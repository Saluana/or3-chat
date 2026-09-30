# Validation and error utilities

Entity helpers already use these internal utilities. Import them directly only when implementing a database operation that needs the same contracts.

## Validation, IDs, and revision helpers

Import from `~/db/util`:

| Helper | Behavior |
| --- | --- |
| `parseOrThrow(schema, data)` | Uses Zod safeParse and throws on invalid input. |
| `nowSec()` | Returns Unix time in seconds. |
| `newId()` | Runtime-compatible UUID-shaped record ID. Prefers secure browser UUID/random values; its last fallback is non-cryptographic. Do not use it as an auth token. |
| `nextClock(clock?)` | Returns `(clock ?? 0) + 1`; with no input it returns 1. |
| `getWriteTxTableNames(db, primary, options?)` | Includes primary tables, existing optional related tables, `pending_ops` by default, and `tombstones` when requested. |

Entity timestamps generally use seconds. Sync scheduling fields such as `pending_ops.createdAt` and `nextAttemptAt` use milliseconds; do not convert every timestamp using one rule. Revision allocation should stay in the existing entity helpers rather than caller-written read/increment/write sequences.

## dbTry

Import `dbTry` and `DB_QUOTA_GUIDANCE` from `~/db/dbTry`. The wrapper accepts a function, tags, and optional `{ rethrow: boolean }`. Tags include `op: 'read' | 'write'` plus entity/action context.

```ts
import { getDb } from '~/db/client';
import { dbTry } from '~/db/dbTry';

export async function countLocalThreads(): Promise<number> {
  const db = getDb();
  const count = await dbTry(
    () => db.threads.count(),
    { op: 'read', entity: 'threads', action: 'count' },
    { rethrow: true },
  );
  // dbTry's type permits undefined; do not label a missing result as success.
  if (count === undefined) throw new Error('Count unavailable');
  return count;
}
```

By default, errors are suppressed and the result is undefined. With `rethrow: true`, the original error is rethrown. Closed-database errors receive no toast, even when rethrown. Quota errors are reported as `ERR_DB_QUOTA_EXCEEDED` with recovery guidance; other errors become `ERR_DB_READ_FAILED` or `ERR_DB_WRITE_FAILED`. Reporting adds `domain: 'db'` and `rw` tags.

It does not retry, reopen a database, or supply transaction rollback when you swallow an error. Use rethrow where failure must fail a save or abort a transaction. A missing query record and a suppressed failure can both yield undefined, so choose the intended contract explicitly.

See [safe database changes](/documentation/database/safe-changes) for workspace and transaction rules, and [message files](/documentation/database/message-files#hash-serialization-and-limits) for file hash serialization.
