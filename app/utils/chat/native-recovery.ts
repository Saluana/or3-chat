import type { Or3DB } from '~/db/client';
import type { SendMessageParams, ToolDefinition } from './types';
import type { OpenRouterMessage } from './useAi-internal/types';
import { resolveThreadProjection } from './compaction/history';

/** Local-only final native payload. Never synchronized or a delegated intent. */
export interface NativeRecoveryCheckpoint {
    thread_id: string;
    version: 1;
    request_id: string;
    user_message_id: string;
    assistant_message_id: string;
    input: SendMessageParams & { content: string };
    input_fingerprint: string;
    source_fingerprint: string;
    messages: OpenRouterMessage[];
    tools: ToolDefinition[];
}
async function fingerprint(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function recoveryInputFingerprint(content: string, params: SendMessageParams): Promise<string> {
    return fingerprint({ content, files: params.files ?? [], hashes: params.file_hashes ?? [],
        text: params.extraTextParts ?? [], context: params.context_hashes ?? [], editor: params.editorDoc ?? null });
}
export async function recoverySourceFingerprint(db: Or3DB, threadId: string, assistantId: string, masterPrompt: unknown, taskPrompt?: unknown): Promise<string> {
    const projection = await resolveThreadProjection(threadId, db);
    return fingerprint({ masterPrompt: masterPrompt ?? '', taskPrompt: taskPrompt ?? '', segments: projection.segments.map(({ thread, rows }) => ({
        thread: { id: thread.id, parent: thread.parent_thread_id, anchor: thread.anchor_message_id,
            mode: thread.branch_mode, summary: thread.summary_message_id, prompt: thread.system_prompt_id, deleted: thread.deleted },
        rows: rows.filter((row) => row.id !== assistantId).map((row) => ({ id: row.id, clock: row.clock,
            index: row.index, order_key: row.order_key, deleted: row.deleted, pending: row.pending, data: row.data, file_hashes: row.file_hashes })),
    })) });
}
