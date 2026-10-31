import { useRuntimeConfig } from '#imports';
import { randomUUID } from 'node:crypto';
import { DelegationWaitSchema, type DelegationWait } from '~~/shared/chat/delegation-checkpoint';
import { delegationAdmissionFingerprint } from '~~/shared/chat/delegation-identities';
import { prepareToolResultStorage } from '~~/shared/chat/tool-result-artifact';
import { MAX_TOOL_DURABLE_RESULT_BYTES } from '~~/shared/chat/tool-limits';
import { normalizeError } from '~~/shared/errors';
import { canonicalHistoryContext } from '../chat/canonical-history-context';
import { getSyncGatewayAdapter } from '../../sync/gateway/registry';
import { checkDelegationAccess } from './delegation-access';
import { assertServerProjectExecutionSupported } from '../chat/project-policy';
import { getShutdownRuntime } from '../shutdown/runtime';
import { DelegationToolUnavailableError, reconstructDelegationChild } from './delegation-child';
import { buildDelegationResume } from './delegation-resume';
import { retainBackgroundToolResult } from './history';
import { getChatJobExecution, type BackgroundJob, type BackgroundJobProvider, type DelegationResume } from './types';
import { supportsDelegationCoordination, supportsDelegationHistory } from './capabilities';

function nextDelegationCheck(wait: DelegationWait, now: number, delay: number): number {
    const next = now + delay;
    return wait.expiredAt === undefined && wait.deadlineAt > now ? Math.min(next, wait.deadlineAt) : next;
}

/** Scan a bounded page of persisted waits without occupying model workers. */
export async function reconcileDueDelegationWaits(provider: BackgroundJobProvider, limit: number): Promise<number> {
    if (!supportsDelegationCoordination(provider)) return 0;
    const controller = getShutdownRuntime().controller;
    if (controller.phase() === 'draining' || controller.phase() === 'closed') return 0;
    const maxClaims = Math.max(1, Math.min(20, Math.floor(limit)));
    let claimed = 0;
    while (claimed < maxClaims && controller.phase() !== 'draining' && controller.phase() !== 'closed') {
        const now = Date.now();
        const leaseOwner = `delegation:${randomUUID()}`;
        const parent = await provider.claimNextDelegationWait!(leaseOwner, now, now + 30_000);
        if (!parent) break;
        claimed++;
        try {
            const execution = getChatJobExecution(parent);
            if (!execution) throw new Error('Delegation parent execution is unavailable');
            const wait = DelegationWaitSchema.parse(execution.delegationWait);
            if (parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined) {
                await provider.cleanupDelegationWait!({ parentJobId: parent.id, leaseOwner, expectedRevision: wait.revision });
                continue;
            }
            // Expiry only cancels already-admitted work. It must not depend on
            // an authorization service being available to approve new work.
            if (wait.expiredAt === undefined && now >= wait.deadlineAt) {
                await provider.expireDelegationWait!({ parentJobId: parent.id, leaseOwner, expectedRevision: wait.revision });
                continue;
            }
            const access = await checkDelegationAccess(parent, false);
            if (access === 'unavailable') {
                await provider.commitDelegationWait!({ parentJobId: parent.id, leaseOwner, expectedRevision: wait.revision,
                    wait: { ...wait, revision: wait.revision + 1, nextCheckAt: nextDelegationCheck(wait, Date.now(), 5_000) } });
                continue;
            }
            const authorizationDenied = access === 'denied';
            const validity = await provider.stopInvalidDelegationWait!({ parentJobId: parent.id, leaseOwner,
                expectedRevision: wait.revision, authorizationDenied });
            if (validity === 'stopped') {
                await provider.cleanupDelegationWait!({ parentJobId: parent.id, leaseOwner, expectedRevision: wait.revision });
                continue;
            }
            if (validity !== 'valid') continue;
            const adapter = parent.syncProviderId ? getSyncGatewayAdapter(parent.syncProviderId) : undefined;
            const canCoordinate = supportsDelegationHistory(adapter);
            if (canCoordinate && controller.canStartWork() && now < wait.deadlineAt)
                await admitPreparedDelegationChildren(provider, parent.id, parent.userId, leaseOwner);
            const fresh = await provider.getJob(parent.id, parent.userId);
            const freshExecution = fresh && getChatJobExecution(fresh);
            if (!fresh || !freshExecution || fresh.leaseOwner !== leaseOwner || (fresh.leaseExpiresAt ?? 0) <= Date.now()) continue;
            if (fresh.status !== 'streaming' || freshExecution.cancellationRequestedAt !== undefined) {
                const current = DelegationWaitSchema.parse(freshExecution.delegationWait);
                await provider.cleanupDelegationWait!({ parentJobId: fresh.id, leaseOwner, expectedRevision: current.revision });
                continue;
            }
            const current = DelegationWaitSchema.parse(freshExecution.delegationWait);
            let committed = false;
            if (canCoordinate) {
                for (const child of current.children) {
                    if (child.kind !== 'prepared' || !child.jobId || child.settlement) continue;
                    if (await reconcileDelegationChild(provider, fresh.id, fresh.userId, leaseOwner, child.index) === 'committed') {
                        committed = true;
                        break;
                    }
                }
                if (committed) continue;
                if (current.children.every(child => child.settlement) && controller.canStartWork() &&
                    (Date.now() < current.deadlineAt || current.expiredAt !== undefined)) {
                    const resumed = await resumeReconciledDelegation(provider, fresh.id, fresh.userId, leaseOwner);
                    if (resumed === 'resumed') continue;
                }
            }
            // Yield the lease and retry without changing the fixed deadline.
            const latest = await provider.getJob(parent.id, parent.userId);
            const latestExecution = latest && getChatJobExecution(latest);
            if (!latest || !latestExecution || latest.leaseOwner !== leaseOwner || (latest.leaseExpiresAt ?? 0) <= Date.now()) continue;
            const latestWait = DelegationWaitSchema.parse(latestExecution.delegationWait);
            await provider.commitDelegationWait!({ parentJobId: latest.id, leaseOwner, expectedRevision: latestWait.revision,
                wait: { ...latestWait, revision: latestWait.revision + 1, nextCheckAt: nextDelegationCheck(latestWait, Date.now(), 5_000) } });
        } catch {
            // Provider errors may include credentials or private history, so do not log them.
            console.warn('[background-jobs] Delegation recovery deferred; will retry.');
            try {
                const latest = await provider.getJob(parent.id, parent.userId);
                const execution = latest && getChatJobExecution(latest);
                const wait = execution && DelegationWaitSchema.safeParse(execution.delegationWait);
                if (latest?.leaseOwner === leaseOwner && (latest.leaseExpiresAt ?? 0) > Date.now() && wait?.success) {
                    await provider.commitDelegationWait!({ parentJobId: latest.id, leaseOwner,
                        expectedRevision: wait.data.revision,
                        wait: { ...wait.data, revision: wait.data.revision + 1,
                            nextCheckAt: nextDelegationCheck(wait.data, Date.now(), 30_000) } });
                }
            } catch {
                // If deferral also fails, the unchanged lease expires and recovery retries.
            }
        }
    }
    return claimed;
}

/** Admit currently available children under a coordinator lease; settlement is separate. */
export async function admitPreparedDelegationChildren(
    provider: BackgroundJobProvider, parentJobId: string, userId: string, leaseOwner: string,
): Promise<{ admitted: number; reason: 'no-pending' | 'capacity' | 'not-owned' | 'cancelled' | 'expired' | 'paused' | 'settled' }> {
    if (!provider.admitDelegationChild || !provider.commitDelegationWait) throw new Error('Durable delegation admission is unavailable');
    let admitted = 0;
    for (let index = 0; index < 4; index++) {
        if (!getShutdownRuntime().controller.canStartWork()) return { admitted, reason: 'paused' };
        const parent = await provider.getJob(parentJobId, userId);
        const execution = parent && getChatJobExecution(parent);
        if (!parent || !execution || parent.leaseOwner !== leaseOwner || (parent.leaseExpiresAt ?? 0) <= Date.now())
            return { admitted, reason: 'not-owned' };
        if (parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined)
            return { admitted, reason: 'cancelled' };
        const wait = DelegationWaitSchema.parse(execution.delegationWait);
        if (Date.now() >= wait.deadlineAt) return { admitted, reason: 'expired' };
        const child = wait.children[index];
        if (!child) return { admitted, reason: 'no-pending' };
        if (child.kind === 'rejected' || child.settlement || child.jobId) continue;
        const configuredProvider = (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider;
        if (!parent.syncProviderId || configuredProvider !== parent.syncProviderId)
            throw new Error('Delegation sync provider is no longer active');
        await assertServerProjectExecutionSupported({ subject: parent.userId, workspaceId: execution.workspaceId,
            threadId: parent.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
        if (!getShutdownRuntime().controller.canStartWork()) return { admitted, reason: 'paused' };
        const fresh = await provider.getJob(parentJobId, userId);
        const freshExecution = fresh && getChatJobExecution(fresh);
        if (!fresh || !freshExecution || fresh.leaseOwner !== leaseOwner || (fresh.leaseExpiresAt ?? 0) <= Date.now() ||
            fresh.generationId !== parent.generationId || fresh.syncProviderId !== parent.syncProviderId ||
            freshExecution.workspaceId !== execution.workspaceId || fresh.threadId !== parent.threadId)
            return { admitted, reason: 'not-owned' };
        if (fresh.status !== 'streaming' || freshExecution.cancellationRequestedAt !== undefined)
            return { admitted, reason: 'cancelled' };
        const current = DelegationWaitSchema.parse(freshExecution.delegationWait);
        if (Date.now() >= current.deadlineAt) return { admitted, reason: 'expired' };
        if (current.callId !== wait.callId || current.argumentFingerprint !== wait.argumentFingerprint || current.revision !== wait.revision)
            return { admitted, reason: 'not-owned' };
        let admission;
        try {
            admission = reconstructDelegationChild(fresh, index);
        } catch (error) {
            if (!(error instanceof DelegationToolUnavailableError)) throw error;
            const proposed = DelegationWaitSchema.parse({ ...current, revision: current.revision + 1, nextCheckAt: Date.now(),
                children: current.children.map((item, position) => position === index
                    ? { ...item, settlement: { kind: 'unavailable', code: 'tool_unavailable' } } : item) });
            const committed = await provider.commitDelegationWait({ parentJobId, leaseOwner, expectedRevision: current.revision, wait: proposed });
            return { admitted, reason: committed ? 'settled' : 'not-owned' };
        }
        if (!getShutdownRuntime().controller.canStartWork()) return { admitted, reason: 'paused' };
        const activeProvider = (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider;
        if (activeProvider !== parent.syncProviderId)
            throw new Error('Delegation sync provider is no longer active');
        const result = await provider.admitDelegationChild({ parentJobId, leaseOwner, revision: current.revision,
            callId: current.callId, argumentFingerprint: current.argumentFingerprint, childIndex: index, child: admission });
        if (result.status !== 'admitted') return { admitted, reason: result.status };
        if (!result.replayed) admitted++;
    }
    return { admitted, reason: 'no-pending' };
}

/** Read an exact committed child generation. Storage errors and access loss defer recovery. */
async function inspectDelegationChild(
    provider: BackgroundJobProvider, parentJobId: string, userId: string, leaseOwner: string, index: number,
    terminal: boolean,
): Promise<{ status: 'pending' } | { status: 'unavailable' } | { status: 'retry' } | { status: 'verified'; content: string }> {
    const parent = await provider.getJob(parentJobId, userId);
    const execution = parent && getChatJobExecution(parent);
    if (!parent || !execution || parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined ||
        parent.leaseOwner !== leaseOwner || (parent.leaseExpiresAt ?? 0) <= Date.now()) return { status: 'retry' };
    const wait = DelegationWaitSchema.parse(execution.delegationWait);
    const child = wait.children[index];
    if (!child || child.kind !== 'prepared' || !child.jobId ||
        (terminal ? !child.settlement || !['failed', 'stopped', 'unknown'].includes(child.settlement.kind)
            : child.settlement && child.settlement.kind !== 'complete')) return { status: 'pending' };
    const admitted = reconstructDelegationChild(parent, index, { allowSettled: true });
    const job = await provider.getJob(child.jobId, userId);
    if (!job) return { status: 'unavailable' };
    const childExecution = getChatJobExecution(job);
    if (!childExecution || job.userId !== userId || job.threadId !== admitted.threadId || job.messageId !== admitted.messageId ||
        job.generationId !== admitted.generationId || job.syncProviderId !== parent.syncProviderId ||
        childExecution.workspaceId !== execution.workspaceId || !childExecution.history ||
        delegationAdmissionFingerprint(childExecution.history) !== delegationAdmissionFingerprint(child.admission.history as object))
        return { status: 'unavailable' };
    if (job.status === 'streaming') return { status: 'pending' };
    const outcome = (candidate: BackgroundJob) => {
        const candidateExecution = getChatJobExecution(candidate);
        if (candidate.status === 'complete') return 'complete';
        if (candidate.status === 'error') return normalizeError(candidate.error).code === 'ERR_MODEL_OUTCOME_UNKNOWN' ? 'unknown' : 'failed';
        if (candidate.status === 'aborted') return candidateExecution?.delegationDispatch !== undefined ? 'unknown' : 'stopped';
        return undefined;
    };
    if (terminal ? outcome(job) !== child.settlement?.kind : job.status !== 'complete') return { status: 'unavailable' };
    if (job.historyPhase === 'blocked' || job.historyPhase === 'superseded') return { status: 'unavailable' };
    if (job.historyPhase !== 'committed') return { status: 'pending' };
    const active = (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider;
    if (!parent.syncProviderId || active !== parent.syncProviderId) throw new Error('Delegation sync provider is no longer active');
    const ctx = canonicalHistoryContext({ subject: userId, workspaceId: execution.workspaceId, threadId: parent.threadId,
        syncProviderId: parent.syncProviderId, signal: AbortSignal.timeout(10_000), permission: 'workspace.write' });
    await ctx.authorize();
    const readThread = async (threadId: string) => {
        const result = await ctx.read({ kind: 'thread', thread_id: threadId });
        if (result.status !== 'ok' || result.revision === undefined) throw new Error('Canonical chat history is unavailable');
        return result;
    };
    const beforeParent = await readThread(parent.threadId);
    const beforeChild = await readThread(child.threadId);
    const result = await ctx.read({ kind: 'messages', message_ids: [child.assistantMessageId] });
    if (result.status !== 'ok' || !result.messages) throw new Error('Canonical child history is unavailable');
    const afterChild = await readThread(child.threadId);
    const afterParent = await readThread(parent.threadId);
    await ctx.authorize();
    if (beforeParent.revision !== afterParent.revision || beforeChild.revision !== afterChild.revision) return { status: 'retry' };
    const eligible = (value: typeof beforeChild, id: string) => value.project_ownership === 'resolved' &&
        value.thread?.id === id && !value.thread.deleted && !value.thread.project_id;
    if (!eligible(beforeParent, parent.threadId) || !eligible(afterParent, parent.threadId) ||
        !eligible(beforeChild, child.threadId) || !eligible(afterChild, child.threadId)) return { status: 'unavailable' };
    const row = result.messages.length === 1 ? result.messages[0] : undefined;
    const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data as Record<string, unknown> : {};
    if (!row || row.id !== child.assistantMessageId || row.thread_id !== child.threadId || row.role !== 'assistant' ||
        row.deleted || row.pending !== false || row.clock !== childExecution.history.assistantMessage.clock + 1 ||
        data.generation_id !== job.generationId ||
        data.generation_state !== (job.status === 'complete' ? 'complete' : job.status === 'aborted' ? 'aborted' : 'failed') ||
        data.content !== job.content)
        return { status: 'unavailable' };
    const current = await provider.getJob(parentJobId, userId);
    const currentExecution = current && getChatJobExecution(current);
    const currentWait = currentExecution && DelegationWaitSchema.safeParse(currentExecution.delegationWait);
    const currentJob = await provider.getJob(child.jobId, userId);
    if (!current || !currentExecution || current.status !== 'streaming' || currentExecution.cancellationRequestedAt !== undefined ||
        current.leaseOwner !== leaseOwner || (current.leaseExpiresAt ?? 0) <= Date.now() || current.generationId !== parent.generationId ||
        current.threadId !== parent.threadId || current.syncProviderId !== parent.syncProviderId ||
        currentExecution.workspaceId !== execution.workspaceId || !currentWait?.success || currentWait.data.revision !== wait.revision || currentWait.data.callId !== wait.callId ||
        !currentJob || currentJob.status !== job.status || currentJob.historyPhase !== 'committed' ||
        currentJob.generationId !== job.generationId || currentJob.content !== job.content || currentJob.error !== job.error ||
        (terminal && outcome(currentJob) !== child.settlement?.kind)) return { status: 'retry' };
    const currentProvider = (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider;
    if (currentProvider !== parent.syncProviderId) throw new Error('Delegation sync provider is no longer active');
    await ctx.authorize();
    return { status: 'verified', content: job.content };
}

/** Read the exact completed result before settlement and resumption. */
export function inspectCompletedDelegationChild(
    provider: BackgroundJobProvider, parentJobId: string, userId: string, leaseOwner: string, index: number,
) {
    return inspectDelegationChild(provider, parentJobId, userId, leaseOwner, index, false);
}

/** Settle one child under a coordinator fence; unavailable storage never invents an outcome. */
export async function reconcileDelegationChild(
    provider: BackgroundJobProvider, parentJobId: string, userId: string, leaseOwner: string, index: number,
): Promise<'committed' | 'pending' | 'retry'> {
    if (!provider.commitDelegationWait) throw new Error('Durable delegation settlement is unavailable');
    const parent = await provider.getJob(parentJobId, userId);
    const execution = parent && getChatJobExecution(parent);
    if (!parent || !execution || parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined ||
        parent.leaseOwner !== leaseOwner || (parent.leaseExpiresAt ?? 0) <= Date.now()) return 'retry';
    const wait = DelegationWaitSchema.parse(execution.delegationWait);
    const child = wait.children[index];
    if (!child || child.kind !== 'prepared' || child.settlement || !child.jobId) return 'pending';
    const admission = reconstructDelegationChild(parent, index);
    const job = await provider.getJob(child.jobId, userId);
    const jobExecution = job && getChatJobExecution(job);
    const matches = !!job && !!jobExecution && job.userId === userId && job.threadId === admission.threadId &&
        job.messageId === admission.messageId && job.generationId === admission.generationId &&
        job.syncProviderId === parent.syncProviderId && jobExecution.workspaceId === execution.workspaceId &&
        !!jobExecution.history && delegationAdmissionFingerprint(jobExecution.history) ===
            delegationAdmissionFingerprint(child.admission.history as object);
    if (matches && job.status === 'streaming') return 'pending';
    if (matches && job.historyPhase !== 'committed' && job.historyPhase !== 'blocked' && job.historyPhase !== 'superseded') return 'pending';
    if (!parent.syncProviderId || (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider !== parent.syncProviderId)
        throw new Error('Delegation sync provider is no longer active');
    await assertServerProjectExecutionSupported({ subject: userId, workspaceId: execution.workspaceId,
        threadId: parent.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
    let settlement: NonNullable<Extract<typeof child, { kind: 'prepared' }>['settlement']>;
    if (!matches) {
        // Without the admitted job we cannot establish whether its request was dispatched.
        settlement = { kind: 'unknown', code: 'upstream_uncertain' };
    } else if (job.historyPhase === 'blocked' || job.historyPhase === 'superseded') {
        // Unavailable history must not erase evidence that execution may have occurred.
        const uncertain = job.status === 'error'
            ? normalizeError(job.error).code === 'ERR_MODEL_OUTCOME_UNKNOWN'
            : job.status === 'aborted' && jobExecution.delegationDispatch !== undefined;
        settlement = uncertain
            ? { kind: 'unknown', code: 'upstream_uncertain' }
            : { kind: 'unavailable', code: 'history_unavailable' };
    } else if (job.status === 'complete') {
        const checked = await inspectCompletedDelegationChild(provider, parentJobId, userId, leaseOwner, index);
        if (checked.status === 'pending') return 'pending';
        if (checked.status === 'retry') return 'retry';
        if (checked.status === 'unavailable') settlement = { kind: 'unavailable', code: 'history_unavailable' };
        else {
            if (new TextEncoder().encode(checked.content).length > MAX_TOOL_DURABLE_RESULT_BYTES) return 'pending';
            const identity = { threadId: parent.threadId, parentAssistantId: parent.messageId, callId: `${wait.callId}:child:${index}` };
            const storage = await prepareToolResultStorage(checked.content, identity);
            const retained = await retainBackgroundToolResult(parent, checked.content, identity.callId);
            const result = storage.rows.length && retained === storage.result
                ? { kind: 'artifact' as const, reference: retained }
                : { kind: 'inline' as const, value: checked.content };
            const rechecked = await inspectCompletedDelegationChild(provider, parentJobId, userId, leaseOwner, index);
            if (rechecked.status !== 'verified' || rechecked.content !== checked.content) return 'retry';
            settlement = { kind: 'complete', assistantMessageId: child.assistantMessageId, result };
        }
    } else {
        await assertServerProjectExecutionSupported({ subject: userId, workspaceId: execution.workspaceId,
            threadId: child.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
        if (job.status === 'error') {
            const error = normalizeError(job.error);
            settlement = error.code === 'ERR_MODEL_OUTCOME_UNKNOWN'
                ? { kind: 'unknown', code: 'upstream_uncertain' }
                : { kind: 'failed', code: error.code };
        } else if (job.status === 'aborted') {
            settlement = jobExecution.delegationDispatch !== undefined
                ? { kind: 'unknown', code: 'upstream_uncertain' }
                : { kind: 'stopped', code: 'stopped' };
        } else return 'pending';
    }
    const proposed = DelegationWaitSchema.safeParse({ ...wait, revision: wait.revision + 1, nextCheckAt: Date.now() + 5_000,
        children: wait.children.map((item, position) => position === index ? { ...child, settlement } : item) });
    // Older sync providers may only support inline storage; wait for a capable provider rather than truncate.
    if (!proposed.success) return 'pending';
    await assertServerProjectExecutionSupported({ subject: userId, workspaceId: execution.workspaceId,
        threadId: parent.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
    if ((useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider !== parent.syncProviderId)
        throw new Error('Delegation sync provider is no longer active');
    return await provider.commitDelegationWait({ parentJobId, leaseOwner, expectedRevision: wait.revision, wait: proposed.data })
        ? 'committed' : 'retry';
}

/** Prepare the retained ordered result and resume under the provider's wait fence. */
export async function resumeReconciledDelegation(
    provider: BackgroundJobProvider, parentJobId: string, userId: string, leaseOwner: string,
): Promise<'resumed' | 'pending' | 'retry' | 'capacity' | 'unavailable'> {
    if (!provider.resumeDelegationWait) throw new Error('Durable delegation resumption is unavailable');
    if (!getShutdownRuntime().controller.canStartWork()) return 'retry';
    const parent = await provider.getJob(parentJobId, userId);
    const execution = parent && getChatJobExecution(parent);
    if (!parent || !execution || parent.status !== 'streaming' || execution.cancellationRequestedAt !== undefined ||
        parent.leaseOwner !== leaseOwner || (parent.leaseExpiresAt ?? 0) <= Date.now()) return 'retry';
    const wait = DelegationWaitSchema.parse(execution.delegationWait);
    if (Date.now() >= wait.deadlineAt && wait.expiredAt === undefined) return 'pending';
    if (wait.children.some(child => !child.settlement)) return 'pending';
    if (!parent.syncProviderId || (useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider !== parent.syncProviderId)
        throw new Error('Delegation sync provider is no longer active');
    await assertServerProjectExecutionSupported({ subject: userId, workspaceId: execution.workspaceId,
        threadId: parent.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
    const resolvedResults: Record<number, string> = {};
    const unavailableChildren: NonNullable<DelegationResume['unavailableChildren']> = [];
    const readChildArtifact = async (index: number, reference: string): Promise<string | null> => {
        const adapter = getSyncGatewayAdapter(parent.syncProviderId!);
        if (!execution.history || !adapter?.readChatToolResult) throw new Error('Retained tool result reader is unavailable');
        try {
            return await adapter.readChatToolResult({ userId, workspaceId: execution.workspaceId }, {
                admission: execution.history, callId: `${wait.callId}:child:${index}`, reference,
            });
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'TOOL_RESULT_UNAVAILABLE') return null;
            throw error;
        }
    };
    for (const child of wait.children) {
        if (child.kind !== 'prepared' || !child.jobId || !child.settlement) continue;
        if (['failed', 'stopped', 'unknown'].includes(child.settlement.kind)) {
            const checked = await inspectDelegationChild(provider, parentJobId, userId, leaseOwner, child.index, true);
            if (checked.status === 'retry' || checked.status === 'pending') return 'retry';
            if (checked.status === 'unavailable') unavailableChildren.push({ index: child.index, code: 'history_unavailable' });
            continue;
        }
        if (child.settlement.kind !== 'complete') continue;
        const checked = await inspectCompletedDelegationChild(provider, parentJobId, userId, leaseOwner, child.index);
        if (checked.status === 'retry' || checked.status === 'pending') return 'retry';
        if (checked.status === 'unavailable') { unavailableChildren.push({ index: child.index, code: 'history_unavailable' }); continue; }
        if (child.settlement.result.kind === 'inline') {
            if (child.settlement.result.value !== checked.content)
                unavailableChildren.push({ index: child.index, code: 'result_unavailable' });
        } else {
            const content = await readChildArtifact(child.index, child.settlement.result.reference);
            if (content === null || content !== checked.content)
                unavailableChildren.push({ index: child.index, code: 'result_unavailable' });
            else resolvedResults[child.index] = content;
        }
    }
    const aggregate = buildDelegationResume(parent, { resolvedResults, unavailableChildren }).rawResult;
    const durableResult = await retainBackgroundToolResult(parent, aggregate, wait.callId);
    const ctx = canonicalHistoryContext({ subject: userId, workspaceId: execution.workspaceId, threadId: parent.threadId,
        syncProviderId: parent.syncProviderId, signal: AbortSignal.timeout(10_000), permission: 'workspace.write' });
    await ctx.authorize();
    const readRevision = async () => {
        const result = await ctx.read({ kind: 'messages', message_ids: [] });
        if (result.status !== 'ok' || result.revision === undefined || !/^(0|[1-9][0-9]*)$/.test(result.revision))
            throw new Error('Canonical workspace revision is unavailable');
        return result.revision;
    };
    const revision = await readRevision();
    const adapter = getSyncGatewayAdapter(parent.syncProviderId);
    if (durableResult !== aggregate) {
        if (!execution.history || !adapter?.readChatToolResult) throw new Error('Retained tool result reader is unavailable');
        const content = await adapter.readChatToolResult({ userId, workspaceId: execution.workspaceId },
            { admission: execution.history, callId: wait.callId, reference: durableResult });
        if (content !== aggregate) return 'unavailable';
    }
    for (const child of wait.children) {
        if (child.kind !== 'prepared' || !child.jobId || !child.settlement) continue;
        if (['failed', 'stopped', 'unknown'].includes(child.settlement.kind)) {
            const checked = await inspectDelegationChild(provider, parentJobId, userId, leaseOwner, child.index, true);
            const unavailable = unavailableChildren.some(item => item.index === child.index);
            if (unavailable ? checked.status !== 'unavailable' : checked.status !== 'verified') return 'retry';
            continue;
        }
        if (child.settlement.kind !== 'complete') continue;
        const checked = await inspectCompletedDelegationChild(provider, parentJobId, userId, leaseOwner, child.index);
        const unavailable = unavailableChildren.find(item => item.index === child.index);
        if (unavailable?.code === 'history_unavailable') {
            if (checked.status !== 'unavailable') return 'retry';
            continue;
        }
        if (checked.status !== 'verified') return 'retry';
        const content = child.settlement.result.kind === 'inline' ? child.settlement.result.value
            : await readChildArtifact(child.index, child.settlement.result.reference);
        if (unavailable?.code === 'result_unavailable') {
            if (content !== null && content === checked.content) return 'retry';
            continue;
        }
        if (content === null || content !== checked.content ||
            (child.settlement.result.kind === 'artifact' && content !== resolvedResults[child.index])) return 'retry';
    }
    await assertServerProjectExecutionSupported({ subject: userId, workspaceId: execution.workspaceId,
        threadId: parent.threadId, abortSignal: AbortSignal.timeout(10_000) }, 'workspace.write');
    await ctx.authorize();
    if (await readRevision() !== revision) return 'retry';
    if (!getShutdownRuntime().controller.canStartWork() || (Date.now() >= wait.deadlineAt && wait.expiredAt === undefined)) return 'retry';
    if ((useRuntimeConfig().public as { sync?: { provider?: string } }).sync?.provider !== parent.syncProviderId)
        throw new Error('Delegation sync provider is no longer active');
    const resumed = await provider.resumeDelegationWait({ parentJobId, leaseOwner, expectedRevision: wait.revision,
        expectedSyncRevision: revision, unavailableChildren, resolvedResults, durableResult });
    return resumed === 'not-owned' ? 'retry' : resumed;
}
