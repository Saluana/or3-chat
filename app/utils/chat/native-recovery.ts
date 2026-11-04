import type { Or3DB } from '~/db/client';
import Dexie from 'dexie';
import { sha256Hex } from '~~/shared/runtime-crypto';
import type { SendMessageParams, ToolDefinition } from './types';
import type { ORMessage } from '~/core/auth/openrouter-build';
import { resolveThreadProjection } from './compaction/history';
import type { DelegationDefaults } from '~~/shared/chat/delegation-checkpoint';

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
    messages: Array<ORMessage | { role: 'tool'; [key: string]: unknown }>;
    tools: ToolDefinition[];
    /** Previously captured effective instructions; absent for unsupported preparation. */
    delegation_defaults?: DelegationDefaults;
    project_fingerprint?: string;
    /** Effective outgoing prompt/paste used for the admitted project retrieval. */
    project_query?: string;
}
async function fingerprint(value: unknown): Promise<string> {
    const pending = sha256Hex(JSON.stringify(value));
    return (Dexie.currentTransaction as typeof Dexie.currentTransaction | undefined) ? Dexie.waitFor(pending) : pending;
}
export function recoveryProjectFingerprint(context: import('~/utils/projects/types').ProjectContextSnapshot): Promise<string> {
    return fingerprint(context);
}
export function recoveryInputFingerprint(content: string, params: SendMessageParams): Promise<string> {
    return fingerprint({ content, files: params.files ?? [], hashes: params.file_hashes ?? [],
        text: params.extraTextParts ?? [], context: params.context_hashes ?? [], editor: params.editorDoc ?? null });
}
export async function recoverySourceFingerprint(db: Or3DB, threadId: string, assistantId: string, masterPrompt: unknown, taskPrompt?: unknown): Promise<string> {
    const projection = await resolveThreadProjection(threadId, db);
    return fingerprint({ masterPrompt: masterPrompt ?? '', taskPrompt: taskPrompt ?? '', segments: projection.segments.map(({ thread, rows }) => ({
        thread: { id: thread.id, parent: thread.parent_thread_id, anchor: thread.anchor_message_id,
            mode: thread.branch_mode, project: thread.project_id, summary: thread.summary_message_id, prompt: thread.system_prompt_id, deleted: thread.deleted },
        rows: rows.filter((row) => row.id !== assistantId).map((row) => ({ id: row.id, clock: row.clock,
            index: row.index, order_key: row.order_key, deleted: row.deleted, pending: row.pending, data: row.data, file_hashes: row.file_hashes })),
    })) });
}

/**
 * A checkpoint is written before inference and cleared when its request
 * settles here. A reload or crash mid-generation leaves it behind while its
 * turn fails another way; that turn must use ordinary retry and sending.
 */
export async function discardStaleRecovery(db: Or3DB, checkpoint: NativeRecoveryCheckpoint): Promise<boolean> {
    const saved = await db.messages.get(checkpoint.assistant_message_id);
    if (saved && !saved.deleted && (saved.pending || (saved.error === 'context_full'
        && (saved.data as Record<string, unknown> | null)?.request_id === checkpoint.request_id))) return false;
    await db.transaction('rw', db.chat_request_recoveries, async () => {
        const current = await db.chat_request_recoveries.get(checkpoint.thread_id);
        if (current?.request_id === checkpoint.request_id) await db.chat_request_recoveries.delete(checkpoint.thread_id);
    });
    return true;
}

/** Capture the existing checkpoint before a native request can reach a provider. */
export async function saveNativeRecoveryCheckpoint(input: {
    db: Or3DB;
    requestId: string;
    threadId: string;
    userMessageId: string;
    assistantMessageId: string;
    savedInput: SendMessageParams & { content: string };
    messages: NativeRecoveryCheckpoint['messages'];
    tools: ToolDefinition[];
    delegationDefaults?: DelegationDefaults;
    projectContext: () => import('~/utils/projects/types').ProjectContextSnapshot | null | undefined;
    projectQuery?: string;
    masterPrompt: () => unknown;
    taskPrompt: () => unknown;
    cancelled: () => boolean;
}): Promise<NativeRecoveryCheckpoint> {
    const checkpoint: NativeRecoveryCheckpoint = {
        version: 1, request_id: input.requestId, thread_id: input.threadId,
        user_message_id: input.userMessageId, assistant_message_id: input.assistantMessageId,
        input: structuredClone(input.savedInput),
        input_fingerprint: await recoveryInputFingerprint(input.savedInput.content, input.savedInput),
        source_fingerprint: await recoverySourceFingerprint(input.db, input.threadId, input.assistantMessageId,
            input.masterPrompt(), input.taskPrompt()),
        messages: structuredClone(input.messages), tools: structuredClone(input.tools),
        ...(input.delegationDefaults ? { delegation_defaults: structuredClone(input.delegationDefaults) } : {}),
        ...(input.projectContext() ? { project_fingerprint: await recoveryProjectFingerprint(input.projectContext()!),
            project_query: input.projectQuery } : {}),
    };
    await input.db.transaction('rw', input.db.threads, input.db.messages, input.db.chat_request_recoveries, async () => {
        const thread = await input.db.threads.get(input.threadId);
        const assistant = await input.db.messages.get(input.assistantMessageId);
        if (!thread || thread.deleted || !assistant || assistant.deleted || !assistant.pending
            || (assistant.data as Record<string, unknown> | null)?.generation_lease_id !== input.requestId
            || input.cancelled()) throw new Error('The saved attempt changed before native recovery could be recorded.');
        await input.db.chat_request_recoveries.put(checkpoint);
    });
    return checkpoint;
}
