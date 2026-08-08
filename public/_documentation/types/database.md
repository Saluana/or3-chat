# Database types

Reference for every exported type and interface defined under `app/db`. These aliases describe the Dexie schema, higher-level records, and helper payloads that wrap database operations.

---

## Schema-derived entities (`app/db/schema.ts`)

| Type               | Kind  | Source schema                  | Description                                                                                          |
| ------------------ | ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Project`          | alias | `ProjectSchema`                | Fully validated project row (id, name, description, clocks, timestamps).                             |
| `Thread`           | alias | `ThreadSchema`                 | Thread row with branching metadata, status flags, and clock fields.                                  |
| `ThreadCreate`     | alias | `ThreadCreateSchema` input     | Looser input shape accepted when creating a thread prior to validation.                              |
| `Message`          | alias | `MessageSchema`                | Stored message row with role, data payload, ordering index, and timestamps.                          |
| `MessageCreate`    | alias | `MessageCreateSchema` input    | Input contract for new messages before normalization (allows sparse indexes, file hashes as arrays). |
| `Post`             | alias | `PostSchema`                   | Post/blog row persisted in Dexie.                                                                    |
| `PostCreate`       | alias | `PostCreateSchema` input       | Input structure for creating posts.                                                                  |
| `Kv`               | alias | `KvSchema`                     | Key-value record (name/value pairs plus clock/timestamps).                                           |
| `KvCreate`         | alias | `KvCreateSchema`               | Input payload for inserting KV entries.                                                              |
| `Attachment`       | alias | `AttachmentSchema`             | Attachment row linking messages to files.                                                            |
| `AttachmentCreate` | alias | `AttachmentCreateSchema` input | Input contract for creating attachments.                                                             |
| `FileMeta`         | alias | `FileMetaSchema`               | Stored metadata for blobs (hash, mime, size, soft delete flags, storage ids).                        |
| `FileMetaCreate`   | alias | `FileMetaCreateSchema` input   | Input structure when minting new file metadata.                                                      |
| `Notification`     | alias | `NotificationSchema`           | Notification row for the notification center (user scope, read state, actions).                      |
| `NotificationCreate` | alias | `NotificationCreateSchema` input | Input contract for creating notifications before defaults are applied.                             |
| `NotificationAction` | alias | `NotificationActionSchema`    | Clickable action attached to a notification (`navigate` or `callback`).                              |

The `app/db/index.ts` barrel re-exports the schema aliases (including `Document` and the notification types) for consumers using `import { Thread } from '~/db'` style imports.

```ts
// app/db/schema.ts (fields abbreviated where notes already cover them)
export const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    data: z.unknown().refine(isJsonSerializable, 'Project data must be JSON-serializable'),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ThreadSchema = z.object({
    id: z.string(),
    title: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    last_message_at: z.number().int().nullable().optional(),
    parent_thread_id: z.string().nullable().optional(),
    anchor_message_id: z.string().nullable().optional(),
    anchor_index: z.number().int().nullable().optional(),
    branch_mode: z.enum(['reference', 'copy']).nullable().optional(),
    status: z.string().default('ready'),
    deleted: z.boolean().default(false),
    pinned: z.boolean().default(false),
    clock: z.number().int(),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
    forked: z.boolean().default(false),
    project_id: z.string().nullable().optional(),
    system_prompt_id: z.string().nullable().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const ThreadCreateSchema = ThreadSchema.partial({
    id: true, title: true, last_message_at: true, parent_thread_id: true,
    status: true, deleted: true, pinned: true, forked: true,
    project_id: true, system_prompt_id: true,
})
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        id: z.string().optional().transform((v) => v ?? newId()),
        clock: z.number().int().optional().transform((v) => v ?? 0),
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
export type ThreadCreate = z.input<typeof ThreadCreateSchema>;

export const MessageSchema = z.object({
    id: z.string(),
    data: z.unknown().nullable().optional(),
    role: z.string(),
    pending: z.boolean().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    error: z.string().nullable().optional(),
    deleted: z.boolean().default(false),
    thread_id: z.string(),
    index: z.number().int(),
    order_key: z.string().optional(),
    clock: z.number().int(),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
    stream_id: z.string().nullable().optional(),
    file_hashes: z.string().nullable().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessageCreateSchema = MessageSchema.partial({ index: true })
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        id: z.string().optional().transform((v) => v ?? newId()),
        clock: z.number().int().optional().transform((v) => v ?? 0),
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
export type MessageCreate = z.input<typeof MessageCreateSchema>;

export const PostSchema = z.object({
    id: z.string(),
    title: z.string().transform((s) => s.trim())
        .refine((s) => s.length > 0, 'Title is required'),
    content: z.string().default(''),
    postType: z.string().default('markdown'),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int().default(0),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
    meta: z.union([
        z.string(),
        z.object({ key: z.string(), value: z.string().nullable().optional() }),
        z.array(z.object({ key: z.string(), value: z.string().nullable().optional() }))
            .nullable().optional(),
    ]),
    file_hashes: z.string().nullable().optional(),
});
export type Post = z.infer<typeof PostSchema>;

export const PostCreateSchema = PostSchema.partial({ id: true, created_at: true, updated_at: true })
    .extend({
        id: z.string().optional().transform((v) => v ?? newId()),
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
export type PostCreate = z.input<typeof PostCreateSchema>;

export const KvSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.string().nullable().optional(),
    deleted: z.boolean().default(false),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    clock: z.number().int(),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
});
export type Kv = z.infer<typeof KvSchema>;

export const KvCreateSchema = KvSchema.omit({ created_at: true, updated_at: true }).extend({
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
});
export type KvCreate = z.infer<typeof KvCreateSchema>;

export const AttachmentSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.url(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachmentCreateSchema = AttachmentSchema.omit({
    created_at: true, updated_at: true,
}).extend({
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
});
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;

export const FileMetaSchema = z.object({
    hash: z.string().refine(isValidHash, 'Invalid file hash format'),
    name: z.string(),
    mime_type: z.string(),
    kind: z.enum(['image', 'pdf']).default('image'),
    size_bytes: z.number().int(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    page_count: z.number().int().optional(),
    ref_count: z.number().int().default(0),
    storage_provider_id: z.string().optional(),
    storage_id: z.string().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    deleted_at: z.number().int().optional(),
    clock: z.number().int(),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

export const FileMetaCreateSchema = FileMetaSchema.omit({
    created_at: true, updated_at: true, ref_count: true,
}).extend({
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
    ref_count: z.number().int().default(1),
    clock: z.number().int().default(0),
});
export type FileMetaCreate = z.infer<typeof FileMetaCreateSchema>;

export const NotificationActionSchema = z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['navigate', 'callback']),
    target: z.object({
        threadId: z.string().optional(),
        documentId: z.string().optional(),
        route: z.string().optional(),
    }).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});
export type NotificationAction = z.infer<typeof NotificationActionSchema>;

export const NotificationSchema = z.object({
    id: z.string(),
    workspace_id: z.string().optional(),
    user_id: z.string(),
    thread_id: z.string().optional(),
    document_id: z.string().optional(),
    type: z.string(),
    title: z.string(),
    body: z.string().optional(),
    actions: z.array(NotificationActionSchema).optional(),
    read_at: z.number().int().optional(),
    deleted: z.boolean().default(false),
    deleted_at: z.number().int().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    clock: z.number().int(),
    hlc: z.string().optional(),
    op_id: z.string().optional(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationCreateSchema = NotificationSchema.partial({
    id: true, workspace_id: true, read_at: true, deleted: true, deleted_at: true,
})
    .omit({ created_at: true, updated_at: true, clock: true })
    .extend({
        id: z.string().optional().transform((v) => v ?? newId()),
        clock: z.number().int().optional().transform((v) => v ?? 0),
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
export type NotificationCreate = z.input<typeof NotificationCreateSchema>;
```

Note: `isJsonSerializable` is a helper in `app/db/schema.ts` that rejects cyclic or non-JSON data at the boundary. `hlc` (Hybrid Logical Clock) and `op_id` (operation id) fields are populated by the sync layer, not by local writers.

---

## Document store helpers (`app/db/documents.ts`)

| Type                  | Kind      | Description                                                                             |
| --------------------- | --------- | --------------------------------------------------------------------------------------- |
| `DocumentRow`         | interface | Minimal Dexie row projection (id, title, content, timestamps, clock, file hashes).      |
| `DocumentRecord`      | interface | Extended record used in composables (parsed TipTap content, optional `file_hashes`).    |
| `CreateDocumentInput` | interface | Shape accepted by `createDocument` before schema validation (title, TipTap content).    |
| `UpdateDocumentPatch` | interface | Partial update payload (title, TipTap content).                                         |
| `Document`            | alias     | Re-export of `DocumentRecord` for ergonomic imports.                                    |

```ts
// app/db/documents.ts
export interface DocumentRow {
    id: string;
    title: string;
    content: string; // JSON string
    postType: string; // always 'doc'
    created_at: number;
    updated_at: number;
    deleted: boolean;
    clock?: number;
    file_hashes?: string | null;
}

export interface DocumentRecord {
    id: string;
    title: string;
    content: TipTapDocument | null; // parsed TipTap JSON
    created_at: number;
    updated_at: number;
    deleted: boolean;
    file_hashes?: string | null;
}

export interface CreateDocumentInput {
    title?: string | null;
    content?: TipTapDocument | null;
}

export interface UpdateDocumentPatch {
    title?: string;
    content?: TipTapDocument | null;
}

export type Document = DocumentRecord;
```

`TipTapDocument` comes from `~/types/database`. Documents reuse the `posts` Dexie table with `postType: 'doc'`; content is stored as a JSON string.

---

## Prompt store helpers (`app/db/prompts.ts`)

| Type                | Kind      | Description                                                               |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `PromptRow`         | interface | Dexie row projection (id, title, content, meta, clock).                   |
| `PromptMeta`        | interface | Serialized prompt metadata (`tags`, `favorite`).                          |
| `PromptRecord`      | interface | Rich record returned by prompt helpers (parsed content, tags, favorite).  |
| `CreatePromptInput` | interface | Input payload for creating prompts (title, content, tags, favorite).      |
| `UpdatePromptPatch` | interface | Patch contract for updating prompts (title, content, tags, favorite).     |
| `Prompt`            | alias     | Re-export of `PromptRecord` for ergonomic imports.                        |

```ts
// app/db/prompts.ts
export interface PromptRow {
    id: string;
    title: string;
    content: string; // JSON string
    postType: string; // always 'prompt'
    created_at: number;
    updated_at: number;
    deleted: boolean;
    meta: Post['meta'];
    clock?: number;
}

export interface PromptMeta {
    tags: string[];
    favorite: boolean;
}

export interface PromptRecord {
    id: string;
    title: string;
    content: TipTapDocument | null;
    tags: string[];
    favorite: boolean;
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

export interface CreatePromptInput {
    title?: string | null;
    content?: TipTapDocument | null;
    tags?: string[];
    favorite?: boolean;
}

export interface UpdatePromptPatch {
    title?: string;
    content?: TipTapDocument | null;
    tags?: string[];
    favorite?: boolean;
}

export type Prompt = PromptRecord;
```

---

## File linking helpers

| Type          | Kind        | Description                                                                                                        |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `AddableFile` | union alias | Discriminated union accepted by `addFilesToMessage` (`{ type: 'blob'; blob; name? }` or `{ type: 'hash'; hash }`). |
| `FileBlobRow` | interface   | Underlying Dexie row for the `file_blobs` table (`hash`, `blob`).                                                  |

```ts
// app/db/message-files.ts
export type AddableFile =
    | { type: 'blob'; blob: Blob; name?: string }
    | { type: 'hash'; hash: string };

// app/db/client.ts
export interface FileBlobRow {
    hash: string;
    blob: Blob;
}
```

---

## Document revision helpers (`app/db/document-revisions.ts`)

Document revisions live in the shared `posts` table using internal post types. A manifest row points at chunk rows that store the encoded snapshot.

| Type                       | Kind      | Description                                                                   |
| -------------------------- | --------- | ----------------------------------------------------------------------------- |
| `DocumentRevisionSource`   | union     | `'auto'`, `'manual'`, `'ai'`, or `'restore'`.                                 |
| `DocumentRevisionManifest` | interface | Revision metadata (document id, encoding, sizes, chunk ids, file hashes).     |
| `CompleteDocumentRevision` | interface | A manifest paired with its decoded snapshot.                                  |

```ts
// app/db/document-revisions.ts
import type {
    DocumentRevisionEncoding,
    DocumentRevisionSnapshot,
} from '~/utils/documents/revision-codec';

export type DocumentRevisionSource = 'auto' | 'manual' | 'ai' | 'restore';

export interface DocumentRevisionManifest {
    version: 1;
    revisionId: string;
    documentId: string;
    source: DocumentRevisionSource;
    createdAt: number;
    titleContentHash: string;
    encoding: DocumentRevisionEncoding;
    originalBytes: number;
    encodedBytes: number;
    chunkIds: string[];
    fileHashes: string[];
}

export interface CompleteDocumentRevision {
    manifest: DocumentRevisionManifest;
    snapshot: DocumentRevisionSnapshot;
}
```

---

## Dexie table contracts (`app/db/client.ts`)

`Or3DB` extends Dexie and defines one typed table per entity. `getDb()` returns the database for the active workspace; `getWorkspaceDb(id)` returns (or creates) a specific workspace database.

| Table              | Row type            | Notes                                                              |
| ------------------ | ------------------- | ------------------------------------------------------------------ |
| `projects`         | `Project`           | Project metadata.                                                  |
| `threads`          | `Thread`            | Threads with branching and status flags.                           |
| `messages`         | `Message`           | Thread messages with `order_key` ordering.                         |
| `kv`               | `Kv`                | Small preference blobs (`name` is a unique index).                 |
| `attachments`      | `Attachment`        | Upload metadata records.                                           |
| `file_meta`        | `FileMeta`          | Blob metadata keyed by content hash.                               |
| `file_blobs`       | `FileBlobRow`       | Binary blobs keyed by content hash (local only).                   |
| `posts`            | `Post`              | Documents, prompts, and revision manifests/chunks by `postType`.   |
| `file_transfers`   | `FileTransfer`      | Local transfer queue state (`~~/shared/storage/types`).            |
| `notifications`    | `Notification`      | Notification center rows.                                          |
| `pending_ops`      | `PendingOp`         | Sync outbox (`~~/shared/sync/types`).                              |
| `tombstones`       | `Tombstone`         | Deleted record markers to prevent resurrection.                    |
| `sync_state`       | `SyncState`         | Persisted sync cursor and device info.                             |
| `sync_runs`        | `SyncRun`           | Sync telemetry records.                                            |

```ts
// app/db/client.ts (table declarations, abbreviated)
export class Or3DB extends Dexie {
    projects!: Table<Project, string>;
    threads!: Table<Thread, string>;
    messages!: Table<Message, string>;
    kv!: Table<Kv, string>;
    attachments!: Table<Attachment, string>;
    file_meta!: Table<FileMeta, string>;
    file_blobs!: Table<FileBlobRow, string>;
    posts!: Table<Post, string>;
    file_transfers!: Table<FileTransfer, string>;
    notifications!: Table<Notification, string>;
    pending_ops!: Table<PendingOp, string>;
    tombstones!: Table<Tombstone, string>;
    sync_state!: Table<SyncState, string>;
    sync_runs!: Table<SyncRun, string>;
}

export interface ActiveWorkspaceChangeEvent {
    oldWorkspaceId: string | null;
    newWorkspaceId: string | null;
    generation: number;
}
```

`ActiveWorkspaceChangeEvent` is emitted by `subscribeActiveWorkspaceDb()` when the active workspace database changes. Consumers that cache the current database should use `getDb()` instead of the legacy `db` export, which can go stale across workspace switches.

---

## Operational utilities

| Type                 | Kind      | Description                                                                                        |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `DbTryTags`          | interface | Metadata passed to `dbTry` (`op: 'read'` or `'write'`, optional `entity`, arbitrary diagnostics).  |
| `ForkMode`           | alias     | Re-export of `BranchMode` describing `'reference'` vs `'copy'` branch semantics in `branching.ts`. |
| `CreateThreadContext`| interface | Optional context for thread creation (`hooks`, client-side conversation `limits`).                 |

```ts
// app/db/dbTry.ts
export interface DbTryTags {
    readonly op: 'read' | 'write';
    readonly entity?: string; // table/entity name for context
    readonly [k: string]: unknown;
}

// app/db/branching.ts
import type { BranchMode } from '../core/hooks/hook-types';
export type ForkMode = BranchMode;

// app/db/threads.ts
export interface CreateThreadContext {
    hooks?: TypedHookEngine;
    limits?: {
        enabled?: boolean;
        maxConversations?: number;
    };
}
```

These helper types surface the inputs and outputs that higher-level database APIs expose to composables, hooks, and plugins. Keep them in sync with schema or payload changes so consumer code stays type-safe.
