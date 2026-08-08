# recordValidation

Tiny helper that validates a database record exists before a UI binds to it. It retries a few times to survive transient Dexie states (e.g. a closed database during startup).

## Purpose

`validateDbRecordWithRetry(options)` returns a `ValidationStatus`:

-   `'found'` — the record exists and is valid.
-   `'deleted'` — the record exists but is soft-deleted.
-   `'missing'` — the record was not found after all attempts.

Options:

```ts
{
    id: string;
    attempts?: number; // default 5
    delayMs?: number;  // default 50
    getRecord: (db, id) => Promise<T | undefined>;
    isValid: (record) => boolean;
    isDeleted: (record) => boolean;
}
```

## Usage

```ts
import { validateDbRecordWithRetry } from '~/composables/core/recordValidation';

const status = await validateDbRecordWithRetry({
    id: threadId,
    getRecord: (db, id) => db.threads.get(id),
    isValid: (thread) => thread.title !== undefined,
    isDeleted: (thread) => thread.deleted === true,
});

if (status === 'missing' || status === 'deleted') {
    await navigateTo('/');
}
```

## Notes

-   The database is opened if it is closed before retries begin.
-   Individual lookup errors are swallowed and retried.

## Related

-   `useValidatedEntityPageShell` — page-level wrapper that uses this pattern for route guards.
