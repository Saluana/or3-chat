# kv

Key-value helpers for storing small preference or credential blobs in the Dexie `kv` table.

---

## What does it do?

-   Validates KV payloads with `KvCreateSchema`/`KvSchema`.
-   Wraps reads/writes in `dbTry` with detailed error tagging.
-   Integrates with the hook system for before/after actions and output filters.
-   Provides name-based helpers for common flows like OpenRouter token storage.

---

## Data shape

| Field        | Type     | Notes                                                        |
| ------------ | -------- | ------------------------------------------------------------ | ----------------------------------------- |
| `id`         | `string` | Primary key. Name-based helpers use `kv:${name}` convention. |
| `name`       | `string` | Logical key.                                                 |
| `value`      | `string  | null`                                                        | Serialized payload (often JSON or token). |
| `clock`      | `number` | Monotonic counter incremented on `setKvByName`.              |
| `created_at` | `number` | Unix seconds.                                                |
| `updated_at` | `number` | Unix seconds.                                                |

---

## API surface

| Function                   | Description                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- |
| `createKv(input)`          | Inserts a new KV row after filtering and validation.                             |
| `upsertKv(value)`          | Full-row upsert with before/after hooks.                                         |
| `hardDeleteKv(id)`         | Removes a row by primary key.                                                    |
| `getKv(id)`                | Fetches by primary key and applies output filters.                               |
| `getKvByName(name)`        | Finds first row matching `name`.                                                 |
| `setKvByName(name, value)` | Creates or updates a row using `kv:${name}` ids, increments `clock`, runs hooks. |
| `hardDeleteKvByName(name)` | Deletes by `name` with before/after hooks.                                       |

---

## Hooks

-   `db.kv.create:filter:input` / `db.kv.create:action:(before|after)`
-   `db.kv.upsert:filter:input`
-   `db.kv.get:filter:output` and `db.kv.getByName:filter:output`
-   `db.kv.upsertByName:filter:input` / `:action:after`
-   `db.kv.delete(:action:hard:* )` + `db.kv.deleteByName:action:hard:*`

---

## Usage tips

-   Store encrypted or user-provided tokens by name; `setKvByName` will generate IDs automatically.
-   Use hooks to redact values before logging or to enforce naming conventions.
-   Keep payloads tiny (<10 KB) to avoid IndexedDB quota pressure.
