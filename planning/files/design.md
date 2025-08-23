---
artifact_id: 4ecb5037-1b6f-45d2-8b03-3bdf2570bb8d
name: Message File Storage Design
---

# Overview

We introduce a performant client-side file storage subsystem built on Dexie (IndexedDB) for images now and PDFs later. Core principles: (1) store metadata & binary separately, (2) deduplicate by md5 content hash, (3) link messages via lightweight JSON array of hashes, (4) preserve existing message query performance, (5) safe Dexie schema migration with version bump.

# Architecture

```mermaid
graph TD
  A[User selects file(s)] --> B[Compute md5 hash async]
  B --> C{Hash exists?}
  C -- No --> D[Create FileMeta + store Blob]
  C -- Yes --> E[Increment ref_count]
  D --> F[Return File Hash]
  E --> F[Return File Hash]
  F --> G[Message create/update includes file_hashes]
  G --> H[Persist message (JSON serialized list)]
  H --> I[Later: UI resolves file hashes -> metadata -> blob]
```

## Components

-   FileMeta Table: metadata (no large blobs) + ref_count.
-   FileBlob Table: key/value (hash -> Blob / ArrayBuffer) using Dexie table or `Dexie.open().table('file_blobs')` with `hash` primary key.
-   Message Augmentation: `file_hashes` JSON string column appended; lazy parsing utilities.
-   Hashing Service: async md5 (library `spark-md5` or Web Crypto subtle.digest with incremental read). Prefer Web Crypto for small (<100MB) reading File/Blob as ArrayBuffer streaming via `ReadableStream` if available.
-   Accessor Utilities: `addFilesToMessage`, `filesForMessage`, `removeFileFromMessage`.

# Data Model & Schemas

## Zod Schemas (New)

```ts
import { z } from 'zod';

export const FileMetaSchema = z.object({
    id: z.string(), // same as hash or random id (choose hash for direct key)
    hash: z.string(), // md5 lowercase hex (unique)
    name: z.string(),
    mime_type: z.string(),
    kind: z.enum(['image', 'pdf']).default('image'),
    size_bytes: z.number().int(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    page_count: z.number().int().optional(),
    ref_count: z.number().int().default(0),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

export const FileMetaCreateSchema = FileMetaSchema.omit({
    created_at: true,
    updated_at: true,
    ref_count: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
    ref_count: z.number().int().default(1),
    clock: z.number().int().default(0),
});
```

## Message Schema Change

Add optional `file_hashes` serialized array string column. For runtime use create helper parse:

```ts
export function parseFileHashes(serialized?: string | null): string[] {
    if (!serialized) return [];
    try {
        const arr = JSON.parse(serialized);
        return Array.isArray(arr)
            ? arr.slice(0, 16).filter((x) => typeof x === 'string')
            : [];
    } catch {
        return [];
    }
}
```

## Dexie Schema v2

```ts
this.version(2)
    .stores({
        projects: 'id, name, clock, created_at, updated_at',
        threads:
            'id, project_id, [project_id+updated_at], parent_thread_id, status, pinned, deleted, last_message_at, clock, created_at, updated_at',
        messages:
            'id, [thread_id+index], thread_id, index, role, deleted, stream_id, clock, created_at, updated_at', // file_hashes not indexed
        kv: 'id, &name, clock, created_at, updated_at',
        attachments: 'id, type, name, clock, created_at, updated_at',
        file_meta:
            'hash, [kind+deleted], mime_type, clock, created_at, updated_at', // primary key hash (unique) ensures O(1)
        file_blobs: 'hash', // hash primary key only
    })
    .upgrade(async (tx) => {
        // Add file_hashes field default to '' serialized [] if desired (not necessary; we parse missing as [])
        const msgs = await tx.table('messages').toArray();
        for (const m of msgs) {
            if (!('file_hashes' in m)) {
                m.file_hashes = '[]';
                await tx.table('messages').put(m);
            }
        }
    });
```

Note: Dexie requires new version call chain order. We'll add new tables and leave old ones unchanged.

# Operations

## Create File

1. Accept `File | Blob` + name.
2. Compute md5 hash async.
3. Check `file_meta.where('hash').equals(hash).first()`.
4. If exists: increment `ref_count` (put with updated_at +1) and return meta.
5. Else: create FileMeta (id = hash) + put Blob into file_blobs table.
6. Fire hooks before/after.

## Add Files to Message

1. Ensure message exists (or unify into message creation flow).
2. Accept array of `File | Blob` or existing hashes.
3. For new files, call Create File.
4. Merge unique hashes with existing `file_hashes` (dedupe preserving order, cap 16).
5. Validate all hashes exist and not deleted (unless allowDeleted flag).
6. Update message record with serialized array string.
7. Fire validation hook: `db.messages.files.validate:filter:hashes` to allow external pruning.

## Resolve Files for Message

1. Get message.
2. Parse `file_hashes` -> list.
3. Query `file_meta` in bulk: `db.file_meta.where('hash').anyOf(list).toArray()`.
4. Return metadata (optionally lazily provide a function to fetch blob for each hash).

## Fetch Blob

`getFileBlob(hash): Promise<Blob|undefined>` -> `db.file_blobs.get(hash)` then return stored Blob/ArrayBuffer (choose Blob).

## Remove File From Message

1. Parse existing list.
2. Remove target hash.
3. Update message.
4. Decrement ref_count; if 0 and deleted==true (or GC policy) mark for purge future.

## Soft Delete File

1. Mark FileMeta.deleted=true and updated_at.
2. Do not change messages.
3. Hook events fire.

# Performance Considerations

-   No blob or base64 in message table; only small JSON string references (< 512B typical).
-   Hash indexing only on file_meta; no additional compound indexes keeps write amplification low.
-   Bulk retrieval: use `anyOf` to minimize round trips.
-   Cap 6 file references per message by default (config constant `MAX_MESSAGE_FILE_HASHES`, default 6; override via `NUXT_PUBLIC_MAX_MESSAGE_FILES` bounded 1..12).
-   Use Web Crypto `subtle.digest('MD5'...)` fallback to `spark-md5` (if MD5 unsupported, choose SHA-1 then map still unique; strict requirement is stable dedupe so MD5 acceptable locally). Provide progressive hashing reading in 256KB chunks via File.slice() to avoid blocking UI.
-   Lazy blob loading prevents layout jank; UI can show placeholders.

# Error Handling

Use existing `parseOrThrow` pattern; wrap create/update functions returning a `ServiceResult` equivalent (lightweight) or throw errors and expose via hook events. Example failures: hash computation error, Dexie write failure, message not found, oversize file (size limit: e.g. 20MB configurable).

# Hooks

-   'db.files.create:filter:input'
-   'db.files.create:action:before'
-   'db.files.create:action:after'
-   'db.files.get:filter:output'
-   'db.files.delete:action:soft:before'
-   'db.files.delete:action:soft:after'
-   'db.files.refchange:action:after'
-   'db.messages.files.validate:filter:hashes'

# Testing Strategy

-   Unit style: simulate adding a small Blob -> verify meta + blob tables update and message updated with hashes.
-   Migration: open DB at v1 (simulate by clearing?), then import messages, upgrade to v2, verify `file_hashes` default parsing yields [].
-   Ref counting: add same file twice in different messages; ensure ref_count increments; remove from one message -> decrements.
-   Performance: measure time to add 10 images (~200KB each); ensure < threshold (<150ms hashing each). Provide console perf marks (dev only).

# Future Extensions

-   Support PDFs: capture page_count, maybe preview image.
-   Add GC job scanning file_meta where ref_count=0 and deleted=true to purge blob.
-   Streaming partial load for very large files.

# Open Questions / Assumptions

-   MD5 acceptable for local dedupe (collisions extremely unlikely for user files). Assumed yes.
-   Use hash as primary key (simplifies lookups). Yes.
-   Store Blob directly vs base64: choose Blob in file_blobs to avoid decode cost.
