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

// threads
export const ThreadSchema = z.object({
    id: z.string(),
    title: z.string().nullable().optional(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    last_message_at: z.number().int().nullable().optional(),
    parent_thread_id: z.string().nullable().optional(),
    // Branching (minimal): anchor + mode (reference|copy). Optional for root threads.
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

// For incoming create payloads (apply defaults like the DB)
export const ThreadCreateSchema = ThreadSchema.partial({
    // Make a wide set of fields optional for input; we'll supply defaults below
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
    // We'll re-add with defaults/derived values
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        // Dynamic defaults while keeping inputs optional
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
// Use z.input so defaulted fields are optional for callers
export type ThreadCreate = z.input<typeof ThreadCreateSchema>;
// messages
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
    clock: z.number().int(),
    stream_id: z.string().nullable().optional(),
    // JSON serialized array of file content hashes (md5) or null/undefined when absent.
    // Kept as a string to avoid bloating indexed row size & allow lazy parsing.
    file_hashes: z.string().nullable().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export const PostSchema = z.object({
    id: z.string(),
    // Title must be non-empty after trimming
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

// Create schema for posts allowing omission of id/timestamps; meta may be provided as
// string | object | array and will be normalized to string upstream before storage.
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

export const MessageCreateSchema = MessageSchema.partial({ index: true })
    .omit({ created_at: true, updated_at: true, id: true, clock: true })
    .extend({
        // Keep inputs minimal; generate missing id/clock
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
// Use input type so callers can omit defaulted fields
export type MessageCreate = z.input<typeof MessageCreateSchema>;

// kv
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

// attachments
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

// file meta (metadata only; binary stored separately in file_blobs table)
export const FileMetaSchema = z.object({
    // Use hash as both primary key and lookup value for simplicity
    hash: z.string(), // md5 hex lowercase
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
