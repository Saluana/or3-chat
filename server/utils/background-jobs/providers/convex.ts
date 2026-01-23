/**
 * Convex Background Job Provider
 *
 * Persistent implementation using Convex database.
 * Jobs survive server restarts and work across multiple instances.
 *
 * Best for: Production, multi-instance deployments.
 *
 * Note: This provider uses poll-based abort detection since AbortControllers
 * are in-process and can't be shared across instances.
 */

import type {
  BackgroundJobProvider,
  BackgroundJob,
  CreateJobParams,
  JobUpdate,
} from "../types";
import { getJobConfig } from "../store";
import { ConvexHttpClient } from "convex/browser";
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";

/**
 * Get a Convex HTTP client for server-side calls
 */
function getClient(): ConvexHttpClient {
  const config = useRuntimeConfig();
  const url = config.public.sync.convexUrl as string | undefined;
  if (!url) {
    throw new Error("Convex URL not configured");
  }
  return new ConvexHttpClient(url);
}

export const convexJobProvider: BackgroundJobProvider = {
  name: "convex",

  async createJob(params: CreateJobParams): Promise<string> {
    const client = getClient();
    const config = getJobConfig();

    // Check active count first
    const activeCount = await client.query(
      api.backgroundJobs.getActiveCount,
      {},
    );
    if (activeCount >= config.maxConcurrentJobs) {
      throw new Error(
        `Max concurrent background jobs reached (${config.maxConcurrentJobs})`,
      );
    }

    const jobId = await client.mutation(api.backgroundJobs.create, {
      user_id: params.userId,
      thread_id: params.threadId,
      message_id: params.messageId,
      model: params.model,
    });

    return jobId as string;
  },

  async getJob(jobId: string, userId: string): Promise<BackgroundJob | null> {
    const client = getClient();
    const job = await client.query(api.backgroundJobs.get, {
      job_id: jobId as Id<"background_jobs">,
      user_id: userId,
    });

    if (!job) return null;

    return {
      id: job.id as string,
      userId: job.userId,
      threadId: job.threadId,
      messageId: job.messageId,
      model: job.model,
      status: job.status,
      content: job.content,
      chunksReceived: job.chunksReceived,
      startedAt: job.startedAt,
      completedAt: job.completedAt ?? undefined,
      error: job.error ?? undefined,
    };
  },

  async updateJob(jobId: string, update: JobUpdate): Promise<void> {
    const client = getClient();
    await client.mutation(api.backgroundJobs.update, {
      job_id: jobId as Id<"background_jobs">,
      content_chunk: update.contentChunk,
      chunks_received: update.chunksReceived,
    });
  },

  async completeJob(jobId: string, finalContent: string): Promise<void> {
    const client = getClient();
    await client.mutation(api.backgroundJobs.complete, {
      job_id: jobId as Id<"background_jobs">,
      content: finalContent,
    });
  },

  async failJob(jobId: string, error: string): Promise<void> {
    const client = getClient();
    await client.mutation(api.backgroundJobs.fail, {
      job_id: jobId as Id<"background_jobs">,
      error,
    });
  },

  async abortJob(jobId: string, userId: string): Promise<boolean> {
    const client = getClient();
    return await client.mutation(api.backgroundJobs.abort, {
      job_id: jobId as Id<"background_jobs">,
      user_id: userId,
    });
  },

  // Convex provider doesn't have AbortControllers (they're in-process)
  // Streaming loop must poll for abort status using checkAborted query
  getAbortController(_jobId: string): AbortController | undefined {
    return undefined;
  },

  async cleanupExpired(): Promise<number> {
    const client = getClient();
    const config = getJobConfig();
    return await client.mutation(api.backgroundJobs.cleanup, {
      timeout_ms: config.jobTimeoutMs,
      retention_ms: config.completedJobRetentionMs,
    });
  },

  async getActiveJobCount(): Promise<number> {
    const client = getClient();
    return await client.query(api.backgroundJobs.getActiveCount, {});
  },
};

/**
 * Check if a job should be aborted (for poll-based abort).
 * Call this periodically during streaming to detect user-initiated aborts.
 */
export async function checkJobAborted(jobId: string): Promise<boolean> {
  const client = getClient();
  return await client.query(api.backgroundJobs.checkAborted, {
    job_id: jobId as Id<"background_jobs">,
  });
}
