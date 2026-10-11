import type { WorkflowMessageData } from '~/utils/chat/workflow-types';

/** Derive the stopped view only from an authoritative aborted job status. */
export function projectBackgroundWorkflowState(
    status: string,
    state: WorkflowMessageData | undefined
): WorkflowMessageData | undefined {
    if (status !== 'aborted' || !state ||
        (state.executionState !== 'running' && state.executionState !== 'idle')) return state;
    return {
        ...state,
        executionState: 'stopped',
        currentNodeId: null,
        failedNodeId: state.failedNodeId ?? state.currentNodeId ?? state.lastActiveNodeId ?? null,
        result: {
            ...state.result,
            success: false,
            duration: state.result?.duration ?? 0,
            error: 'Workflow stopped by user',
        },
        version: (state.version ?? 0) + 1,
    };
}
