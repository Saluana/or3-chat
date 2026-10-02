import { z } from 'zod';

const identifier = z.string().min(1);
const counter = z.number().int().nonnegative().safe();
export const RequestUsageSchema = z.object({
    prompt_tokens: counter, completion_tokens: counter, model: identifier,
    request_id: identifier, iteration: counter, measured_at: counter,
    prefix_message_count: counter, prefix_hash: identifier,
    configuration_hash: identifier, input_estimate_tokens: counter,
});
export type RequestUsage = z.infer<typeof RequestUsageSchema>;

export const HistoryScopeSchema = z.object({
    version: z.literal(1),
    segments: z.array(z.object({ thread_id: identifier,
        messages: z.array(z.object({ message_id: identifier, clock: counter })) })),
    inherited_scope_message_id: identifier.optional(),
});
export type HistoryScope = z.infer<typeof HistoryScopeSchema>;

export const CompactionDataSchema = z.object({
    version: z.literal(1), compaction_id: identifier, source_thread_id: identifier,
    anchor_message_id: identifier, anchor_index: z.number().int().safe(),
    generated_at: counter, model: identifier, message_count: counter, prior_message_count: counter,
    summary_markdown: z.string().min(1),
    landmarks: z.array(z.object({ message_id: identifier,
        kind: z.enum(['decision', 'code', 'file', 'constraint', 'open-question', 'tool-result']),
        summary: z.string().min(1).refine((value) => Array.from(value).length <= 200, 'Landmark description exceeds 200 characters.'),
        index: z.number().int().safe(), role: z.enum(['user', 'assistant', 'system', 'tool']), thread_id: identifier,
    })).max(30),
    history_scope: HistoryScopeSchema,
});
export type CompactionData = z.infer<typeof CompactionDataSchema>;

/** Unknown/future host metadata remains unavailable; malformed usage never fails valid text. */
export function readRequestUsage(value: unknown): RequestUsage | undefined {
    const parsed = RequestUsageSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}
export function readCompactionData(value: unknown): CompactionData | undefined {
    const parsed = CompactionDataSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}
