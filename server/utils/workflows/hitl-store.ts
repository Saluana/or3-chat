/**
 * @module server/utils/workflows/hitl-store
 *
 * Purpose:
 * HITL request coordination for background workflow execution.
 *
 * Constraints:
 * - In-process waiting promises are local to this instance.
 * - Source-of-truth responses are persisted on the background job record,
 *   allowing cross-instance resolution by (workspaceId, jobId, requestId).
 */

import type { HITLResponse } from 'or3-workflow-core';
import { getJobProvider } from '../background-jobs/store';
import { emitJobStatus } from '../background-jobs/viewers';
import type { BackgroundJob } from '../background-jobs/types';
import type {
    HitlAction,
    HitlRequestState,
    WorkflowMessageData,
} from '~/utils/chat/workflow-types';

type PendingHitl = {
    userId: string;
    workspaceId: string;
    jobId: string;
    resolve: (response: HITLResponse) => void;
    reject: (error: Error) => void;
};

const pendingRequests = new Map<string, PendingHitl>();
const HITL_POLL_INTERVAL_MS = 600;
const HITL_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

function parsePersistedResponse(value: unknown): HITLResponse | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.requestId !== 'string') return null;
    if (typeof candidate.action !== 'string') return null;
    if (typeof candidate.respondedAt !== 'string') return null;
    return {
        requestId: candidate.requestId,
        action: candidate.action as HITLResponse['action'],
        data: candidate.data as HITLResponse['data'],
        respondedAt: candidate.respondedAt,
    };
}

function parsePersistedRequestState(value: unknown): HitlRequestState | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id !== 'string') return null;
    if (typeof candidate.nodeId !== 'string') return null;
    if (typeof candidate.nodeLabel !== 'string') return null;
    if (typeof candidate.mode !== 'string') return null;
    if (typeof candidate.prompt !== 'string') return null;
    if (typeof candidate.createdAt !== 'string') return null;

    return candidate as unknown as HitlRequestState;
}

function getPersistedRequestState(
    job: Pick<BackgroundJob, 'workflow_state'> | null | undefined,
    requestId: string
): HitlRequestState | null {
    if (!job?.workflow_state || typeof job.workflow_state !== 'object') return null;
    const requests = job.workflow_state.hitlRequests;
    if (!requests || typeof requests !== 'object') return null;
    return parsePersistedRequestState(
        (requests as Record<string, unknown>)[requestId]
    );
}

function getPersistedResponse(
    job: Pick<BackgroundJob, 'workflow_state'> | null | undefined,
    requestId: string
): HITLResponse | null {
    const requestState = getPersistedRequestState(job, requestId);
    if (!requestState) return null;
    return parsePersistedResponse(requestState.response);
}

export function registerHitlRequest(
    requestId: string,
    pending: Omit<PendingHitl, 'resolve' | 'reject'>
): Promise<HITLResponse> {
    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, {
            ...pending,
            resolve: (response) => {
                pendingRequests.delete(requestId);
                resolve(response);
            },
            reject: (error) => {
                pendingRequests.delete(requestId);
                reject(error);
            },
        });

        const startedAt = Date.now();
        const poll = async () => {
            const current = pendingRequests.get(requestId);
            if (!current) return;

            if (Date.now() - startedAt > HITL_WAIT_TIMEOUT_MS) {
                current.reject(new Error(`HITL request timed out: ${requestId}`));
                return;
            }

            try {
                const provider = await getJobProvider();
                const job = await provider.getJob(current.jobId, current.userId);
                const requestState = getPersistedRequestState(job, requestId);
                if (!requestState) {
                    setTimeout(() => {
                        void poll();
                    }, HITL_POLL_INTERVAL_MS);
                    return;
                }

                const requestWorkspaceId = requestState.workspaceId;
                if (
                    requestWorkspaceId &&
                    requestWorkspaceId !== current.workspaceId
                ) {
                    current.reject(
                        new Error(
                            `HITL request workspace mismatch for ${requestId}`
                        )
                    );
                    return;
                }

                const persisted = parsePersistedResponse(requestState.response);
                if (persisted) {
                    current.resolve(persisted);
                    return;
                }
            } catch {
                // Best-effort polling; transient backend errors should not fail immediately.
            }

            setTimeout(() => {
                void poll();
            }, HITL_POLL_INTERVAL_MS);
        };

        void poll();
    });
}

export async function resolveHitlRequest(
    requestId: string,
    response: HITLResponse,
    userId: string,
    workspaceId: string,
    jobId: string
): Promise<boolean> {
    const provider = await getJobProvider();
    const job = await provider.getJob(jobId, userId);
    if (!job) return false;

    const workflowState = job.workflow_state;
    if (!workflowState || typeof workflowState !== 'object') {
        return false;
    }

    const requestState = getPersistedRequestState(job, requestId);
    if (!requestState) {
        return false;
    }

    if (
        requestState.workspaceId &&
        requestState.workspaceId !== workspaceId
    ) {
        return false;
    }

    const hitlRequests = (workflowState.hitlRequests ?? {}) as Record<
        string,
        HitlRequestState
    >;
    const updatedRequestState: HitlRequestState = {
        ...requestState,
        workspaceId: requestState.workspaceId ?? workspaceId,
        jobId: requestState.jobId ?? jobId,
        response: {
            requestId: response.requestId,
            action: response.action as HitlAction,
            data: response.data,
            respondedAt: response.respondedAt,
        },
    };

    const nextWorkflowState: WorkflowMessageData = {
        ...(workflowState as WorkflowMessageData),
        hitlRequests: {
            ...hitlRequests,
            [requestId]: updatedRequestState,
        },
        version: (workflowState.version ?? 0) + 1,
    };

    await provider.updateJob(jobId, {
        workflow_state: nextWorkflowState,
    });

    emitJobStatus(jobId, 'streaming', {
        content: job.content,
        contentLength: job.content.length,
        chunksReceived: job.chunksReceived,
        workflow_state: nextWorkflowState,
    });

    const pending = pendingRequests.get(requestId);
    if (!pending) return true;
    if (
        pending.userId !== userId ||
        pending.workspaceId !== workspaceId ||
        pending.jobId !== jobId
    ) {
        return false;
    }
    pending.resolve(response);
    return true;
}

export function clearHitlRequestsForJob(jobId: string): void {
    for (const [requestId, pending] of pendingRequests.entries()) {
        if (pending.jobId === jobId) {
            pending.reject(new Error(`HITL request cleared for job ${jobId}`));
            pendingRequests.delete(requestId);
        }
    }
}
