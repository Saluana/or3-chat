import { z } from 'zod';

export const PROJECT_POST_TYPES = {
    settings: 'or3:project-settings',
    memory: 'or3:project-memory',
    source: 'or3:project-source',
} as const;
export const ContextModeSchema = z.enum(['relevant', 'always', 'off']);
export const ProjectToolRuleSchema = z
    .object({
        mode: z.enum(['enabled', 'disabled', 'ask']),
        resources: z
            .array(z.string().trim().min(1).max(500))
            .max(20)
            .default([]),
    })
    .strict();
export const ProjectSettingsSchema = z
    .object({
        version: z.literal(1),
        pinned: z.boolean().default(false),
        instructions: z.string().max(16000),
        brief: z.string().max(8000),
        default_model: z.string().max(200).nullable(),
        tools: z.record(z.string().max(200), ProjectToolRuleSchema),
        excluded_chat_ids: z.array(z.string().min(1).max(200)).max(1000),
    })
    .strict();
export const defaultProjectSettings = (): ProjectSettings => ({
    version: 1,
    pinned: false,
    instructions: '',
    brief: '',
    default_model: null,
    tools: {},
    excluded_chat_ids: [],
});
export const ProjectMemorySchema = z
    .object({
        version: z.literal(1).default(1),
        text: z.string().trim().min(1).max(4000),
        kind: z.enum(['fact', 'decision']).default('fact'),
        origin: z.literal('automatic').optional(),
        source_message_id: z.string().min(1).max(200).optional(),
        source_thread_id: z.string().min(1).max(200).optional(),
    })
    .strict();
export const SourceRevisionSchema = z
    .object({
        id: z.string().min(1).max(200),
        item_id: z.string().min(1).max(200).optional(),
        original_hash: z.string().min(1).max(100).optional(),
        text_hash: z.string().min(1).max(100).optional(),
        status: z.enum(['processing', 'ready', 'partial', 'failed']),
        coverage: z.enum(['full', 'prefix', 'none']),
        error: z.string().max(500).optional(),
        created_at: z.number().int().nonnegative(),
        processing_started_at: z.number().int().nonnegative().optional(),
        locations: z
            .array(
                z
                    .object({
                        label: z.string().max(100),
                        start: z.number().int().nonnegative(),
                        end: z.number().int().nonnegative(),
                    })
                    .strict(),
            )
            .max(1000)
            .default([]),
    })
    .strict();
export const ProjectSourceSchema = z
    .object({
        version: z.literal(1).default(1),
        item_id: z.string().min(1).max(200),
        kind: z.enum(['file', 'document']),
        title: z.string().trim().min(1).max(500),
        mode: ContextModeSchema.default('relevant'),
        current_revision_id: z.string().min(1).max(200),
        revisions: z.array(SourceRevisionSchema).min(1).max(100),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (
            !value.revisions.some((r) => r.id === value.current_revision_id) ||
            new Set(value.revisions.map((r) => r.id)).size !==
                value.revisions.length
        )
            ctx.addIssue({
                code: 'custom',
                message: 'Source revision identity is invalid.',
            });
    });
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;
export type ProjectMemoryInput = z.input<typeof ProjectMemorySchema>;
export type ProjectSource = z.infer<typeof ProjectSourceSchema>;
export type ProjectSourceInput = z.input<typeof ProjectSourceSchema>;
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;
export type ContextMode = z.infer<typeof ContextModeSchema>;

const ReceiptStateSchema = z.enum(['available', 'retrieved', 'included']);
export const ProjectContextReceiptSchema = z.object({
    version: z.literal(1),
    project_id: z.string(),
    project_name: z.string(),
    available_source_count: z.number().int().nonnegative().optional(),
    instructions: z.string(),
    brief: z.string(),
    instructions_included: z.boolean().optional(),
    brief_included: z.boolean().optional(),
    chats: z
        .array(
            z.object({
                thread_id: z.string(),
                message_id: z.string(),
                text: z.string(),
                state: ReceiptStateSchema,
            }),
        )
        .optional(),
    memories: z.array(
        z.object({ id: z.string(), text: z.string(), kind: z.string() }),
    ),
    sources: z.array(
        z.object({
            id: z.string(),
            item_id: z.string(),
            kind: z.string(),
            title: z.string(),
            revision: z.string(),
            state: ReceiptStateSchema,
            excerpt: z.string().optional(),
            reason: z.string().optional(),
            image: z.boolean().optional(),
        }),
    ),
});
export const ProjectContextIterationSchema = z.object({
    project_id: z.string(),
    request_id: z.string().optional(),
    request_state: z.enum(['prepared', 'dispatched', 'accepted', 'failed']).optional(),
    instructions: z.boolean(),
    brief: z.boolean(),
    memory_count: z.number().int().nonnegative(),
    source_changes: z.array(
        z.object({
            id: z.string(),
            revision: z.string(),
            state: ReceiptStateSchema,
        }),
    ),
    chat_changes: z.array(
        z.object({ id: z.string(), state: ReceiptStateSchema }),
    ),
});
export type ProjectContextReceipt = z.infer<typeof ProjectContextReceiptSchema>;
export type ProjectContextIteration = z.infer<
    typeof ProjectContextIterationSchema
>;
