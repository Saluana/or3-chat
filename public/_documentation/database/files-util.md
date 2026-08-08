# files-util

Utility helpers for enforcing message file limits and serializing file hash arrays.

---

## What does it do?

-   Resolves the per-message file cap from `or3.limits.maxFilesPerMessage` in runtime config (default 10).
-   Provides JSON parse/serialize helpers for the `file_hashes` message column.
-   Dedupes hashes and preserves insertion order when serializing.

---

## Constants

| Constant                  | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `MAX_FILES_PER_MESSAGE`   | Runtime cap on attachments per message (default 10).   |
| `MAX_MESSAGE_FILE_HASHES` | Deprecated alias retained for backwards compatibility. |

---

## API surface

| Function                | Signature                            | Description                                       |
| ----------------------- | ------------------------------------ | ------------------------------------------------- |
| `getMaxMessageFileHashes` | `() => number`                     | Reads the cap from runtime config; falls back to 10. |
| `parseFileHashes`       | `(serialized: string \| null \| undefined) => string[]` | Safely parses a JSON array, strips invalid entries, and enforces the cap. |
| `serializeFileHashes`   | `(hashes: string[]) => string`       | Dedupes, bounds to the cap, and returns a JSON string. |

---

## Usage tips

-   Always run message updates through these helpers before writing to Dexie to avoid oversized rows.
-   Raise or lower the cap by setting `or3.limits.maxFilesPerMessage` in runtime config.
