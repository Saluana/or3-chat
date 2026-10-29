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
| `getWriteTxTableNames(db, primary, options?)` | Includes primary tables, existing optional related tables, and both `pending_ops` and `tombstones` by default when present. |

Entity timestamps generally use seconds. Sync scheduling fields such as `pending_ops.createdAt` and `nextAttemptAt` use milliseconds; do not convert every timestamp using one rule. Revision allocation should stay in the existing entity helpers rather than caller-written read/increment/write sequences.

## Database failure policies

Import `dbRequired`, `dbBestEffort`, and `DB_QUOTA_GUIDANCE` from `~/db/dbTry`. Each operation takes a function and tags including `op: 'read' | 'write'` and optional entity/action context.

```ts
import { getDb } from '~/db/client';
import { dbRequired } from '~/db/dbTry';

export async function countLocalThreads(): Promise<number> {
  const db = getDb();
  return dbRequired(() => db.threads.count(), { op: 'read', entity: 'threads', action: 'count' });
}
```

`dbRequired` reports and rethrows the original error; use it for saves and transaction-critical reads. It preserves legitimate undefined results from missing rows. `dbBestEffort` reports and suppresses errors, returning undefined, so use it only when a failed operation can safely be treated as unavailable. The compatibility API `dbTry` continues to suppress by default and accepts `{ rethrow: true }`.

Closed-database errors receive no toast. Quota failures are reported as `ERR_DB_QUOTA_EXCEEDED`; other failures use `ERR_DB_READ_FAILED` or `ERR_DB_WRITE_FAILED`. Reporting adds `domain: 'db'` and `rw` tags. These wrappers do not retry or reopen a database.

See [safe database changes](/documentation/database/safe-changes) for workspace and transaction rules, and [message files](/documentation/database/message-files#hash-serialization-and-limits) for file hash serialization.
