/**
 * Rate Limits Convex Functions
 *
 * Provides persistent rate limiting storage via Convex.
 * Uses a simple counter with window tracking.
 */

import { v } from 'convex/values';
import { mutation, query, internalMutation } from './_generated/server';

/**
 * Check and record a rate limit hit atomically.
 * Returns whether the request is allowed.
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
 * Get current rate limit stats without recording.
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
 * Cleanup old rate limit records (run via cron)
 */
export const cleanup = internalMutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
        const BATCH_SIZE = 500;
        let totalDeleted = 0;

        // Process multiple batches per cleanup run (up to 5x)
        for (let i = 0; i < 5; i++) {
            const oldRecords = await ctx.db
                .query('rate_limits')
                .filter((q) => q.lt(q.field('updated_at'), cutoff))
                .take(BATCH_SIZE);

            if (oldRecords.length === 0) break;

            await Promise.all(oldRecords.map((r) => ctx.db.delete(r._id)));
            totalDeleted += oldRecords.length;

            if (oldRecords.length < BATCH_SIZE) break;
        }

        return { deleted: totalDeleted };
    },
});
