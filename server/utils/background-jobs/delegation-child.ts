import { DelegationDefaultsSchema, DelegationWaitSchema } from '~~/shared/chat/delegation-checkpoint';
import { delegationAdmissionFingerprint, delegationChildIdentities } from '~~/shared/chat/delegation-identities';
import { getScopedAdmissionKey } from './admission-cancels';
import { prepareBackgroundHistory } from './admission-history';
import { getChatJobExecution, type BackgroundJob, type CreateJobParams } from './types';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { assertUtf8Limit } from '~~/shared/chat/tool-limits';
import { toolDefinitionEquals } from '~~/shared/chat/tool-policy';
import { validateToolDefinitions } from '~~/shared/chat/tool-schema';
import { getServerTool } from '../chat/tool-registry';
import { deriveThreadTitle } from '../../../app/utils/chat/thread-title';

/** A saved tool can no longer be safely executed by the current server. */
export class DelegationToolUnavailableError extends Error {}

function assertDelegationRequest(body: Record<string, unknown>, task: string, parentBody: Record<string, unknown>, defaults: unknown): void {
    if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 || !Array.isArray(body.messages) || !body.messages.length ||
        Object.keys(body).some(key => key.startsWith('_') && !['_context', '_toolRuntime'].includes(key)))
        throw new Error('Invalid delegated request');
    const messages = body.messages as unknown[];
    const prompt = messages.at(-1);
    const isInstruction = (value: unknown): boolean => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const message = value as Record<string, unknown>;
        if (!['system', 'developer'].includes(String(message.role)) || Object.keys(message).some(key => key !== 'role' && key !== 'content')) return false;
        return typeof message.content === 'string' || (Array.isArray(message.content) && message.content.every(part =>
            part && typeof part === 'object' && !Array.isArray(part) && part.type === 'text' && typeof part.text === 'string' &&
            Object.keys(part).every(key => key === 'type' || key === 'text')));
    };
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt) ||
        (prompt as Record<string, unknown>).role !== 'user' || (prompt as Record<string, unknown>).content !== task ||
        Object.keys(prompt).some(key => key !== 'role' && key !== 'content') || messages.slice(0, -1).some(message => !isInstruction(message)))
        throw new Error('Delegated request must contain only its task and effective instructions');
    const captured = DelegationDefaultsSchema.parse(defaults);
    const supplied = DelegationDefaultsSchema.parse({ version: 1, instructions: messages.slice(0, -1) });
    if (JSON.stringify(supplied.instructions) !== JSON.stringify(captured.instructions))
        throw new Error('Delegated instructions do not match the captured parent defaults');
    const readHints = (value: unknown): Record<string, unknown> => {
        if (value === undefined) return {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid delegated tool runtime');
        return value as Record<string, unknown>;
    };
    const hints = readHints(body._toolRuntime);
    const parentHints = readHints(parentBody._toolRuntime);
    const tools = validateToolDefinitions(body.tools ?? []);
    const parentTools = validateToolDefinitions(parentBody.tools ?? []);
    if (!tools.valid) throw new Error(tools.error);
    if (!parentTools.valid) throw new Error('Invalid parent tool admission');
    const names = new Set(tools.value.map(definition => definition.function.name));
    if (Object.keys(hints).some(name => !names.has(name) || !['server', 'hybrid'].includes(String(hints[name]))))
        throw new Error('Invalid delegated tool runtime');
    for (const definition of tools.value) {
        const name = definition.function.name;
        const admitted = parentTools.value.find(candidate => candidate.function.name === name);
        const registered = getServerTool(name);
        if (!admitted || !toolDefinitionEquals(admitted, definition) || parentHints[name] === 'client' ||
            (hints[name] !== undefined && parentHints[name] !== undefined && hints[name] !== parentHints[name]))
            throw new Error(`Delegated tool "${name}" was not admitted by the parent`);
        if (name === DELEGATE_CHAT_TOOL) throw new Error('Recursive delegation is unavailable');
        if (!registered || registered.runtime === 'client' || !toolDefinitionEquals(registered.definition, definition))
            throw new DelegationToolUnavailableError(`Delegated tool "${name}" is unavailable on the server`);
    }
}

/** Construct the immutable new-chat envelope after model, tool and context preparation. */
export function prepareNewDelegationChild(parent: BackgroundJob, input: {
    callId: string; index: number; task: string; body: Record<string, unknown>; createdAt: number;
}): CreateJobParams {
    const execution = getChatJobExecution(parent);
    if (!execution || parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined ||
        execution.delegationRecoveryPolicy !== 'v1' || !parent.generationId || !parent.syncProviderId)
        throw new Error('Delegation parent cannot prepare a child');
    if (typeof input.task !== 'string' || !input.task.trim() || input.task !== input.task.trim() || input.task.length > 20_000 ||
        !Number.isSafeInteger(input.createdAt) || input.createdAt < 0)
        throw new Error('Invalid delegated task');
    assertUtf8Limit(input.task, 64 * 1024, 'Delegated task');
    const body = JSON.parse(JSON.stringify(input.body)) as Record<string, unknown>;
    assertUtf8Limit(JSON.stringify(body), 200 * 1024, 'Delegated request');
    assertDelegationRequest(body, input.task, execution.body, execution.delegationDefaults);
    const ids = delegationChildIdentities({ userId: parent.userId, workspaceId: execution.workspaceId,
        parentGenerationId: parent.generationId, callId: input.callId, index: input.index });
    const seconds = Math.floor(input.createdAt / 1000);
    const timestamp = input.createdAt.toString(36).padStart(9, '0');
    const node = ids.generationId.slice(-8);
    const threadHlc = `${timestamp}:000:${node}`;
    const userHlc = `${timestamp}:001:${node}`;
    const assistantHlc = `${timestamp}:002:${node}`;
    const history = prepareBackgroundHistory({ version: 1, kind: 'new-turn', admissionId: ids.admissionId,
        generationId: ids.generationId, workspaceId: execution.workspaceId, threadId: ids.threadId, messageId: ids.assistantMessageId,
        thread: { id: ids.threadId, title: deriveThreadTitle(input.task), status: 'ready', pinned: false, deleted: false,
            created_at: seconds, updated_at: seconds, clock: 1, hlc: threadHlc },
        userMessage: { id: ids.userMessageId, thread_id: ids.threadId, role: 'user', index: 0, order_key: userHlc,
            data: { content: input.task }, pending: false, deleted: false, created_at: seconds, updated_at: seconds, clock: 1, hlc: userHlc },
        assistantMessage: { id: ids.assistantMessageId, thread_id: ids.threadId, role: 'assistant', index: 1, order_key: assistantHlc,
            data: { content: '', generation_id: ids.generationId, generation_mode: 'background', generation_state: 'streaming', background_history_version: 1, delegated_model: body.model },
            pending: true, deleted: false, created_at: seconds, updated_at: seconds, clock: 1, hlc: assistantHlc },
    }, { admissionId: ids.admissionId, workspaceId: execution.workspaceId, threadId: ids.threadId,
        messageId: ids.assistantMessageId, syncProviderId: parent.syncProviderId });
    return buildDelegationChildAdmission(parent, ids, body, JSON.parse(JSON.stringify(history)) as typeof history);
}

function buildDelegationChildAdmission(parent: BackgroundJob, ids: ReturnType<typeof delegationChildIdentities>,
    body: Record<string, unknown>, history: ReturnType<typeof prepareBackgroundHistory>): CreateJobParams {
    const execution = getChatJobExecution(parent)!;
    return {
        userId: parent.userId, threadId: ids.threadId, messageId: ids.assistantMessageId,
        model: String(body.model), kind: 'chat', syncProviderId: parent.syncProviderId,
        idempotencyKey: getScopedAdmissionKey(parent.userId, execution.workspaceId, ids.admissionId),
        generationId: ids.generationId, historyPhase: 'admission_pending',
        execution: { version: 1, body, workspaceId: execution.workspaceId, referer: execution.referer,
            apiKeyCiphertext: execution.apiKeyCiphertext, credentialSource: execution.credentialSource,
            history, contentBase: '', reasoningBase: '', checkpointedToolCallIds: [], delegationRecoveryPolicy: 'v1' },
    };
}

/** Rebuild a parked child solely from the parent's authority and immutable snapshot. */
export function reconstructDelegationChild(parent: BackgroundJob, index: number, options?: { allowSettled?: boolean }): CreateJobParams {
    const execution = getChatJobExecution(parent);
    if (!execution || parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined ||
        execution.delegationRecoveryPolicy !== 'v1' || !parent.generationId || !parent.syncProviderId)
        throw new Error('Delegation parent cannot admit a child');
    const wait = DelegationWaitSchema.parse(execution.delegationWait);
    const child = wait.children[index];
    if (!child || child.kind !== 'prepared' || child.index !== index ||
        (child.settlement && !options?.allowSettled))
        throw new Error('Delegation child is not eligible for admission');
    const ids = delegationChildIdentities({ userId: parent.userId, workspaceId: execution.workspaceId,
        parentGenerationId: parent.generationId, callId: wait.callId, index });
    if (child.admissionId !== ids.admissionId || child.threadId !== ids.threadId ||
        child.userMessageId !== ids.userMessageId || child.assistantMessageId !== ids.assistantMessageId)
        throw new Error('Delegation child identity is outside its parent scope');
    const history = prepareBackgroundHistory(child.admission.history, {
        admissionId: ids.admissionId, workspaceId: execution.workspaceId, threadId: ids.threadId,
        messageId: ids.assistantMessageId, syncProviderId: parent.syncProviderId,
    });
    if (history.kind !== 'new-turn' || history.generationId !== ids.generationId ||
        history.userMessage?.id !== ids.userMessageId ||
        delegationAdmissionFingerprint(history) !== delegationAdmissionFingerprint(child.admission.history as object))
        throw new Error('Delegation child history is inconsistent');
    const result = buildDelegationChildAdmission(parent, ids, child.admission.body, history);
    if (delegationAdmissionFingerprint(result) !== child.admissionFingerprint)
        throw new Error('Delegation child admission does not match its checkpoint');
    // A linked job already passed admission. Its history must remain reconcilable
    // even if a tool is unregistered while that job is finishing.
    if (!child.jobId) assertDelegationRequest(child.admission.body, child.request.task, execution.body, execution.delegationDefaults);
    return result;
}
