# util

Shared helpers for parsing with Zod, generating IDs, and producing Unix timestamps.

---

## What does it do?

-   Wraps `schema.safeParse` to throw readable errors when validation fails (`parseOrThrow`).
-   Exposes `nowSec()` for consistent second-based timestamps across modules.
-   Provides `newId()` that prefers `crypto.randomUUID()` with a safe fallback.

---

## API surface

| Function       | Signature                       | Description                                                           |
| -------------- | ------------------------------- | --------------------------------------------------------------------- |
| `parseOrThrow` | `(schema, data) => ZodInfer<T>` | Validates data against a Zod schema; throws on failure.               |
| `nowSec`       | `() => number`                  | Returns `Math.floor(Date.now() / 1000)`.                              |
| `newId`        | `() => string`                  | Generates a UUID v4 or timestamp-based ID when crypto is unavailable. |

---

## Usage tips

-   Always use `parseOrThrow` before writing to Dexie to catch client-side shape regressions early.
-   `nowSec()` keeps timestamps compact (seconds vs milliseconds); align any server sync logic accordingly.
-   The timestamp fallback in `newId()` keeps IDs unique even in legacy browsers—no extra seeding required.
