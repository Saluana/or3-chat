# File Attachment Helpers

Pure functions that normalize file hash and image inputs into consistent shapes. Used by chat and workflow utilities for attachment handling.

Attachment helpers tolerate messy input: hash lists arrive as arrays, JSON strings, comma lists, or a single string, and image inputs arrive as strings or objects. These helpers make every shape the same.

---

## Purpose

`files/attachments` provides:

- **Hash parsing** — Accept arrays, JSON strings, comma lists, single strings
- **Hash merging** — Deduplicate while preserving first-seen order
- **Image normalization** — Mixed image inputs to attachment objects

All functions are pure — no side effects.

---

## How to use it

### 1. Parse hashes

```ts
import { parseHashes } from '~/utils/files/attachments';

parseHashes('["abc","def"]');   // ['abc', 'def'] - JSON array string
parseHashes('abc,def');         // ['abc', 'def'] - comma list
parseHashes('abc');             // ['abc'] - single hash
parseHashes(['abc', 'def']);    // ['abc', 'def'] - array
parseHashes(null);              // []
```

Non-string entries are dropped.

### 2. Merge assistant hashes

```ts
import { mergeAssistantFileHashes } from '~/utils/files/attachments';

const merged = mergeAssistantFileHashes(['a', 'b'], ['b', 'c']);
// ['a', 'b', 'c'] - deduplicated, first-seen order
```

### 3. Normalize image inputs

```ts
import { normalizeImagesParam } from '~/utils/files/attachments';

const images = normalizeImagesParam([
    'data:image/png;base64,...',           // string URL
    { url: 'https://...', mime: 'image/jpeg', hash: 'abc' },
]);
// [{ kind: 'image', src: '...', mime?, hash? }, ...]
```

---

## API Reference

### `parseHashes(raw)`

Parse a hash payload into a string array.

```ts
function parseHashes(raw: unknown): string[]
```

Behavior:

- Arrays: keep string entries only
- JSON array strings (starting with `[`): parse, then keep strings
- Comma-separated strings: split, trim, drop empties
- Any other string: return as a single-element array
- Missing or unsupported input: `[]`

### `mergeAssistantFileHashes(prev, current)`

Merge two hash arrays without duplicates, preserving first-seen order.

```ts
function mergeAssistantFileHashes(
    prev: string[] | null | undefined,
    current: string[] | null | undefined
): string[]
```

### `normalizeImagesParam(input)`

Normalize mixed image inputs into attachment objects.

```ts
function normalizeImagesParam(input: unknown): NormalizedImageAttachment[]
```

```ts
interface NormalizedImageAttachment {
    kind: 'image';
    src: string;    // data URL or remote URL
    hash?: string;  // optional precomputed hash
    mime?: string;  // optional mime type
}
```

Acceptable items:

- A string — used as `src`
- An object with a string `url` or `data` field (plus optional `mime` and `hash`)

Anything without a usable source is dropped.

---

## Related

- `uiMessages` — Uses `parseHashes` for `file_hashes` normalization
- `hash` — Computing and validating hash strings
- `workflow-types` — Attachment types used by workflow messages

---

## TypeScript

```ts
interface NormalizedImageAttachment {
    kind: 'image';
    src: string;
    hash?: string;
    mime?: string;
}

function parseHashes(raw: unknown): string[];
function mergeAssistantFileHashes(
    prev: string[] | null | undefined,
    current: string[] | null | undefined
): string[];
function normalizeImagesParam(input: unknown): NormalizedImageAttachment[];
```

---

Document generated from `app/utils/files/attachments.ts` implementation.
