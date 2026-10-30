import { markRaw, shallowReactive, toRaw } from 'vue';
import { getActiveWorkspaceId, getWorkspaceGeneration, subscribeActiveWorkspaceDb } from '~/db/client';
import type { SendResult } from './types';
import type { useChat } from '~/composables/chat/useAi';

type Controller = ReturnType<typeof useChat>;
export type DelegatedChatJob = {
    threadId: string;
    workspaceId: string;
    workspaceGeneration: number;
    assertOrigin: () => void;
    content: string;
    model: string;
    thinking: boolean;
    reasoningEffort?: string | null;
    signal: AbortSignal;
    controller?: Controller;
    resolve: (result: SendResult) => void;
    reject: (error: Error) => void;
    abort: () => void;
    stopWorkspace: () => void;
};

// The root-owned host mounts one setup-bound controller for each active job.
// Removing an entry tears down its component and all of its subscriptions.
const jobs = shallowReactive(new Map<string, DelegatedChatJob>());

export function delegatedChatJobs(): DelegatedChatJob[] { return [...jobs.values()]; }
export function hasDelegatedChatJobs(): boolean { return jobs.size > 0; }
function isCurrent(job: DelegatedChatJob): boolean {
    if (job.workspaceId !== (getActiveWorkspaceId() ?? 'local') || job.workspaceGeneration !== getWorkspaceGeneration()) return false;
    try { job.assertOrigin(); return true; } catch { return false; }
}
export function assertDelegatedChatCurrent(job: DelegatedChatJob): void {
    if (toRaw(jobs).get(job.threadId) !== job) throw new Error('Delegated chat was interrupted.');
    job.signal.throwIfAborted();
    if (!isCurrent(job)) throw new Error('The originating workspace is no longer available.');
}
export function delegatedChatController(threadId?: string): Controller | undefined {
    const job = threadId ? jobs.get(threadId) : undefined;
    return job && isCurrent(job) ? job.controller : undefined;
}
export function delegatedChatModel(threadId?: string): string | undefined {
    const job = threadId ? jobs.get(threadId) : undefined;
    return job && isCurrent(job) ? job.model : undefined;
}

export function queueDelegatedChat(input: Omit<DelegatedChatJob, 'controller' | 'resolve' | 'reject' | 'abort' | 'stopWorkspace'>): Promise<SendResult> {
    if (jobs.has(input.threadId)) return Promise.reject(new Error('That chat is already running.'));
    input.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const job = shallowReactive<DelegatedChatJob>({ ...input, resolve, reject, stopWorkspace: () => {}, abort: () => {
            if (job.controller) job.controller.abort();
            else finishDelegatedChat(job, undefined, new Error('Delegated chat was cancelled.'));
        } });
        job.stopWorkspace = subscribeActiveWorkspaceDb(() => {
            if (isCurrent(job)) return;
            if (job.controller) job.controller.abort();
            else finishDelegatedChat(job, undefined, new Error('The originating workspace is no longer available.'));
        });
        input.signal.addEventListener('abort', job.abort, { once: true });
        jobs.set(input.threadId, job);
    });
}

export function attachDelegatedChat(job: DelegatedChatJob, controller: Controller): void {
    if (jobs.get(job.threadId) !== job) return;
    job.controller = markRaw(controller);
    if (job.signal.aborted) job.abort();
}

export function finishDelegatedChat(job: DelegatedChatJob, result?: SendResult, error?: Error): void {
    if (jobs.get(job.threadId) !== job) return;
    job.signal.removeEventListener('abort', job.abort);
    job.stopWorkspace();
    jobs.delete(job.threadId);
    if (error) job.reject(error);
    else if (result) job.resolve(result);
    else job.reject(new Error('Delegated chat ended without a result.'));
}
