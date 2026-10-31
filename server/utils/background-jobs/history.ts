import { prepareToolResultStorage } from '~~/shared/chat/tool-result-artifact';
import type { BackgroundJob, BackgroundJobProvider } from "./types";
import { getChatJobExecution } from './types';
import { getSyncGatewayAdapter } from "../../sync/gateway/registry";
import type { CanonicalGenerationSnapshot } from "~~/shared/chat/background-history";
import { readRequestUsage } from '~~/shared/chat/compaction';
import { normalizeHistoryProviderFailure, BackgroundHistoryUnsupportedError } from '../../sync/gateway/history-errors';
import { checkDelegationAccess } from './delegation-access';

function historyAdapterFor(job: BackgroundJob) {
  if (!job.syncProviderId) return null;
  return getSyncGatewayAdapter(job.syncProviderId);
}

export function assertBackgroundHistoryProvider(providerId: string): void {
  const adapter = getSyncGatewayAdapter(providerId);
  if (
    !adapter ||
    adapter.capabilities?.backgroundGenerationHistory !== "v1" ||
    !adapter.admitChatGeneration ||
    !adapter.finalizeChatGeneration
  ) {
    throw new BackgroundHistoryUnsupportedError(providerId);
  }
}

function assertHistoryContract(job: BackgroundJob) {
  const adapter = historyAdapterFor(job);
  if (
    !adapter ||
    adapter.capabilities?.backgroundGenerationHistory !== "v1" ||
    !adapter.admitChatGeneration ||
    !adapter.finalizeChatGeneration
  ) {
    throw new BackgroundHistoryUnsupportedError(job.syncProviderId);
  }
  return adapter as typeof adapter & {
    admitChatGeneration: NonNullable<typeof adapter.admitChatGeneration>;
    finalizeChatGeneration: NonNullable<typeof adapter.finalizeChatGeneration>;
  };
}

async function callHistoryAdapter<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw normalizeHistoryProviderFailure(error);
  }
}

function terminalSnapshot(
  job: BackgroundJob,
  checkedRevision?: string,
): CanonicalGenerationSnapshot | null {
  if (job.status === "streaming" || typeof job.completedAt !== "number")
    return null;
  const execution = getChatJobExecution(job);
  return {
    status: job.status,
    content: job.content,
    reasoning: job.reasoning,
    toolCalls: job.tool_calls,
    usage: readRequestUsage(job.usage),
    error: job.error,
    completedAt: job.completedAt,
    ...(execution?.delegationWait && execution.delegationTerminalProjection?.version === 1
      ? { expectedWorkspaceRevision: execution.delegationTerminalProjection.workspaceRevision }
      : checkedRevision !== undefined ? { expectedWorkspaceRevision: checkedRevision } : {}),
    ...(execution?.delegationWait && execution.delegationTerminalProjection?.parentThreadUnavailable === true
      ? { onlyIfThreadUnavailable: true as const } : {}),
  };
}

/** Deliver one job's admission or terminal snapshot to canonical sync history. */
export async function reconcileBackgroundJobHistory(
  provider: BackgroundJobProvider,
  job: BackgroundJob,
): Promise<"ready" | "committed" | "superseded" | "blocked" | "unchanged"> {
  const execution = getChatJobExecution(job);
  const admission = execution?.history;
  if (!admission || !job.syncProviderId) return "unchanged";
  // A stopped parent still needs its child links and outcomes inserted into
  // its terminal snapshot. Finalizing first would make the history receipt
  // immutable and strand the evidence hold indefinitely.
  const terminalWait = job.status !== 'streaming' && execution?.delegationWait !== undefined;
  const projection = execution?.delegationTerminalProjection;
  const projectionReady = projection?.version === 1 && typeof projection.workspaceRevision === 'string' &&
    projection.workspaceRevision.length <= 16 && /^(0|[1-9][0-9]*)$/.test(projection.workspaceRevision) &&
    (projection.parentThreadUnavailable === undefined || projection.parentThreadUnavailable === true);
  if (terminalWait && !projectionReady && job.historyPhase !== 'admission_pending') return 'unchanged';
  let checkedRevision: string | undefined;
  if (execution?.delegationRecoveryPolicy === 'v1' && ['admission_pending', 'finalization_pending'].includes(job.historyPhase ?? '')) {
    if (await checkDelegationAccess(job, false) !== 'allowed') return 'unchanged';
    if (job.historyPhase === 'finalization_pending') {
      const reader = historyAdapterFor(job);
      if (reader?.capabilities?.delegationTerminalHistory !== 'v1' || !reader.readChatHistory) return 'unchanged';
      const readRevision = async () => {
        const result = await reader.readChatHistory!({ userId: job.userId, workspaceId: admission.workspaceId },
          { kind: 'messages', message_ids: [] }, AbortSignal.timeout(10_000));
        return result.status === 'ok' && typeof result.revision === 'string' &&
          result.revision.length <= 16 && /^(0|[1-9][0-9]*)$/.test(result.revision) ? result.revision : undefined;
      };
      const before = await readRevision();
      if (!before || await checkDelegationAccess(job, true, terminalWait && projection?.parentThreadUnavailable === true) !== 'allowed') return 'unchanged';
      const after = await readRevision();
      if (after !== before || await checkDelegationAccess(job, false) !== 'allowed') return 'unchanged';
      checkedRevision = after;
    }
  }
  const actor = { userId: job.userId, workspaceId: admission.workspaceId };

  try {
    const adapter = assertHistoryContract(job);
    if (terminalWait && projectionReady && adapter.capabilities?.delegationTerminalHistory !== 'v1') return 'unchanged';
    if (job.historyPhase === "admission_pending") {
      await callHistoryAdapter(() => adapter.admitChatGeneration(actor, admission));
      if (terminalWait && !projectionReady || execution?.delegationRecoveryPolicy === 'v1' && job.status !== 'streaming') {
        await provider.setHistoryPhase?.(job.id, 'finalization_pending', { from: ['admission_pending'] });
        return 'ready';
      }
      const snapshot = terminalSnapshot(job, checkedRevision);
      if (snapshot) {
        await provider.setHistoryPhase?.(job.id, "finalization_pending", {
          from: ["admission_pending"],
        });
        const result = await callHistoryAdapter(() => adapter.finalizeChatGeneration(actor, {
          admission,
          snapshot,
        }));
        const phase =
          result.status === "committed" ? "committed" : "superseded";
        await provider.setHistoryPhase?.(job.id, phase, {
          from: ["finalization_pending"],
        });
        return phase;
      }
      await provider.setHistoryPhase?.(job.id, "ready", {
        from: ["admission_pending"],
      });
      return "ready";
    }

    if (job.historyPhase === "finalization_pending") {
      const snapshot = terminalSnapshot(job, checkedRevision);
      if (!snapshot) return "unchanged";
      const result = await callHistoryAdapter(() => adapter.finalizeChatGeneration(actor, {
        admission,
        snapshot,
      }));
      const phase = result.status === "committed" ? "committed" : "superseded";
      await provider.setHistoryPhase?.(job.id, phase, {
        from: ["finalization_pending"],
      });
      return phase;
    }
    return "unchanged";
  } catch (error) {
    if (error instanceof BackgroundHistoryUnsupportedError ||
        (error instanceof Error && 'historyFailure' in error && error.historyFailure === 'blocked')) {
      await provider.setHistoryPhase?.(job.id, "blocked", {
        from: ["admission_pending", "finalization_pending"],
      });
      return "blocked";
    }
    throw error;
  }
}

/** Retry a bounded page of history delivery without rerunning model execution. */
export async function reconcilePendingBackgroundHistory(
  provider: BackgroundJobProvider,
  limit: number,
): Promise<number> {
  if (!provider.getPendingHistoryJobs) return 0;
  const jobs = await provider.getPendingHistoryJobs(Math.max(1, limit));
  let settled = 0;
  let firstError: unknown;
  let hadError = false;
  for (const job of jobs) {
    const phase = job.historyPhase;
    const mayDefer = getChatJobExecution(job)?.delegationRecoveryPolicy === 'v1' && !!job.generationId &&
      (phase === 'admission_pending' || phase === 'finalization_pending') && !!provider.deferDelegationHistory;
    const defer = () => provider.deferDelegationHistory!({ jobId: job.id, userId: job.userId,
      generationId: job.generationId!, phase: phase as 'admission_pending' | 'finalization_pending' });
    let result: Awaited<ReturnType<typeof reconcileBackgroundJobHistory>>;
    try {
      result = await reconcileBackgroundJobHistory(provider, job);
    } catch (error) {
      if (!mayDefer) throw error;
      await defer();
      if (!hadError) { hadError = true; firstError = error; }
      continue;
    }
    if (result !== "unchanged") settled += 1;
    else if (mayDefer) await defer();
  }
  if (hadError) throw firstError;
  return settled;
}

/** Retain complete effect output before replacing it with its bounded reference. */
export async function retainBackgroundToolResult(job: BackgroundJob, result: string, callId: string): Promise<string> {
  const storage = await prepareToolResultStorage(result, { threadId: job.threadId, parentAssistantId: job.messageId, callId });
  if (!storage.rows.length) return result;
  const admission = getChatJobExecution(job)?.history;
  const adapter = historyAdapterFor(job);
  // Providers released before chunk retention keep the complete result inline, as before.
  if (!admission || !adapter?.retainChatToolResult) return result;
  await adapter.retainChatToolResult({ userId: job.userId, workspaceId: admission.workspaceId }, { admission, callId, reference: storage.result, rows: storage.rows });
  return storage.result;
}
