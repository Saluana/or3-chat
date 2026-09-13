import type { BackgroundJob, BackgroundJobProvider } from "./types";
import { getSyncGatewayAdapter } from "../../sync/gateway/registry";
import type { CanonicalGenerationSnapshot } from "~~/shared/chat/background-history";

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
    const error = new Error(
      `Sync provider "${providerId || "unknown"}" does not support background generation history v1`,
    );
    error.name = "BackgroundHistoryUnsupportedError";
    throw error;
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
    throw new Error(
      `Sync provider "${job.syncProviderId ?? "unknown"}" does not support background generation history v1`,
    );
  }
  return adapter as typeof adapter & {
    admitChatGeneration: NonNullable<typeof adapter.admitChatGeneration>;
    finalizeChatGeneration: NonNullable<typeof adapter.finalizeChatGeneration>;
  };
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
    error: job.error,
    completedAt: job.completedAt,
  };
}

/** Deliver one job's admission or terminal snapshot to canonical sync history. */
export async function reconcileBackgroundJobHistory(
  provider: BackgroundJobProvider,
  job: BackgroundJob,
): Promise<"ready" | "committed" | "superseded" | "blocked" | "unchanged"> {
  const admission = job.execution?.history;
  if (!admission || !job.syncProviderId) return "unchanged";
  const actor = { userId: job.userId, workspaceId: admission.workspaceId };

  try {
    const adapter = assertHistoryContract(job);
    if (job.historyPhase === "admission_pending") {
      await adapter.admitChatGeneration(actor, admission);
      const snapshot = terminalSnapshot(job);
      if (snapshot) {
        await provider.setHistoryPhase?.(job.id, "finalization_pending", {
          from: ["admission_pending"],
        });
        const result = await adapter.finalizeChatGeneration(actor, {
          admission,
          snapshot,
        });
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
      const result = await adapter.finalizeChatGeneration(actor, {
        admission,
        snapshot,
      });
      const phase = result.status === "committed" ? "committed" : "superseded";
      await provider.setHistoryPhase?.(job.id, phase, {
        from: ["finalization_pending"],
      });
      return phase;
    }
    return "unchanged";
  } catch (error) {
    // Provider/network faults remain retryable. Only an explicit contract or
    // validation failure is blocked; transient delivery stays pending.
    const message = error instanceof Error ? error.message : String(error);
    if (
      /does not support|invalid|forbidden|unauthorized|conflict|superseded/i.test(
        message,
      )
    ) {
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
