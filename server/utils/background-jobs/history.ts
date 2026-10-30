import { prepareToolResultStorage } from '~~/shared/chat/tool-result-artifact';
import type { BackgroundJob, BackgroundJobProvider } from "./types";
import { getChatJobExecution } from './types';
import { getSyncGatewayAdapter } from "../../sync/gateway/registry";
import type { CanonicalGenerationSnapshot } from "~~/shared/chat/background-history";
import { readRequestUsage } from '~~/shared/chat/compaction';
import { normalizeHistoryProviderFailure, BackgroundHistoryUnsupportedError } from '../../sync/gateway/history-errors';

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
): CanonicalGenerationSnapshot | null {
  if (job.status === "streaming" || typeof job.completedAt !== "number")
    return null;
  return {
    status: job.status,
    content: job.content,
    reasoning: job.reasoning,
    toolCalls: job.tool_calls,
    usage: readRequestUsage(job.usage),
    error: job.error,
    completedAt: job.completedAt,
  };
}

/** Deliver one job's admission or terminal snapshot to canonical sync history. */
export async function reconcileBackgroundJobHistory(
  provider: BackgroundJobProvider,
  job: BackgroundJob,
): Promise<"ready" | "committed" | "superseded" | "blocked" | "unchanged"> {
  const admission = getChatJobExecution(job)?.history;
  if (!admission || !job.syncProviderId) return "unchanged";
  const actor = { userId: job.userId, workspaceId: admission.workspaceId };

  try {
    const adapter = assertHistoryContract(job);
    if (job.historyPhase === "admission_pending") {
      await callHistoryAdapter(() => adapter.admitChatGeneration(actor, admission));
      const snapshot = terminalSnapshot(job);
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
      const snapshot = terminalSnapshot(job);
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
  for (const job of jobs) {
    const result = await reconcileBackgroundJobHistory(provider, job);
    if (result !== "unchanged") settled += 1;
  }
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
  await adapter.retainChatToolResult({ userId: job.userId, workspaceId: admission.workspaceId }, { admission, rows: storage.rows });
  return storage.result;
}
