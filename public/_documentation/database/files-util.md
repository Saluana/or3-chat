# files-util

Utility helpers for enforcing message file limits and serializing file hash arrays.

---

## What does it do?

-   Resolves `MAX_FILES_PER_MESSAGE` from `NUXT_PUBLIC_MAX_MESSAGE_FILES` (bounded 1–12).
-   Provides JSON parse/serialize helpers for the `file_hashes` message column.
-   Dedupes hashes and preserves insertion order when serializing.

---

## Constants

| Constant                  | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `MAX_FILES_PER_MESSAGE`   | Runtime cap on attachments per message (default 6).    |
| `MAX_MESSAGE_FILE_HASHES` | Deprecated alias retained for backwards compatibility. |

---

## API surface

| Function              | Signature                      | Description                                      |
| --------------------- | ------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `parseFileHashes`     | `(serialized?: string          | null) => string[]`                               | Safely parses JSON array, strips invalid entries, enforces max length. |
| `serializeFileHashes` | `(hashes: string[]) => string` | Dedupes, bounds to max, and returns JSON string. |

---

## Usage tips

-   Always run message updates through these helpers before writing to Dexie to avoid oversized rows.
-   When increasing the limit via env, remember it caps at 12 to avoid UI abuse.
