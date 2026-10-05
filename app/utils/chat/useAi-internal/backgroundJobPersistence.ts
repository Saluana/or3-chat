import { presentError } from '~~/shared/errors';
import { readRequestUsage, type RequestUsage } from '~~/shared/chat/compaction';
/**
 * Atomic, workspace-bound persistence for background job projections.
 */
import { getDb, type Or3DB } from '~/db/client';
import { getWriteTxTableNames, nowSec } from '~/db/util';
import type { BackgroundJobStatus } from '~/utils/chat/openrouterStream';
import type { BackgroundJobTracker, StoredMessage } from './types';
import { updateMessageRecord } from './persistence';
import { getHookBridge } from '~/core/sync/hook-bridge';
import Dexie from 'dexie';

export const BACKGROUND_JOB_PERSIST_INTERVAL_MS = 500;

export function isBackgroundUsageReset(
    status: BackgroundJobStatus,
    previousAttempt: number | undefined
): boolean {
    return status.content_reset === true || status.reasoning_reset === true ||
        (typeof status.attempt === 'number' && typeof previousAttempt === 'number' &&
            status.attempt > previousAttempt);
}

/**
 * Apply browser-only metadata after canonical admission without advancing the
 * row revision or creating an outbox operation. The server owns the next clock.
 */
export async function projectCanonicalBackgroundMessage(
    db: Or3DB,
    messageId: string,
    patch: {
        pending?: boolean;
        error?: string | null;
        data?: Record<string, unknown>;
    },
    expected?: { generationId?: string; jobId?: string }
): Promise<boolean> {
    return await db.transaction(
        'rw',
        getWriteTxTableNames(db, 'messages'),
        async () => {
            const tx = Dexie.currentTransaction as typeof Dexie.currentTransaction | undefined;
            if (!tx)
                throw new Error('Missing background projection transaction');
            getHookBridge(db).markSyncTransaction(tx);
            const existing = (await db.messages.get(messageId)) as
                | StoredMessage
                | undefined;
            if (!existing) return false;
            const data =
                existing.data && typeof existing.data === 'object'
                    ? (existing.data as Record<string, unknown>)
                    : {};
            if (
                expected &&
                ((expected.generationId &&
                    typeof data.generation_id === 'string' &&
                    data.generation_id !== expected.generationId) ||
                    (expected.jobId &&
                        typeof data.background_job_id === 'string' &&
                        data.background_job_id !== expected.jobId))
            )
                return false;
            await db.messages.put({
                ...existing,
                ...('pending' in patch ? { pending: patch.pending } : {}),
                ...('error' in patch ? { error: patch.error } : {}),
                data: { ...data, ...(patch.data ?? {}) },
            });
            return true;
        }
    );
}

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
        : (state.failedNodeId ??
          state.currentNodeId ??
          state.lastActiveNodeId ??
          null);
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
                : (error ??
                  state.result?.error ??
                  (status === 'aborted'
                      ? 'Workflow stopped by user'
                      : 'Background workflow failed')),
        },
        version: (state.version ?? 0) + 1,
    };
}

/**
 * Records that local tracking was interrupted (job missing, auth lost, or a
 * malformed protocol response) without claiming the server generation failed.
 * Only the `interrupt` mode writes a durable interrupted projection; auth and
 * protocol interruptions leave the row pending so reattachment can retry.
 */
export async function persistBackgroundTrackingInterruption(
    tracker: BackgroundJobTracker,
    options: { interrupt: boolean }
): Promise<void> {
    if (!isClientRuntime() || !options.interrupt) return;
    const db = tracker.originDb ?? getDb();
    const existing = (await db.messages.get(tracker.messageId)) as
        | StoredMessage
        | undefined;
    if (!existing) return;
    const data =
        existing.data && typeof existing.data === 'object'
            ? (existing.data as Record<string, unknown>)
            : {};
    if (existing.pending !== true || data.background_job_id !== tracker.jobId) {
        // Superseded, deleted, or already finalized by another path.
        return;
    }
    await updateMessageRecord(
        db,
        tracker.messageId,
        {
            pending: false,
            error: 'stream_interrupted',
            data: {
                background_job_status: 'error',
                background_job_error: 'stream_interrupted',
                generation_state: 'interrupted',
                error: 'stream_interrupted',
            },
        },
        existing,
        (latest) => {
            const latestData = latest?.data as Record<string, unknown> | null;
            return latest?.pending === true && !latest.deleted &&
                latestData?.background_job_id === tracker.jobId &&
                typeof latestData.superseded_by !== 'string' &&
                (!tracker.generationId || latestData.generation_id === tracker.generationId);
        }
    );
}

export async function persistBackgroundJobUpdate(
    tracker: BackgroundJobTracker,
    status: BackgroundJobStatus,
    content: string,
    replaceContent = false,
    reasoning?: string,
    replaceReasoning = false
): Promise<{
    persisted: boolean;
    /** The target row no longer exists (deleted/superseded). */
    missing?: boolean;
    /** The row was deleted or transferred to another generation/job. */
    superseded?: boolean;
    /** Another tab already projected a newer server execution attempt. */
    staleAttempt?: boolean;
    usage?: RequestUsage;
    workflowState?: BackgroundJobStatus['workflow_state'];
}> {
    if (!isClientRuntime()) {
        return { persisted: true, workflowState: status.workflow_state };
    }

    const now = Date.now();
    const usage = readRequestUsage(status.usage);
    const usageFingerprint = usage ? JSON.stringify(usage) : undefined;
    const usageChanged = usageFingerprint !== undefined &&
        usageFingerprint !== tracker.lastPersistedUsageFingerprint;
    const resetUsage = isBackgroundUsageReset(status, tracker.lastAttempt) ||
        tracker.usageResetPending === true;
    const statusChanged = status.status !== tracker.status;
    const attemptChanged =
        typeof status.attempt === 'number' &&
        status.attempt !== tracker.lastAttempt;
    const contentChanged =
        replaceContent || content.length > tracker.lastPersistedLength;
    const reasoningChanged =
        reasoning !== undefined &&
        (replaceReasoning ||
            reasoning.length > (tracker.lastPersistedReasoningLength));
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
    const shouldPersistReasoning =
        reasoningChanged &&
        (replaceReasoning ||
            now - tracker.lastPersistAt > BACKGROUND_JOB_PERSIST_INTERVAL_MS ||
            status.status !== 'streaming');

    if (
        !statusChanged &&
        !attemptChanged &&
        !shouldPersistContent &&
        !shouldPersistReasoning &&
        !toolStateChanged &&
        !workflowChanged &&
        !usageChanged &&
        !resetUsage
    ) {
        return { persisted: true, workflowState: status.workflow_state };
    }

    const nextError =
        status.status === 'error'
            ? presentError(status.error, { code: 'ERR_STREAM_FAILURE' }).message
            : status.status === 'aborted'
              ? 'Background response aborted'
              : null;
    // One canonical projection for every terminal state: message state,
    // generation state, and background job status must never disagree.
    const nextGenerationState =
        status.status === 'streaming'
            ? 'streaming'
            : status.status === 'complete'
              ? 'complete'
              : status.status === 'aborted'
                ? 'aborted'
                : 'failed';
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
    const disposition = { staleAttempt: false, superseded: false };
    const persistedResult = await currentDb.transaction(
        'rw',
        getWriteTxTableNames(currentDb, 'messages'),
        async (): Promise<{
            record: StoredMessage;
            workflowState?: BackgroundJobStatus['workflow_state'];
            workflowVersion: number;
            usageCleared: boolean;
            usage?: RequestUsage;
        } | null> => {
            if (tracker.canonicalHistory) {
                const tx = Dexie.currentTransaction as typeof Dexie.currentTransaction | undefined;
                if (!tx)
                    throw new Error(
                        'Missing background projection transaction'
                    );
                getHookBridge(currentDb).markSyncTransaction(tx);
            }
            const existing = (await currentDb.messages.get(
                tracker.messageId
            )) as StoredMessage | undefined;
            if (!existing) {
                disposition.superseded = true;
                return null;
            }

            const baseData =
                existing.data && typeof existing.data === 'object'
                    ? (existing.data as Record<string, unknown>)
                    : {};
            if (
                existing.deleted ||
                typeof baseData.superseded_by === 'string' ||
                baseData.generation_state === 'superseded' ||
                (typeof baseData.background_job_id === 'string' &&
                    baseData.background_job_id !== tracker.jobId) ||
                (tracker.generationId &&
                    typeof baseData.generation_id === 'string' &&
                    baseData.generation_id !== tracker.generationId) ||
                (tracker.canonicalHistory && tracker.generationId &&
                    baseData.generation_id !== tracker.generationId)
            ) {
                disposition.superseded = true;
                return null;
            }
            if (
                typeof baseData.background_job_attempt === 'number' &&
                typeof status.attempt === 'number' &&
                baseData.background_job_attempt > status.attempt
            ) {
                disposition.staleAttempt = true;
                return null;
            }
            if (tracker.canonicalHistory && existing.pending !== true) return null;
            const resetsStoredUsage = resetUsage || isBackgroundUsageReset(
                status,
                typeof baseData.background_job_attempt === 'number'
                    ? baseData.background_job_attempt : undefined
            );
            const previousUsage = readRequestUsage(baseData.usage);
            const acceptedUsage = !resetsStoredUsage && previousUsage &&
                (!usage || usage.iteration < previousUsage.iteration)
                ? previousUsage : usage;
            const usageCleared = resetsStoredUsage && !acceptedUsage;
            const preservedData = { ...baseData };
            if (usageCleared) delete preservedData.usage;
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
                workflowState !== undefined &&
                workflowVersion >= tracker.lastWorkflowVersion;
            const updated: StoredMessage = {
                ...existing,
                pending: status.status === 'streaming',
                error: nextError,
                data: {
                    ...preservedData,
                    ...(includeWorkflowState ? workflowState : {}),
                    content:
                        replaceContent || content.length > 0
                            ? content
                            : ((baseData.content as string | undefined) ?? ''),
                    ...(reasoning !== undefined &&
                    (replaceReasoning || reasoning.length > 0)
                        ? { reasoning_text: reasoning }
                        : {}),
                    background_job_id: tracker.jobId,
                    background_job_status: status.status,
                    generation_state: nextGenerationState,
                    ...(typeof status.attempt === 'number'
                        ? { background_job_attempt: status.attempt }
                        : {}),
                    background_job_error: status.error ?? null,
                    error: nextError ?? null,
                    ...(persistedToolCalls
                        ? { tool_calls: persistedToolCalls }
                        : {}),
                    ...(acceptedUsage ? { usage: acceptedUsage } : {}),
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
                usageCleared,
                usage: acceptedUsage,
            };
        }
    );
    if (!persistedResult) return disposition.staleAttempt
        ? { persisted: false, staleAttempt: true }
        : { persisted: false, missing: true, superseded: disposition.superseded };

    tracker.status = status.status;
    tracker.lastPersistAt = now;
    tracker.lastPersistedLength = content.length;
    if (reasoning !== undefined) {
        tracker.lastPersistedReasoningLength = reasoning.length;
    }
    tracker.lastToolStateFingerprint = toolStateFingerprint;
    if (persistedResult.usage || persistedResult.usageCleared) {
        tracker.lastPersistedUsageFingerprint = persistedResult.usage
            ? JSON.stringify(persistedResult.usage) : undefined;
    }
    tracker.usageResetPending = false;
    tracker.lastWorkflowFingerprint = JSON.stringify(
        persistedResult.workflowState ?? null
    );
    if (persistedResult.workflowVersion >= tracker.lastWorkflowVersion) {
        tracker.lastWorkflowVersion = persistedResult.workflowVersion;
    }
    return {
        persisted: true,
        workflowState: persistedResult.workflowState,
        usage: persistedResult.usage,
    };
}
