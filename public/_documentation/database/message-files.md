# Message attachments

Helpers for attaching/detaching files to chat messages while maintaining ref counts and serialized hash lists.

---

## What does it do?

-   Resolves `file_hashes` arrays from messages and returns their metadata.
-   Adds files to messages either by Blob (new upload) or by existing hash.
-   Ensures Dexie transactions update messages and file tables atomically.
-   Dereferences files when hashes are removed.

---

## Types

| Type          | Description                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| `AddableFile` | Discriminated union `{ type: 'blob'; blob; name? }` or `{ type: 'hash'; hash }`. |

---

## API surface

| Function                                 | Description                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `filesForMessage(messageId)`             | Loads `FileMeta[]` for the hashes stored on a message.                             |
| `addFilesToMessage(messageId, files)`    | Uploads or references files, merges hashes, applies hooks, writes serialized list. |
| `removeFileFromMessage(messageId, hash)` | Removes a hash, saves new list, decrements ref count.                              |

---

## Implementation notes

1. **Transactions** — Adds include `messages`, `file_meta`, and `file_blobs`; removals include `messages` and `file_meta`. Both include sync capture tables through the existing transaction helper.
2. **Hooks** — `db.messages.files.validate:filter:hashes` lets extensions prune or reorder known candidate hashes before persistence.
3. **Reference reconciliation** — Counts are derived from the unique before/after message edge set. Duplicate additions are idempotent, filtered/overflow Blob attempts are dereferenced, and concurrent identical uploads retain one metadata/blob pair with the correct count.
4. **Serialization** — Uses `serializeFileHashes` so limits/deduping stay consistent with message creation flows.

---

## Usage tips

-   Pass Blobs when users drop files; the helper will call `createOrRefFile` and reuse existing hashes.
-   For quick attach of already-uploaded media, pass `{ type: 'hash', hash }` to avoid re-computation.
-   Always call `removeFileFromMessage` (not manual mutation) so ref counts stay accurate.

## Hash serialization and limits

Import `parseFileHashes`, `serializeFileHashes`, and `getMaxMessageFileHashes` from `~/db/files-util`.

`parseFileHashes` accepts a stored JSON string/null/undefined. Invalid JSON or a non-array returns an empty array; non-string elements are discarded and the result is bounded. It does not validate hash format or deduplicate.

`serializeFileHashes` deduplicates strings, preserves first-occurrence order, bounds the list, and returns a JSON string. The dynamic cap comes from `runtimeConfig.public.or3.limits.maxFilesPerMessage`, falling back to 10. The constants `MAX_FILES_PER_MESSAGE` and its compatibility alias `MAX_MESSAGE_FILE_HASHES` are **static fallback values of 10**, not live runtime configuration.

Neither utility checks file existence, adjusts references, or authorizes a file. Use the relationship helpers above for mutations. Do not decrement a reference again after `removeFileFromMessage`.
