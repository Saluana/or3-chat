import { projectBackgroundWorkflowState } from '~~/shared/chat/background-workflow-state';
import { readRequestUsage } from '~~/shared/chat/compaction';
import { DELEGATE_CHAT_TOOL } from '~~/shared/chat/delegation';
import { DelegationLiveActivitySchema, DelegationWaitSchema } from '~~/shared/chat/delegation-checkpoint';
import { toolCallFingerprint } from '~~/shared/chat/tool-ledger';
import { delegationAdmissionFingerprint } from '~~/shared/chat/delegation-identities';
import { normalizeError } from '~~/shared/errors';
import { reconstructDelegationChild } from './delegation-child';
import { getChatJobExecution, type BackgroundJob, type BackgroundJobProvider } from './types';
import type { getJobLiveState } from './viewers';

type LiveState = NonNullable<ReturnType<typeof getJobLiveState>>;

/** Select the viewer-visible state without reading or mutating either source. */
export function projectJobView(job: BackgroundJob, rawLive?: LiveState | null) {
    const canonicalAttempt = job.attempts ?? 0;
    const live = rawLive && (rawLive.attempt === undefined || rawLive.attempt >= canonicalAttempt)
        ? rawLive : undefined;
    const attempt = live?.attempt ?? canonicalAttempt;
    const advanced = attempt > canonicalAttempt;
    const content = live && (advanced || live.content.length > job.content.length)
        ? live.content : job.content;
    const reasoning = live && (advanced || live.reasoning.length > job.reasoning.length)
        ? live.reasoning : job.reasoning;
    const status = live && (advanced || live.status !== 'streaming') ? live.status : job.status;
    const liveUsage = readRequestUsage(live?.usage);
    const canonicalUsage = advanced ? undefined : readRequestUsage(job.usage);
    const usage = liveUsage && (!canonicalUsage || liveUsage.iteration >= canonicalUsage.iteration)
        ? liveUsage : canonicalUsage;
    const workflow = advanced || live?.workflow_state !== undefined ? live?.workflow_state : job.workflow_state;
    let toolCalls = advanced || live?.tool_calls !== undefined ? live?.tool_calls : job.tool_calls;
    // Only the bounded, credential-free view leaves the server. The wait is
    // private and its links are usable only after normal workspace sync.
    const wait = !advanced && status === 'streaming'
        ? DelegationWaitSchema.safeParse(getChatJobExecution(job)?.delegationWait) : undefined;
    if (wait?.success && toolCalls) {
        const matches = toolCalls.filter(call => call.id === wait.data.callId);
        const call = matches[0];
        if (matches.length === 1 && call?.name === DELEGATE_CHAT_TOOL && typeof call.args === 'string' &&
            toolCallFingerprint(call.name, call.args) === wait.data.argumentFingerprint &&
            (call.status === 'pending' || call.status === 'loading')) {
            const activity = DelegationLiveActivitySchema.parse({ version: 2, callId: wait.data.callId,
                children: wait.data.children.map(child => ({ index: child.index,
                    ...(child.kind === 'prepared' && child.jobId ? { threadId: child.threadId } : {}),
                    ...(child.kind === 'prepared' ? { modelName: child.request.model } : {}),
                    outcome: child.settlement?.kind ?? (child.kind === 'prepared' && child.jobId ? 'working' : 'waiting'),
                })) });
            toolCalls = toolCalls.map(item => item === call ? { ...item, delegation: activity } : item);
        }
    }
    return {
        id: job.id, status, threadId: job.threadId, messageId: job.messageId,
        model: job.model, attempt, startedAt: job.startedAt,
        completedAt: advanced || live?.completedAt !== undefined ? live?.completedAt : job.completedAt,
        error: advanced || typeof live?.error === 'string' ? live?.error : job.error,
        chunksReceived: live && (advanced || live.chunksReceived > job.chunksReceived)
            ? live.chunksReceived : job.chunksReceived,
        tool_calls: toolCalls,
        workflow_state: projectBackgroundWorkflowState(status, workflow),
        usage, content, reasoning_text: reasoning,
    };
}

/** Add transient history labels from the exact admitted child jobs. */
export async function projectJobViewWithChildStatus(
    provider: BackgroundJobProvider, job: BackgroundJob, userId: string, rawLive?: LiveState | null,
): Promise<ReturnType<typeof projectJobView>> {
    const view = projectJobView(job, rawLive);
    const execution = getChatJobExecution(job);
    const wait = execution && DelegationWaitSchema.safeParse(execution.delegationWait);
    if (job.userId !== userId || !execution || !wait?.success || view.status !== 'streaming' ||
        view.attempt !== (job.attempts ?? 0) || !job.syncProviderId || !view.tool_calls) return view;
    const matching = view.tool_calls.filter(item => item.id === wait.data.callId);
    const call = matching[0];
    if (matching.length !== 1 || !call || call.name !== DELEGATE_CHAT_TOOL ||
        typeof call.args !== 'string' || toolCallFingerprint(call.name, call.args) !== wait.data.argumentFingerprint ||
        (call.status !== 'pending' && call.status !== 'loading') ||
        !call.delegation || call.delegation.version !== 2 || call.delegation.callId !== wait.data.callId) return view;
    const historyOutcomes = await Promise.all(wait.data.children.map(async child => {
        if (child.kind !== 'prepared' || !child.jobId || child.settlement) return undefined;
        try {
            const admitted = reconstructDelegationChild(job, child.index);
            const candidate = await provider.getJob(child.jobId, userId);
            const candidateExecution = candidate && getChatJobExecution(candidate);
            const admittedExecution = admitted.execution && getChatJobExecution({ execution: admitted.execution });
            const matches = !!candidate && !!candidateExecution?.history && !!admittedExecution?.history &&
                candidate.userId === userId && candidate.threadId === admitted.threadId && candidate.messageId === admitted.messageId &&
                candidate.generationId === admitted.generationId && candidate.syncProviderId === job.syncProviderId &&
                candidateExecution.workspaceId === execution.workspaceId &&
                delegationAdmissionFingerprint(candidateExecution.history) === delegationAdmissionFingerprint(admittedExecution.history);
            if (!matches || candidate.status === 'streaming') return undefined;
            if (candidate.historyPhase === 'finalization_pending') return 'saving' as const;
            if (candidate.historyPhase === 'blocked' || candidate.historyPhase === 'superseded') {
                const uncertain = candidate.status === 'error'
                    ? normalizeError(candidate.error).code === 'ERR_MODEL_OUTCOME_UNKNOWN'
                    : candidate.status === 'aborted' && candidateExecution.delegationDispatch !== undefined;
                return uncertain ? 'unknown' as const : 'unavailable' as const;
            }
            return undefined;
        } catch {
            // A lookup or validation failure cannot establish a child outcome.
            return undefined;
        }
    }));
    if (!historyOutcomes.some(Boolean)) return view;
    const activity = DelegationLiveActivitySchema.parse({ ...call.delegation, version: 3,
        children: call.delegation.children.map((child, index) => historyOutcomes[index]
            ? { ...child, outcome: historyOutcomes[index] } : child) });
    return { ...view, tool_calls: view.tool_calls.map(item => item === call ? { ...item, delegation: activity } : item) };
}
