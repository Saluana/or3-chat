# util

Shared helpers for parsing with Zod, generating IDs, and producing Unix timestamps.

---

## What does it do?

-   Wraps `schema.safeParse` to throw readable errors when validation fails (`parseOrThrow`).
-   Exposes `nowSec()` for consistent second-based timestamps across modules.
-   Provides `newId()` through the shared runtime-compatible UUID generator.

---

## API surface

| Function       | Signature                       | Description                                                           |
| -------------- | ------------------------------- | --------------------------------------------------------------------- |
| `parseOrThrow` | `(schema, data) => ZodInfer<T>` | Validates data against a Zod schema; throws on failure.               |
| `nowSec`       | `() => number`                  | Returns `Math.floor(Date.now() / 1000)`.                              |
| `newId`        | `() => string`                  | Generates a UUID v4 across secure, insecure, and legacy browser contexts. |

---

## Usage tips

-   Always use `parseOrThrow` before writing to Dexie to catch client-side shape regressions early.
-   `nowSec()` keeps timestamps compact (seconds vs milliseconds); align any server sync logic accordingly.
-   `newId()` prefers `crypto.randomUUID()`, falls back to `crypto.getRandomValues()`, and preserves UUID shape with a non-cryptographic last resort.
