/**
 * Atomic, workspace-bound persistence for background job projections.
 */
import { getDb } from '~/db/client';
import { getWriteTxTableNames, nowSec } from '~/db/util';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import type { BackgroundJobTracker, StoredMessage } from './types';

export const BACKGROUND_JOB_PERSIST_INTERVAL_MS = 500;

function isClientRuntime(): boolean {
    const override = (globalThis as { __OR3_TEST_CLIENT?: boolean })
        .__OR3_TEST_CLIENT;
    if (typeof override === 'boolean') return override;
    return Boolean(import.meta.client);
}

function workflowVersionOf(value: unknown): number {
    if (!value || typeof value !== 'object') return -1;
    const version = (value as { version?: unknown }).version;
    return typeof version === 'number' && Number.isFinite(version)
        ? version
        : -1;
}

export function normalizeTerminalWorkflowState(
    state: BackgroundJobStatus['workflow_state'],
    status: BackgroundJobStatus['status'],
    error: string | undefined
): BackgroundJobStatus['workflow_state'] {
    if (
        !state ||
        typeof state !== 'object' ||
        status === 'streaming' ||
        (state.executionState !== 'running' && state.executionState !== 'idle')
    ) {
        return state;
    }

    const completed = status === 'complete';
    const terminalAt = Date.now();
    const failedNodeId = completed
        ? null
        : state.failedNodeId ??
          state.currentNodeId ??
          state.lastActiveNodeId ??
          null;
    return {
        ...state,
        nodeStates: Object.fromEntries(
            Object.entries(state.nodeStates).map(([nodeId, node]) => [
                nodeId,
                node.status === 'active' && !node.finishedAt
                    ? {
                          ...node,
                          finishedAt: terminalAt,
                          toolCalls: node.toolCalls?.map((toolCall) =>
                              toolCall.status === 'active' &&
                              !toolCall.finishedAt
                                  ? { ...toolCall, finishedAt: terminalAt }
                                  : toolCall
                          ),
                      }
                    : node,
            ])
        ),
        branches: state.branches
            ? Object.fromEntries(
                  Object.entries(state.branches).map(([branchId, branch]) => [
                      branchId,
                      branch.status === 'active'
                          ? {
                                ...branch,
                                toolCalls: branch.toolCalls?.map((toolCall) =>
                                    toolCall.status === 'active' &&
                                    !toolCall.finishedAt
                                        ? {
                                              ...toolCall,
                                              finishedAt: terminalAt,
                                          }
                                        : toolCall
                                ),
                            }
                          : branch,
                  ])
              )
            : state.branches,
        executionState: completed
            ? 'completed'
            : status === 'aborted'
              ? 'stopped'
              : 'error',
        currentNodeId: null,
        failedNodeId,
        result: {
            ...state.result,
            success: completed,
            duration: state.result?.duration ?? 0,
            error: completed
                ? undefined
                : error ??
                  state.result?.error ??
                  (status === 'aborted'
                      ? 'Workflow stopped by user'
                      : 'Background workflow failed'),
        },
        version: (state.version ?? 0) + 1,
    };
}

export async function persistBackgroundJobUpdate(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus,
    content: string,
    replaceContent = false
): Promise<{
    persisted: boolean;
    workflowState?: BackgroundJobStatus['workflow_state'];
}> {
    if (!isClientRuntime()) {
        return { persisted: true, workflowState: status.workflow_state };
    }

    const now = Date.now();
    const statusChanged = status.status !== tracker.status;
    const attemptChanged =
        typeof status.attempt === 'number' &&
        status.attempt !== tracker.lastAttempt;
    const contentChanged =
        replaceContent || content.length > tracker.lastPersistedLength;
    const toolStateFingerprint = JSON.stringify(status.tool_calls ?? []);
    const workflowFingerprint = JSON.stringify(status.workflow_state ?? null);
    const toolStateChanged =
        toolStateFingerprint !== (tracker.lastToolStateFingerprint ?? '[]');
    const workflowChanged =
        workflowFingerprint !== (tracker.lastWorkflowFingerprint ?? 'null');
    const shouldPersistContent =
        contentChanged &&
        (replaceContent ||
            now - tracker.lastPersistAt > BACKGROUND_JOB_PERSIST_INTERVAL_MS ||
            status.status !== 'streaming');

    if (
        !statusChanged &&
        !attemptChanged &&
        !shouldPersistContent &&
        !toolStateChanged &&
        !workflowChanged
    ) {
        return { persisted: true, workflowState: status.workflow_state };
    }

    const nextError =
        status.status === 'error'
            ? status.error || 'Background response failed'
            : status.status === 'aborted'
              ? 'Background response aborted'
              : null;
    const persistedToolCalls = Array.isArray(status.tool_calls)
        ? status.tool_calls.map((toolCall) => ({
              ...toolCall,
              status:
                  toolCall.status === 'skipped'
                      ? ('error' as const)
                      : toolCall.status,
          }))
        : undefined;
    const currentDb = tracker.originDb ?? getDb();
    const persistedResult = await currentDb.transaction(
        'rw',
        getWriteTxTableNames(currentDb, 'messages'),
        async (): Promise<{
            record: StoredMessage;
            workflowState?: BackgroundJobStatus['workflow_state'];
            workflowVersion: number;
        } | null> => {
            const existing = (await currentDb.messages.get(
                tracker.messageId
            )) as StoredMessage | undefined;
            if (!existing) return null;

            const baseData =
                existing.data && typeof existing.data === 'object'
                    ? (existing.data as Record<string, unknown>)
                    : {};
            const incomingWorkflowState =
                status.workflow_state &&
                typeof status.workflow_state === 'object'
                    ? status.workflow_state
                    : undefined;
            const storedWorkflowState =
                baseData.type === 'workflow-execution'
                    ? (baseData as unknown as BackgroundJobStatus['workflow_state'])
                    : undefined;
            const workflowState = normalizeTerminalWorkflowState(
                incomingWorkflowState ?? storedWorkflowState,
                status.status,
                status.error
            );
            const workflowVersion = workflowVersionOf(workflowState);
            const includeWorkflowState =
                workflowState !== null &&
                workflowVersion >= tracker.lastWorkflowVersion;
            const updated: StoredMessage = {
                ...existing,
                pending: status.status === 'streaming',
                error: nextError,
                data: {
                    ...baseData,
                    ...(includeWorkflowState ? workflowState : {}),
                    content:
                        replaceContent || content.length > 0
                            ? content
                            : (baseData.content as string | undefined) ?? '',
                    background_job_id: tracker.jobId,
                    background_job_status: status.status,
                    ...(typeof status.attempt === 'number'
                        ? { background_job_attempt: status.attempt }
                        : {}),
                    background_job_error: status.error ?? null,
                    error: nextError ?? null,
                    ...(persistedToolCalls
                        ? { tool_calls: persistedToolCalls }
                        : {}),
                },
                updated_at: nowSec(),
            };

            await currentDb.messages.put(updated);
            return {
                record: updated,
                workflowState: includeWorkflowState
                    ? workflowState
                    : incomingWorkflowState,
                workflowVersion: includeWorkflowState
                    ? workflowVersion
                    : tracker.lastWorkflowVersion,
            };
        }
    );
    if (!persistedResult) return { persisted: false };

    tracker.status = status.status;
    tracker.lastPersistAt = now;
    tracker.lastPersistedLength = content.length;
    tracker.lastToolStateFingerprint = toolStateFingerprint;
    tracker.lastWorkflowFingerprint = JSON.stringify(
        persistedResult.workflowState ?? null
    );
    if (persistedResult.workflowVersion >= tracker.lastWorkflowVersion) {
        tracker.lastWorkflowVersion = persistedResult.workflowVersion;
    }
    return {
        persisted: true,
        workflowState: persistedResult.workflowState,
    };
}
