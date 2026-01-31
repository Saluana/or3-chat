/**
 * Background Jobs Convex Functions
 *
 * Mutations and queries for managing background streaming jobs.
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Create a new background job
 */
export const create = mutation({
    args: {
        user_id: v.string(),
        thread_id: v.string(),
        message_id: v.string(),
        model: v.string(),
    },
    handler: async (ctx, args) => {
        const jobId = await ctx.db.insert('background_jobs', {
            user_id: args.user_id,
            thread_id: args.thread_id,
            message_id: args.message_id,
            model: args.model,
            status: 'streaming',
            content: '',
            chunks_received: 0,
            started_at: Date.now(),
        });

        return jobId;
    },
});

/**
 * Get a job by ID with user authorization
 */
export const get = query({
    args: {
        job_id: v.id('background_jobs'),
        user_id: v.string(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.job_id);
        if (!job) return null;

        // Authorization check (skip if user_id is '*')
        if (args.user_id !== '*' && job.user_id !== args.user_id) {
            return null;
        }

        return {
            id: job._id,
            userId: job.user_id,
            threadId: job.thread_id,
            messageId: job.message_id,
            model: job.model,
            status: job.status,
            content: job.content,
            chunksReceived: job.chunks_received,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            error: job.error,
        };
    },
});

/**
 * Update a streaming job with new content
 */
export const update = mutation({
    args: {
        job_id: v.id('background_jobs'),
        content_chunk: v.optional(v.string()),
        chunks_received: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.job_id);
        if (!job || job.status !== 'streaming') return;

        const patch: Record<string, unknown> = {};

        if (args.content_chunk !== undefined) {
            patch.content = job.content + args.content_chunk;
        }
        if (args.chunks_received !== undefined) {
            patch.chunks_received = args.chunks_received;
        }

        if (Object.keys(patch).length > 0) {
            await ctx.db.patch(args.job_id, patch);
        }
    },
});

/**
 * Mark a job as successfully completed
 */
export const complete = mutation({
    args: {
        job_id: v.id('background_jobs'),
        content: v.string(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.job_id);
        if (!job) return;

        await ctx.db.patch(args.job_id, {
            status: 'complete',
            content: args.content,
            completed_at: Date.now(),
        });
    },
});

/**
 * Mark a job as failed
 */
export const fail = mutation({
    args: {
        job_id: v.id('background_jobs'),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.job_id);
        if (!job) return;

        await ctx.db.patch(args.job_id, {
            status: 'error',
            error: args.error,
            completed_at: Date.now(),
        });
    },
});

/**
 * Abort a running job
 */
export const abort = mutation({
    args: {
        job_id: v.id('background_jobs'),
        user_id: v.string(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.job_id);
        if (!job) return false;

        // Authorization check
        if (args.user_id !== '*' && job.user_id !== args.user_id) {
            return false;
        }

        // Can only abort streaming jobs
        if (job.status !== 'streaming') {
            return false;
        }

        await ctx.db.patch(args.job_id, {
            status: 'aborted',
            completed_at: Date.now(),
        });

        return true;
    },
});

/**
 * Check if a job should be aborted (for poll-based abort)
 */
export const checkAborted = query({
    args: {
        job_id: v.id('background_jobs'),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.job_id);
        if (!job) return true; // Job doesn't exist, treat as aborted

        return job.status === 'aborted';
    },
});

/**
 * Cleanup expired/stale jobs
 */
export const cleanup = mutation({
    args: {
        timeout_ms: v.optional(v.number()),
        retention_ms: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const timeoutMs = args.timeout_ms ?? 5 * 60 * 1000; // 5 minutes
        const retentionMs = args.retention_ms ?? 5 * 60 * 1000; // 5 minutes
        const now = Date.now();
        const BATCH_SIZE = 100;
        let cleaned = 0;

        // Get streaming jobs that have timed out (batched)
        const streamingJobs = await ctx.db
            .query('background_jobs')
            .withIndex('by_status', (q) => q.eq('status', 'streaming'))
            .take(BATCH_SIZE);

        for (const job of streamingJobs) {
            const age = now - job.started_at;
            if (age > timeoutMs) {
                await ctx.db.patch(job._id, {
                    status: 'error',
                    error: 'Job timed out',
                    completed_at: now,
                });
                cleaned++;
            }
        }

        // Get completed jobs that are stale (batched)
        for (const status of ['complete', 'error', 'aborted'] as const) {
            const jobs = await ctx.db
                .query('background_jobs')
                .withIndex('by_status', (q) => q.eq('status', status))
                .take(BATCH_SIZE);

            for (const job of jobs) {
                const completedAge = now - (job.completed_at ?? job.started_at);
                if (completedAge > retentionMs) {
                    await ctx.db.delete(job._id);
                    cleaned++;
                }
            }
        }

        return cleaned;
    },
});

/**
 * Get active job count
 */
export const getActiveCount = query({
    args: {},
    handler: async (ctx) => {
        const jobs = await ctx.db
            .query('background_jobs')
            .withIndex('by_status', (q) => q.eq('status', 'streaming'))
            .collect();

        return jobs.length;
    },
});
