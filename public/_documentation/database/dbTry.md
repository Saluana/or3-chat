# dbTry

Thin error-handling wrapper around Dexie calls that surfaces quota issues and standardizes error metadata.

---

## What does it do?

-   Executes a provided function and traps IndexedDB quota exceptions.
-   Emits toast-friendly `ERR_DB_QUOTA_EXCEEDED` errors with guidance text.
-   Tags all other failures as `ERR_DB_READ_FAILED`/`ERR_DB_WRITE_FAILED` and forwards them to `reportError`.
-   Optionally rethrows after logging when `opts.rethrow` is true.

---

## API

```ts
dbTry<T>(fn: () => Promise<T> | T, tags: DbTryTags, opts?: { rethrow?: boolean }): Promise<T | undefined>
```

| Parameter      | Type                | Notes                                                          |
| -------------- | ------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `fn`           | `() => Promise<T>  | T`                                                             | Database action to execute.                 |
| `tags`         | `{ op: 'read'       | 'write'; entity?: string; ... }`                               | Required tags used for logging/diagnostics. |
| `opts.rethrow` | `boolean`           | When `true`, the original exception is rethrown after logging. |

Returns the function result (possibly `undefined` when suppressed) or `undefined` if an error was swallowed.

---

## Constants

-   `DB_QUOTA_GUIDANCE` — UI-friendly message instructing users to clear space when storage quota is exceeded.

---

## When to use

-   Wrap all Dexie reads/writes that could hit quota or data corruption.
-   Pair with `{ rethrow: true }` when the caller cannot recover (e.g., creation flows) so upstream can surface precise failures.

---

## Error tagging

-   Adds `domain: 'db'` and `rw: tags.op` so hooks/devtools can filter DB-related errors.
-   Quota failures set `retryable: false`; other failures remain retryable to allow user retriggering.
