/**
 * @module app/db/schema
 *
 * Purpose:
 * Zod schemas and types for local IndexedDB persistence.
 *
 * Responsibilities:
 * - Define validated shapes for local-first entities
 * - Document wire format expectations for sync payloads
 *
 * Non-responsibilities:
 * - Persistence logic or database access
 */
import { z } from 'zod';
import { newId, nowSec } from './util';
import { isValidHash } from '~/utils/hash';

function isJsonSerializable(
    value: unknown,
    depth = 0,
    seen: WeakSet<object> = new WeakSet()
): boolean {
    if (depth > 20) return false;
    if (value === null) return true;

    const kind = typeof value;
    if (kind === 'string' || kind === 'number' || kind === 'boolean') {
        return true;
    }

    if (kind !== 'object') {
        return false;
    }

    if (seen.has(value as object)) {
        return false;
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
        return value.every((item) => isJsonSerializable(item, depth + 1, seen));
    }

    return Object.values(value as Record<string, unknown>).every((item) =>
        isJsonSerializable(item, depth + 1, seen)
    );
}

/**
 * `ProjectSchema`
 *
 * Purpose:
 * Defines the shape for project records stored in IndexedDB.
 *
 * Behavior:
 * Validates project identifiers, timestamps, and metadata fields.
 *
 * Constraints:
 * - Wire format uses snake_case field names.
 *
 * Non-Goals:
 * - Does not enforce cross-entity references.
 */
export const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    data: z
        .unknown()
        .refine(
            (value) => isJsonSerializable(value),
            'Project data must be JSON-serializable'
        ),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted: z.boolean().default(false),
    clock: z.number().int(),
});
/**
 * Purpose:
 * Type alias for `ProjectSchema`.
 *
 * Behavior:
 * Represents validated project rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include derived fields.
 */
export type Project = z.infer<typeof ProjectSchema>;

// threads
/**
 * `ThreadSchema`
 *
 * Purpose:
 * Defines the shape for thread records stored in IndexedDB.
 *
 * Behavior:
 * Validates thread metadata and branching fields.
 *
 * Constraints:
 * - Wire format uses snake_case field names.
 *
 * Non-Goals:
 * - Does not enforce parent thread existence.
 */
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
    hlc: z.string().optional(),
    forked: z.boolean().default(false),
    project_id: z.string().nullable().optional(),
    system_prompt_id: z.string().nullable().optional(),
});
/**
 * Purpose:
 * Type alias for `ThreadSchema`.
 *
 * Behavior:
 * Represents validated thread rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include denormalized message data.
 */
export type Thread = z.infer<typeof ThreadSchema>;

// For incoming create payloads (apply defaults like the DB)
/**
 * `ThreadCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating threads.
 *
 * Behavior:
 * Supplies defaults for ids and timestamps while allowing partial inputs.
 *
 * Constraints:
 * - Uses `z.input` so callers can omit defaulted fields.
 *
 * Non-Goals:
 * - Does not validate project membership.
 */
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
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
// Use z.input so defaulted fields are optional for callers
/**
 * Purpose:
 * Type alias for `ThreadCreateSchema` inputs.
 *
 * Behavior:
 * Represents caller-provided thread creation payloads.
 *
 * Constraints:
 * - Defaults are applied in schema parsing.
 *
 * Non-Goals:
 * - Does not include post-creation fields.
 */
export type ThreadCreate = z.input<typeof ThreadCreateSchema>;
// messages
/**
 * `MessageSchema`
 *
 * Purpose:
 * Defines the shape for message records stored in IndexedDB.
 *
 * Behavior:
 * Validates message metadata, ordering fields, and sync clocks.
 *
 * Constraints:
 * - Wire format uses snake_case field names.
 * - `file_hashes` is a JSON string to reduce row size.
 *
 * Non-Goals:
 * - Does not enforce per-thread index uniqueness.
 */
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
    // HLC-derived ordering key for deterministic ordering when index collides
    order_key: z.string().optional(),
    clock: z.number().int(),
    hlc: z.string().optional(),
    stream_id: z.string().nullable().optional(),
    // JSON serialized array of file content hashes (sha256/md5) or null/undefined when absent.
    // Kept as a string to avoid bloating indexed row size & allow lazy parsing.
    file_hashes: z.string().nullable().optional(),
});

/**
 * Purpose:
 * Type alias for `MessageSchema`.
 *
 * Behavior:
 * Represents validated message rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include parsed file hash arrays.
 */
export type Message = z.infer<typeof MessageSchema>;

/**
 * `PostSchema`
 *
 * Purpose:
 * Defines the shape for post records stored in IndexedDB.
 *
 * Behavior:
 * Validates titles, content, and metadata fields.
 *
 * Constraints:
 * - Title is trimmed and must be non-empty.
 *
 * Non-Goals:
 * - Does not interpret content format.
 */
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
    clock: z.number().int().default(0),
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

/**
 * Purpose:
 * Type alias for `PostSchema`.
 *
 * Behavior:
 * Represents validated post rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include parsed metadata.
 */
export type Post = z.infer<typeof PostSchema>;

// Create schema for posts allowing omission of id/timestamps; meta may be provided as
// string | object | array and will be normalized to string upstream before storage.
/**
 * `PostCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating posts.
 *
 * Behavior:
 * Adds default ids and timestamps for creation flows.
 *
 * Constraints:
 * - Meta normalization happens upstream before storage.
 *
 * Non-Goals:
 * - Does not validate content format.
 */
export const PostCreateSchema = PostSchema.partial({
    id: true,
    created_at: true,
    updated_at: true,
}).extend({
    id: z
        .string()
        .optional()
        .transform((v) => v ?? newId()),
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
});
/**
 * Purpose:
 * Type alias for `PostCreateSchema` inputs.
 *
 * Behavior:
 * Represents caller-provided post creation payloads.
 *
 * Constraints:
 * - Defaults are applied in schema parsing.
 *
 * Non-Goals:
 * - Does not include derived fields.
 */
export type PostCreate = z.input<typeof PostCreateSchema>;

/**
 * `MessageCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating messages.
 *
 * Behavior:
 * Applies defaults for ids and timestamps while allowing partial inputs.
 *
 * Constraints:
 * - Uses `z.input` so callers can omit defaulted fields.
 *
 * Non-Goals:
 * - Does not enforce per-thread ordering.
 */
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
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
// Use input type so callers can omit defaulted fields
/**
 * Purpose:
 * Type alias for `MessageCreateSchema` inputs.
 *
 * Behavior:
 * Represents caller-provided message creation payloads.
 *
 * Constraints:
 * - Defaults are applied in schema parsing.
 *
 * Non-Goals:
 * - Does not include persisted clock values.
 */
export type MessageCreate = z.input<typeof MessageCreateSchema>;

// kv
/**
 * `KvSchema`
 *
 * Purpose:
 * Defines the shape for key value records stored in IndexedDB.
 *
 * Behavior:
 * Validates name, value, timestamps, and clocks.
 *
 * Constraints:
 * - Wire format uses snake_case field names.
 *
 * Non-Goals:
 * - Does not enforce name uniqueness at the schema level.
 */
export const KvSchema = z.object({
    id: z.string(),
    name: z.string(),
    value: z.string().nullable().optional(),
    deleted: z.boolean().default(false),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    clock: z.number().int(),
});
/**
 * Purpose:
 * Type alias for `KvSchema`.
 *
 * Behavior:
 * Represents validated KV rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include parsed values.
 */
export type Kv = z.infer<typeof KvSchema>;

/**
 * `KvCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating KV records.
 *
 * Behavior:
 * Applies default timestamps for creation flows.
 *
 * Constraints:
 * - `id` is required in input.
 *
 * Non-Goals:
 * - Does not apply name-based ids.
 */
export const KvCreateSchema = KvSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
});
/**
 * Purpose:
 * Type alias for `KvCreateSchema`.
 *
 * Behavior:
 * Represents validated KV creation payloads.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include derived fields.
 */
export type KvCreate = z.infer<typeof KvCreateSchema>;

// attachments
/**
 * `AttachmentSchema`
 *
 * Purpose:
 * Defines the shape for attachment records stored in IndexedDB.
 *
 * Behavior:
 * Validates attachment identifiers and metadata.
 *
 * Constraints:
 * - URLs are validated via Zod URL parsing.
 *
 * Non-Goals:
 * - Does not validate remote availability.
 */
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
/**
 * Purpose:
 * Type alias for `AttachmentSchema`.
 *
 * Behavior:
 * Represents validated attachment rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include binary data.
 */
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * `AttachmentCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating attachments.
 *
 * Behavior:
 * Supplies default timestamps for creation flows.
 *
 * Constraints:
 * - Requires a valid URL.
 *
 * Non-Goals:
 * - Does not validate attachment reachability.
 */
export const AttachmentCreateSchema = AttachmentSchema.omit({
    created_at: true,
    updated_at: true,
}).extend({
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
});
/**
 * Purpose:
 * Type alias for `AttachmentCreateSchema`.
 *
 * Behavior:
 * Represents validated attachment creation payloads.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include binary data.
 */
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;

// file meta (metadata only; binary stored separately in file_blobs table)
/**
 * `FileMetaSchema`
 *
 * Purpose:
 * Defines the metadata shape for locally stored files.
 *
 * Behavior:
 * Validates file hashes, sizes, mime types, and sync clocks.
 *
 * Constraints:
 * - Hash format is validated and used as the primary key.
 *
 * Non-Goals:
 * - Does not include the binary blob payload.
 */
export const FileMetaSchema = z.object({
    // Use hash as both primary key and lookup value for simplicity
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
});
/**
 * Purpose:
 * Type alias for `FileMetaSchema`.
 *
 * Behavior:
 * Represents validated file metadata rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include binary data.
 */
export type FileMeta = z.infer<typeof FileMetaSchema>;

/**
 * `FileMetaCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating file metadata.
 *
 * Behavior:
 * Supplies default timestamps, ref counts, and clocks for new files.
 *
 * Constraints:
 * - Requires a valid hash and mime type.
 *
 * Non-Goals:
 * - Does not validate remote storage identifiers.
 */
export const FileMetaCreateSchema = FileMetaSchema.omit({
    created_at: true,
    updated_at: true,
    ref_count: true,
}).extend({
    created_at: z.number().int().default(() => nowSec()),
    updated_at: z.number().int().default(() => nowSec()),
    ref_count: z.number().int().default(1),
    clock: z.number().int().default(0),
});
/**
 * Purpose:
 * Type alias for `FileMetaCreateSchema`.
 *
 * Behavior:
 * Represents validated file metadata creation payloads.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include binary data.
 */
export type FileMetaCreate = z.infer<typeof FileMetaCreateSchema>;

// notification actions
/**
 * `NotificationActionSchema`
 *
 * Purpose:
 * Defines the shape for notification actions.
 *
 * Behavior:
 * Validates action kind and optional target metadata.
 *
 * Constraints:
 * - Target fields are optional and may be partial.
 *
 * Non-Goals:
 * - Does not enforce route or thread validity.
 */
export const NotificationActionSchema = z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(['navigate', 'callback']),
    target: z
        .object({
            threadId: z.string().optional(),
            documentId: z.string().optional(),
            route: z.string().optional(),
        })
        .optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});
/**
 * Purpose:
 * Type alias for `NotificationActionSchema`.
 *
 * Behavior:
 * Represents validated notification action objects.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include execution logic.
 */
export type NotificationAction = z.infer<typeof NotificationActionSchema>;

// notifications
/**
 * `NotificationSchema`
 *
 * Purpose:
 * Defines the shape for notification records stored in IndexedDB.
 *
 * Behavior:
 * Validates notification metadata, actions, and timestamps.
 *
 * Constraints:
 * - Wire format uses snake_case field names.
 *
 * Non-Goals:
 * - Does not enforce authorization for notification creation.
 */
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
});
/**
 * Purpose:
 * Type alias for `NotificationSchema`.
 *
 * Behavior:
 * Represents validated notification rows in TypeScript.
 *
 * Constraints:
 * - Matches the schema exactly.
 *
 * Non-Goals:
 * - Does not include derived UI state.
 */
export type Notification = z.infer<typeof NotificationSchema>;

/**
 * `NotificationCreateSchema`
 *
 * Purpose:
 * Defines the input shape for creating notifications.
 *
 * Behavior:
 * Supplies defaults for ids and timestamps while allowing partial inputs.
 *
 * Constraints:
 * - Uses `z.input` so callers can omit defaulted fields.
 *
 * Non-Goals:
 * - Does not enforce delivery semantics.
 */
export const NotificationCreateSchema = NotificationSchema.partial({
    id: true,
    workspace_id: true,
    read_at: true,
    deleted: true,
    deleted_at: true,
})
    .omit({ created_at: true, updated_at: true, clock: true })
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
        created_at: z.number().int().default(() => nowSec()),
        updated_at: z.number().int().default(() => nowSec()),
    });
/**
 * Purpose:
 * Type alias for `NotificationCreateSchema` inputs.
 *
 * Behavior:
 * Represents caller-provided notification creation payloads.
 *
 * Constraints:
 * - Defaults are applied in schema parsing.
 *
 * Non-Goals:
 * - Does not include delivery metadata.
 */
export type NotificationCreate = z.input<typeof NotificationCreateSchema>;
