# File hashes and attachment inputs

OR3 source uses hashes as file identity and small normalization helpers to
accept older attachment input shapes. These utilities do not upload a file,
attach it to a message, or authorize access to a stored blob. Use the database
file helpers for persisted relationships.

## File identity and hashing

New files use SHA-256 hashes formatted as `sha256:<lowercase hex>`. The hash
identifies the bytes, so files with the same content can share the same stored
blob even when their display names differ. Legacy MD5 hashes remain readable;
do not create new MD5 identities or use either digest for signing or
authentication.

`computeFileHash(blob)` returns the prefixed SHA-256 value. `computeHashHex`
returns raw hexadecimal for an explicitly selected algorithm. SHA-256 uses
WebCrypto when available and falls back to `@noble/hashes`. MD5 attempts
WebCrypto for blobs up to 8 MiB and falls back to streaming `spark-md5` when
it is unavailable or rejects the digest; larger blobs use `spark-md5`. The
streaming paths process 256 KiB chunks and yield between chunks. `parseHash`
trims and lowercases before validation, recognizes prefixed SHA-256/MD5
formats, and normalizes bare 32-character hex as legacy MD5.

```ts
import { computeFileHash, parseHash } from '~/utils/hash';

const file = new Blob([new Uint8Array([1, 2, 3])]);
const identity = await computeFileHash(file); // sha256:<hex>
const parsed = parseHash(identity);           // algorithm, hex, and full value
```

## Normalizing attachment inputs

The pure helpers in `app/utils/files/attachments.ts` normalize input before
other host code uses it:

- `parseHashes` accepts arrays, JSON-array strings, comma-separated strings,
  or one string. Arrays and decoded JSON arrays keep string entries as-is.
  Comma-separated and single strings are trimmed; comma-list empty entries are
  dropped. It does not check whether a hash is valid or whether its blob exists.
- `mergeAssistantFileHashes` deduplicates two lists while keeping first-seen
  order.
- `normalizeImagesParam` accepts a source string or objects with a string
  `url`/`data` value and optional `mime`/`hash`; it drops entries without a
  usable source.

These are input-shape helpers, not message persistence APIs. Stored message
`file_hashes` values are JSON strings. Use `parseFileHashes` and
`serializeFileHashes` from `~/db/files-util` for that contract; serialization
deduplicates and applies the configured per-message limit. Use
`addFilesToMessage` and `removeFileFromMessage` to update a message and its
file references together.

`file_meta.ref_count` is derived local state, not an LWW-synced counter. The
message-file helpers maintain it from unique live message-to-file edges; do
not increment/decrement it separately or treat a hash list as proof that a
blob is available. See [file storage](/documentation/database/files) and
[message attachments](/documentation/database/message-files) for upload,
download, transaction, and deletion behavior.

## Source boundary

Imports such as `~/utils/hash` resolve inside OR3's source tree. They are not
portable plugin modules. Installable plugins should use the permission-scoped
file and storage methods documented in the [Plugin SDK](/documentation/plugins/plugin-sdk).
