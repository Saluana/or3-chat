# message-files

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

1. **Transactions** — All mutating functions run inside Dexie transactions touching `messages`, `file_meta`, and `file_blobs` to ensure consistency.
2. **Hooks** — `db.messages.files.validate:filter:hashes` lets extensions prune or reorder hash lists before persistence.
3. **Serialization** — Uses `serializeFileHashes` so limits/deduping stay consistent with message creation flows.

---

## Usage tips

-   Pass Blobs when users drop files; the helper will call `createOrRefFile` and reuse existing hashes.
-   For quick attach of already-uploaded media, pass `{ type: 'hash', hash }` to avoid re-computation.
-   Always call `removeFileFromMessage` (not manual mutation) so ref counts stay accurate.
