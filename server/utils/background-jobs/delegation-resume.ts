import { createHash } from 'node:crypto';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { DelegationActivitySchema, DelegationWaitSchema } from '~~/shared/chat/delegation-checkpoint';
import { canonicalToolResult } from '~~/shared/chat/canonical-tool-transcript';
import { settleNormalizedTool } from '~~/shared/chat/normalized-stream-reducer';
import { matchesToolResultStorage, parseToolResultArtifact } from '~~/shared/chat/tool-result-artifact';
import { toolCallFingerprint } from '~~/shared/chat/tool-ledger';
import { assertUtf8Limit, MAX_TOOL_DURABLE_RESULT_BYTES, projectToolResult } from '~~/shared/chat/tool-limits';
import { getChatJobExecution, type BackgroundJob, type DelegationResume } from './types';

const encoder = new TextEncoder();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// A child remains available in canonical history; this limits the model-facing
// extract and accounts for JSON escaping, including control characters.
function excerpt(value: string): { content: string; truncated: boolean } {
    let content = '', bytes = 0, count = 0;
    for (const point of value) {
        const size = encoder.encode(JSON.stringify(point)).length - 2;
        if (count >= 18_000 || bytes + size > 24 * 1024) return { content, truncated: true };
        content += point; bytes += size; count += 1;
    }
    return { content, truncated: false };
}

/** Build one checkpoint from the recorded wait; this function does no writes. */
export function buildDelegationResume(job: BackgroundJob, input: Pick<DelegationResume, 'resolvedResults' | 'durableResult' | 'unavailableChildren'>) {
    const execution = getChatJobExecution(job);
    if (job.status !== 'streaming' || !execution || execution.cancellationRequestedAt !== undefined)
        throw new Error('Delegation parent cannot resume');
    const wait = DelegationWaitSchema.parse(execution.delegationWait);
    const pending = execution.pendingToolCalls;
    const current = pending?.[0];
    if (!current || current.id !== wait.callId || current.function.name !== DELEGATE_CHAT_TOOL ||
        pending.filter(call => call.id === wait.callId).length !== 1 ||
        toolCallFingerprint(current.function.name, current.function.arguments) !== wait.argumentFingerprint ||
        execution.checkpointedToolCallIds?.includes(wait.callId))
        throw new Error('Delegation tool checkpoint is inconsistent');
    let argumentsValue: unknown;
    try { argumentsValue = JSON.parse(current.function.arguments); } catch { throw new Error('Invalid delegation tool arguments'); }
    if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue))
        throw new Error('Invalid delegation tool arguments');
    const args = argumentsValue as Record<string, unknown>;
    const tasks = Array.isArray(args.tasks) ? args.tasks : null;
    const batch = tasks !== null;
    if ((tasks && tasks.length !== wait.children.length) || (!batch && wait.children.length !== 1))
        throw new Error('Delegation batch does not match its checkpoint');
    const calls = job.tool_calls ?? [];
    const matching = calls.filter(call => call.id === wait.callId);
    const call = matching[0];
    const normalized = execution.normalizedToolState;
    if (matching.length !== 1 || !call || call.name !== DELEGATE_CHAT_TOOL ||
        !['pending', 'loading'].includes(call.status) || call.argument_fingerprint !== wait.argumentFingerprint ||
        call.args !== current.function.arguments ||
        !normalized?.tools[wait.callId] || !['pending', 'loading'].includes(normalized.tools[wait.callId]!.status) ||
        normalized.tools[wait.callId]!.name !== DELEGATE_CHAT_TOOL ||
        normalized.tools[wait.callId]!.arguments !== current.function.arguments)
        throw new Error('Delegation ledger is inconsistent');
    const messages = Array.isArray(execution.body.messages) ? execution.body.messages.slice() : [];
    const pendingIds = new Set(pending.map(item => item.id));
    if (messages.some(message => {
        if (!message || typeof message !== 'object') return false;
        const record = message as Record<string, unknown>;
        return record.role === 'tool' && typeof record.tool_call_id === 'string' && pendingIds.has(record.tool_call_id);
    }))
        throw new Error('Delegation result is already checkpointed');
    const matchingAssistantCalls = messages.flatMap(message => {
        if (!message || typeof message !== 'object') return [];
        const record = message as Record<string, unknown>;
        if (record.role !== 'assistant' || !Array.isArray(record.tool_calls)) return [];
        return record.tool_calls.filter(entry => entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === wait.callId);
    });
    const assistantCall = matchingAssistantCalls[0] as { type?: unknown; function?: { name?: unknown; arguments?: unknown } } | undefined;
    if (matchingAssistantCalls.length !== 1 || assistantCall?.type !== 'function' ||
        assistantCall.function?.name !== current.function.name || assistantCall.function.arguments !== current.function.arguments)
        throw new Error('Delegation assistant call is inconsistent');
    const assistantIndex = messages.findIndex(message => message && typeof message === 'object' &&
        (message as Record<string, unknown>).role === 'assistant' &&
        Array.isArray((message as Record<string, unknown>).tool_calls) &&
        ((message as Record<string, unknown>).tool_calls as Array<{ id?: unknown }>).some(entry => entry?.id === wait.callId));
    const assistant = messages[assistantIndex] as { tool_calls: Array<{ id?: unknown }> };
    const assistantIds = assistant.tool_calls.map(entry => entry?.id);
    const currentIndex = assistantIds.indexOf(wait.callId);
    const priorResults = messages.slice(assistantIndex + 1);
    if (assistantIds.some(id => typeof id !== 'string') || new Set(assistantIds).size !== assistantIds.length ||
        currentIndex < 0 || assistantIds.length - currentIndex !== pending.length ||
        pending.some((item, index) => item.id !== assistantIds[currentIndex + index]) ||
        priorResults.length !== currentIndex || priorResults.some((message, index) =>
            !message || typeof message !== 'object' || (message as Record<string, unknown>).role !== 'tool' ||
            (message as Record<string, unknown>).tool_call_id !== assistantIds[index]))
        throw new Error('Delegation transcript order is inconsistent');

    const unavailable = new Map((input.unavailableChildren ?? []).map(item => [item.index, item.code]));
    if (unavailable.size !== (input.unavailableChildren?.length ?? 0) || [...unavailable].some(([index, code]) => {
        const child = wait.children[index];
        return !Number.isSafeInteger(index) || index < 0 || index >= wait.children.length ||
            (code !== 'history_unavailable' && code !== 'result_unavailable') ||
            child?.kind !== 'prepared' || !child.jobId || !child.settlement ||
            child.settlement.kind === 'unavailable' ||
            (code === 'result_unavailable' && child.settlement.kind !== 'complete');
    }))
        throw new Error('Invalid unavailable delegation children');
    const outcomes = wait.children.map(child => {
        const settlement = child.settlement;
        if (!settlement) throw new Error('Delegation children are not settled');
        const base = { index: child.index, ...(child.kind === 'prepared' && child.jobId ? { threadId: child.threadId } : {}),
            ...(child.kind === 'prepared' ? { model: child.request.model } : {}), status: settlement.kind };
        if (unavailable.has(child.index)) return { ...base, status: 'unavailable', code: unavailable.get(child.index),
            ...(settlement.kind === 'unknown' ? { executionUncertain: true } : {}) };
        if (settlement.kind !== 'complete') return { ...base, code: settlement.code };
        let content: string;
        if (settlement.result.kind === 'inline') {
            content = settlement.result.value;
        } else {
            const artifact = parseToolResultArtifact(settlement.result.reference);
            const resolved = input.resolvedResults?.[child.index];
            if (!artifact || typeof resolved !== 'string') throw new Error('Delegation child result is unavailable or corrupt');
            assertUtf8Limit(resolved, MAX_TOOL_DURABLE_RESULT_BYTES, 'Delegation child result');
            if (digest(resolved) !== artifact.sha256 || !matchesToolResultStorage(settlement.result.reference, resolved,
                { threadId: job.threadId, parentAssistantId: job.messageId, callId: `${wait.callId}:child:${child.index}` }))
                throw new Error('Delegation child result is unavailable or corrupt');
            content = resolved;
        }
        return { ...base, ...excerpt(content) };
    });
    const activity = DelegationActivitySchema.parse({ version: 1, callId: wait.callId,
        children: wait.children.map(child => ({ index: child.index,
            ...(child.kind === 'prepared' && child.jobId ? { threadId: child.threadId } : {}),
            ...(child.kind === 'prepared' ? { modelName: child.request.model } : {}), outcome: unavailable.has(child.index) ? 'unavailable' : child.settlement!.kind,
            ...(unavailable.has(child.index) && child.settlement?.kind === 'unknown' ? { executionUncertain: true as const } : {}) })) });
    const rawResult = JSON.stringify(batch ? { results: outcomes } : outcomes[0]);
    const projected = projectToolResult(rawResult);
    const durable = input.durableResult ?? projected.durable;
    if (durable !== projected.durable) {
        if (!matchesToolResultStorage(durable, rawResult,
            { threadId: job.threadId, parentAssistantId: job.messageId, callId: wait.callId }))
            throw new Error('Delegation aggregate artifact is inconsistent');
    }
    messages.push({ role: 'tool', tool_call_id: wait.callId, name: DELEGATE_CHAT_TOOL,
        content: [{ type: 'text', text: projected.model }] });
    const remaining = pending.slice(1);
    const nextExecution = { ...execution, body: { ...execution.body, messages },
        delegationWait: undefined, delegationBlocked: execution.delegationBlocked || wait.children.some(child => child.settlement?.kind === 'unknown'),
        pendingToolCalls: remaining.length ? remaining : undefined,
        checkpointedToolCallIds: [...(execution.checkpointedToolCallIds ?? []), wait.callId],
        normalizedToolState: settleNormalizedTool(normalized, wait.callId, { status: 'complete', result: durable }) };
    const toolCalls: BackgroundJob['tool_calls'] = calls.map(item => item.id !== wait.callId ? item : {
        ...item, status: 'complete', result: durable, error: undefined, delegation: activity,
        transcript: canonicalToolResult({ turnId: job.messageId, parentAssistantId: job.messageId, callId: wait.callId,
            toolName: DELEGATE_CHAT_TOOL, fingerprint: wait.argumentFingerprint, status: 'complete', result: durable }),
    });
    return { rawResult, execution: nextExecution, toolCalls, activity };
}
