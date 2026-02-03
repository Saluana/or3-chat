/**
 * @module convex/rateLimits
 *
 * Purpose:
 * Provides persistent, deployment-wide rate limiting primitives backed by
 * Convex storage.
 *
 * Behavior:
 * - Uses a per-key counter with a rolling window start timestamp
 * - `checkAndRecord` is the authoritative "increment and decide" operation
 * - `getStats` is a read-only view for UI/telemetry
 * - `cleanup` removes expired rows to keep table size bounded
 *
 * Constraints:
 * - Rate limiting is only as strong as the key design. Keys must be scoped to
 *   the intended subject (user, workspace, IP, etc.).
 * - Window behavior is per key and uses `Date.now()` timestamps.
 *
 * Non-Goals:
 * - Distributed in-memory token buckets.
 * - Returning HTTP headers (this is storage, not an HTTP layer).
 */

import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';

// ============================================================
// CONSTANTS
// ============================================================

/** Rate limit record retention period in milliseconds (48 hours) */
const RATE_LIMIT_RETENTION_MS = 48 * 60 * 60 * 1000;

/** Batch size for rate limit cleanup operations */
const CLEANUP_BATCH_SIZE = 500;

/** Maximum batches processed per cleanup run */
const MAX_CLEANUP_BATCHES = 5;

// ============================================================
// MUTATIONS
// ============================================================

/**
 * `rateLimits.checkAndRecord` (mutation)
 *
 * Purpose:
 * Atomically records a rate-limit hit for `key` and returns whether the request
 * should be allowed.
 *
 * Behavior:
 * - Creates a new record on first use
 * - Resets the window when expired
 * - Increments within an active window
 * - Returns `retryAfterMs` when blocked
 *
 * Constraints:
 * - This mutation does not authenticate the caller.
 *   Callers must ensure untrusted clients cannot choose arbitrary keys.
 */
export const checkAndRecord = mutation({
    args: {
        key: v.string(),
        windowMs: v.number(),
        maxRequests: v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const windowStart = now - args.windowMs;

        // Find existing record
        const existing = await ctx.db
            .query('rate_limits')
            .withIndex('by_key', (q) => q.eq('key', args.key))
            .unique();

        if (!existing) {
            // First request - create record
            await ctx.db.insert('rate_limits', {
                key: args.key,
                count: 1,
                window_start: now,
                updated_at: now,
            });
            return {
                allowed: true,
                remaining: args.maxRequests - 1,
            };
        }

        // Check if window has expired
        if (existing.window_start < windowStart) {
            // Reset window
            await ctx.db.patch(existing._id, {
                count: 1,
                window_start: now,
                updated_at: now,
            });
            return {
                allowed: true,
                remaining: args.maxRequests - 1,
            };
        }

        // Window still active - check limit
        if (existing.count >= args.maxRequests) {
            const retryAfterMs = existing.window_start + args.windowMs - now;
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(0, retryAfterMs),
            };
        }

        // Increment counter
        await ctx.db.patch(existing._id, {
            count: existing.count + 1,
            updated_at: now,
        });

        return {
            allowed: true,
            remaining: args.maxRequests - existing.count - 1,
        };
    },
});

/**
 * `rateLimits.getStats` (query)
 *
 * Purpose:
 * Returns current window state for a key without incrementing counters.
 *
 * Behavior:
 * - Returns a full allowance when no record exists or the window has expired
 */
export const getStats = query({
    args: {
        key: v.string(),
        windowMs: v.number(),
        maxRequests: v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const windowStart = now - args.windowMs;

        const existing = await ctx.db
            .query('rate_limits')
            .withIndex('by_key', (q) => q.eq('key', args.key))
            .unique();

        if (!existing || existing.window_start < windowStart) {
            return {
                limit: args.maxRequests,
                remaining: args.maxRequests,
                resetMs: args.windowMs,
            };
        }

        return {
            limit: args.maxRequests,
            remaining: Math.max(0, args.maxRequests - existing.count),
            resetMs: existing.window_start + args.windowMs - now,
        };
    },
});

/**
 * `rateLimits.cleanup` (internal mutation)
 *
 * Purpose:
 * Deletes old rate limit rows to prevent unbounded growth.
 *
 * Behavior:
 * - Deletes rows with `updated_at < now - RATE_LIMIT_RETENTION_MS` in batches
 * - Caps work per invocation to avoid long-running cleanup tasks
 */
export const cleanup = internalMutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - RATE_LIMIT_RETENTION_MS;
        let totalDeleted = 0;

        // Process multiple batches per cleanup run
        for (let i = 0; i < MAX_CLEANUP_BATCHES; i++) {
            const oldRecords = await ctx.db
                .query('rate_limits')
                .filter((q) => q.lt(q.field('updated_at'), cutoff))
                .take(CLEANUP_BATCH_SIZE);

            if (oldRecords.length === 0) break;

            await Promise.all(oldRecords.map((r) => ctx.db.delete(r._id)));
            totalDeleted += oldRecords.length;

            if (oldRecords.length < CLEANUP_BATCH_SIZE) break;
        }

        return { deleted: totalDeleted };
    },
});
