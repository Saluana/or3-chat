/**
 * @module server/utils/workflows/hitl-store
 *
 * Purpose:
 * In-memory HITL request storage for background workflow execution.
 *
 * Constraints:
 * - Process-local only; pending requests are lost on restart.
 */

import type { HITLResponse } from 'or3-workflow-core';

type PendingHitl = {
    userId: string;
    workspaceId: string;
    jobId: string;
    resolve: (response: HITLResponse) => void;
};

const pendingRequests = new Map<string, PendingHitl>();

export function registerHitlRequest(
    requestId: string,
    pending: PendingHitl
): Promise<HITLResponse> {
    return new Promise((resolve) => {
        pendingRequests.set(requestId, {
            ...pending,
            resolve: (response) => {
                pendingRequests.delete(requestId);
                resolve(response);
                pending.resolve(response);
            },
        });
    });
}

export function resolveHitlRequest(
    requestId: string,
    response: HITLResponse,
    userId: string,
    workspaceId: string
): boolean {
    const pending = pendingRequests.get(requestId);
    if (!pending) return false;
    if (pending.userId !== userId || pending.workspaceId !== workspaceId) {
        return false;
    }
    pendingRequests.delete(requestId);
    pending.resolve(response);
    return true;
}

export function clearHitlRequestsForJob(jobId: string): void {
    for (const [requestId, pending] of pendingRequests.entries()) {
        if (pending.jobId === jobId) {
            pendingRequests.delete(requestId);
        }
    }
}
