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
| `FileMeta`         | alias | `FileMetaSchema`               | Stored metadata for blobs (hash, mime, size, soft delete flags).                                     |
| `FileMetaCreate`   | alias | `FileMetaCreateSchema` input   | Input structure when minting new file metadata.                                                      |

The `app/db/index.ts` barrel re-exports these aliases (including `Document`) for consumers using `import { Thread } from '~/db'` style imports.

```ts
// app/db/schema.ts
import { z } from 'zod';
import { newId, nowSec } from './util';

export const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    data: z.any(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
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
    forked: z.boolean().default(false),
    project_id: z.string().nullable().optional(),
    system_prompt_id: z.string().nullable().optional(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const ThreadCreateSchema = ThreadSchema.partial({
    id: true,
    title: true,
    last_message_at: true,
    parent_thread_id: true,
    status: true,
    deleted: true,
    pinned: true,
    forked: true,
    project_id: true,
    system_prompt_id: true,
})
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        id: z
            .string()
            .optional()
            .transform((v) => v ?? newId()),
        clock: z
            .number()
            .int()
            .optional()
            .transform((v) => v ?? 0),
        created_at: z.number().int().default(nowSec()),
        updated_at: z.number().int().default(nowSec()),
    });
export type ThreadCreate = z.input<typeof ThreadCreateSchema>;

export const MessageSchema = z.object({
    id: z.string(),
    data: z.unknown().nullable().optional(),
    role: z.string(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    error: z.string().nullable().optional(),
    deleted: z.boolean().default(false),
    thread_id: z.string(),
    index: z.number().int(),
    clock: z.number().int(),
    stream_id: z.string().nullable().optional(),
    file_hashes: z.string().nullable().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessageCreateSchema = MessageSchema.partial({ index: true })
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        id: z
            .string()
            .optional()
            .transform((v) => v ?? newId()),
        clock: z
            .number()
            .int()
            .optional()
            .transform((v) => v ?? 0),
        created_at: z.number().int().default(nowSec()),
        updated_at: z.number().int().default(nowSec()),
    });
export type MessageCreate = z.input<typeof MessageCreateSchema>;

export const PostSchema = z.object({
    id: z.string(),
    title: z
        .string()
        .transform((s) => s.trim())
        .refine((s) => s.length > 0, 'Title is required'),
    content: z.string().default(''),
    postType: z.string().default('markdown'),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    meta: z.union([
        z.string(),
        z.object({
            key: z.string(),
            value: z.string().nullable().optional(),
        }),
        z
            .array(
                z.object({
                    key: z.string(),
                    value: z.string().nullable().optional(),
                })
            )
            .nullable()
            .optional(),
    ]),
    file_hashes: z.string().nullable().optional(),
});
export type Post = z.infer<typeof PostSchema>;

export const PostCreateSchema = PostSchema.partial({
    id: true,
    created_at: true,
    updated_at: true,
}).extend({
    id: z
        .string()
        .optional()
        .transform((v) => v ?? newId()),
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type PostCreate = z.input<typeof PostCreateSchema>;

export const KvSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    clock: z.number().int(),
});
export type Kv = z.infer<typeof KvSchema>;

export const KvCreateSchema = KvSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
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
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(nowSec()),
    updated_at: z.number().int().default(nowSec()),
});
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;

export const FileMetaSchema = z.object({
    hash: z.string(),
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
export type FileMetaCreate = z.infer<typeof FileMetaCreateSchema>;
```

---

## Document store helpers (`app/db/documents.ts`)

| Type                  | Kind      | Description                                                                             |
| --------------------- | --------- | --------------------------------------------------------------------------------------- |
| `DocumentRow`         | interface | Minimal Dexie row projection (id, title, content, timestamps).                          |
| `DocumentRecord`      | interface | Extended record used in composables (includes denormalised helpers like `paneIndex`).   |
| `CreateDocumentInput` | interface | Shape accepted by `createDocument` before schema validation (title, content, metadata). |
| `UpdateDocumentPatch` | interface | Partial update payload (existing record, merged document data, metadata).               |
| `Document`            | alias     | Re-export of `DocumentRecord` for ergonomic imports.                                    |

```ts
// app/db/documents.ts
export interface DocumentRow {
    id: string;
    title: string;
    content: string;
    postType: string;
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

export interface DocumentRecord {
    id: string;
    title: string;
    content: any;
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

export interface CreateDocumentInput {
    title?: string | null;
    content?: any;
}

export interface UpdateDocumentPatch {
    title?: string;
    content?: any;
}

export type Document = DocumentRecord;
```

---

## Prompt store helpers (`app/db/prompts.ts`)

| Type                | Kind      | Description                                                               |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `PromptRow`         | interface | Dexie row projection (id, name, text, timestamps).                        |
| `PromptRecord`      | interface | Rich record returned by prompt helpers (includes folder/project context). |
| `CreatePromptInput` | interface | Input payload for creating prompts (name, text, optional metadata).       |
| `UpdatePromptPatch` | interface | Patch contract for updating prompts (existing record, updates, metadata). |
| `Prompt`            | alias     | Re-export of `PromptRecord` for ergonomic imports.                        |

```ts
// app/db/prompts.ts
export interface PromptRow {
    id: string;
    title: string;
    content: string;
    postType: string;
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

export interface PromptRecord {
    id: string;
    title: string;
    content: any;
    created_at: number;
    updated_at: number;
    deleted: boolean;
}

export interface CreatePromptInput {
    title?: string | null;
    content?: any;
}

export interface UpdatePromptPatch {
    title?: string;
    content?: any;
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

## Operational utilities

| Type        | Kind      | Description                                                                                        |
| ----------- | --------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DbTryTags` | interface | Metadata passed to `dbTry` (`op: 'read'                                                            | 'write'`, optional `entity`, arbitrary diagnostics tags). |
| `ForkMode`  | alias     | Re-export of `BranchMode` describing `'reference'` vs `'copy'` branch semantics in `branching.ts`. |

```ts
// app/db/dbTry.ts
export interface DbTryTags {
    readonly op: 'read' | 'write';
    readonly entity?: string;
    readonly [k: string]: any;
}

// app/db/branching.ts
import type { BranchMode } from '../core/hooks/hook-types';
export type ForkMode = BranchMode;
```

These helper types surface the inputs and outputs that higher-level database APIs expose to composables, hooks, and plugins. Keep them in sync with schema or payload changes so consumer code stays type-safe.
