# Hash Utilities

File hashing helpers used for deduplication and attachment tracking. New files use SHA-256 with a `sha256:` prefix; legacy MD5 hashes stay supported for reading and verification.

Hashing utilities keep uploads smooth: they chunk large files, yield to the main thread so the UI stays at 60fps, and fall back to pure-JS hashing when WebCrypto is unavailable.

---

## Purpose

`hash` provides:

- **Formats** — `sha256:` and `md5:` prefixed hash strings
- **Parsing** — Validate and split hash strings into parts
- **Computing** — SHA-256 and MD5 digests for Blobs
- **Fallbacks** — WebCrypto first, pure-JS libraries when needed
- **Main-thread friendliness** — Adaptive yielding during large hashes

---

## Basic Example

```ts
import { computeFileHash } from '~/utils/hash';

const file: Blob = /* ... */;
const hash = await computeFileHash(file);
// "sha256:ab12..." - ready to store as a file reference
```

---

## How to use it

### 1. Hash a new file

```ts
import { computeFileHash } from '~/utils/hash';

const hash = await computeFileHash(blob);       // SHA-256, "sha256:" prefix
```

This is the recommended path for new files. It prefers WebCrypto for speed
and streams in 256KB chunks otherwise.

### 2. Compute a specific algorithm

```ts
import { computeHashHex } from '~/utils/hash';

const hex = await computeHashHex(blob, 'sha256');  // raw hex, no prefix
const legacy = await computeHashHex(blob, 'md5');  // raw MD5 hex
```

### 3. Parse and validate hashes

```ts
import { parseHash, isValidHash } from '~/utils/hash';

const parsed = parseHash('sha256:ab12...');
// { algorithm: 'sha256', hex: 'ab12...', full: 'sha256:ab12...' }

if (isValidHash('md5:4d8c...')) {
    // matches a known format
}
```

Bare 32-char lowercase hex strings are recognized as MD5. Anything else
returns `null` from `parseHash`.

### 4. Format a hash

```ts
import { formatHash } from '~/utils/hash';

const full = formatHash('sha256', 'AB12'); // "sha256:ab12" (lowercased)
```

---

## API Reference

### `parseHash(hash)`

Parse a hash string into its algorithm and hex parts.

```ts
function parseHash(hash: string): ParsedHash | null
```

```ts
interface ParsedHash {
    algorithm: 'sha256' | 'md5';
    hex: string;
    full: string;   // "algorithm:hex"
}
```

Returns `null` for empty, unknown, or malformed input.

### `formatHash(algorithm, hex)`

Build a `algorithm:hex` string, lowercased.

```ts
function formatHash(algorithm: HashAlgorithm, hex: string): string
```

### `isValidHash(hash)`

Return `true` when the string matches a known hash format.

```ts
function isValidHash(hash: string): boolean
```

### `computeHashHex(blob, algorithm)`

Compute the raw lowercase hex digest for the requested algorithm.

```ts
async function computeHashHex(blob: Blob, algorithm: HashAlgorithm): Promise<string>
```

Throws on unexpected crypto errors.

### `computeFileHash(blob)`

Compute a SHA-256 hash with the `sha256:` prefix. The standard helper for new
files.

```ts
async function computeFileHash(blob: Blob): Promise<string>
```

---

## How it works

- **SHA-256**: Uses `crypto.subtle.digest` when available. Falls back to
  `@noble/hashes` for non-secure contexts (for example, `http://LAN-IP` on
  mobile).
- **MD5**: Uses WebCrypto for files up to 8MB, then streams with
  `spark-md5` for larger files.
- **Streaming**: Files are processed in 256KB chunks.
- **Yielding**: Between chunks the loop yields via `scheduler.yield()`,
  `requestIdleCallback`, or `setTimeout` — whichever the browser supports.
- **Performance marks**: Dev builds record `hash:<algo>:<mode>` measures.

---

## Limitations

- Not for cryptographic signing or HMAC — digests only
- MD5 is for legacy reads only; new files should use SHA-256
- Hashing is best-effort and throws on unexpected crypto failures

---

## Related

- `files/attachments.ts` — Hash list parsing and merging
- `errors.ts` — Used for non-fatal instrumentation failures

---

## TypeScript

```ts
type HashAlgorithm = 'sha256' | 'md5';

interface ParsedHash {
    algorithm: HashAlgorithm;
    hex: string;
    full: string;
}

function parseHash(hash: string): ParsedHash | null;
function formatHash(algorithm: HashAlgorithm, hex: string): string;
function isValidHash(hash: string): boolean;
async function computeHashHex(blob: Blob, algorithm: HashAlgorithm): Promise<string>;
async function computeFileHash(blob: Blob): Promise<string>;
```

---

Document generated from `app/utils/hash.ts` implementation.
