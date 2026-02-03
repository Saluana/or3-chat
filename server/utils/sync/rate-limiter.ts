/**
 * @module server/utils/sync/rate-limiter
 *
 * Purpose:
 * In-memory sliding window rate limits for sync, storage, and auth requests.
 * This module protects SSR endpoints from sustained abuse while allowing
 * normal usage patterns.
 *
 * Responsibilities:
 * - Provide per-subject limits for known operations.
 * - Track recent request timestamps in a sliding window.
 * - Expose stats and reset helpers for tests and diagnostics.
 *
 * Non-Goals:
 * - Distributed or persistent rate limiting.
 * - Per-route policy selection beyond the provided operation keys.
 *
 * Constraints:
 * - In-memory and resets on server restart.
 * - LRU cache bounds memory usage.
 */

import { LRUCache } from 'lru-cache';

import type {
    RateLimitConfig,
    RateLimitResult,
} from '../rate-limit/types';

interface RateLimitEntry {
    /** Timestamps of requests in the current window */
    timestamps: number[];
}

/**
 * Purpose:
 * Rate limits for sync operations, tuned for chat editor usage patterns.
 */
export const SYNC_RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Push: 200 ops per minute
    'sync:push': { windowMs: 60_000, maxRequests: 200 },
    // Pull: 120 requests per minute
    'sync:pull': { windowMs: 60_000, maxRequests: 120 },
    // Cursor updates: 60 requests per minute
    'sync:cursor': { windowMs: 60_000, maxRequests: 60 },
} as const;

/**
 * Purpose:
 * Rate limits for storage operations.
 */
export const STORAGE_RATE_LIMITS: Record<string, RateLimitConfig> = {
    'storage:upload': { windowMs: 60_000, maxRequests: 50 },
    'storage:download': { windowMs: 60_000, maxRequests: 100 },
    // Storage commit: 30 per minute per user
    'storage:commit': { windowMs: 60_000, maxRequests: 30 },
};

/**
 * Purpose:
 * Rate limits for auth session discovery.
 */
export const AUTH_RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Auth session: 60 per minute per IP
    'auth:session': { windowMs: 60_000, maxRequests: 60 },
};

/**
 * Purpose:
 * Combined lookup table for all known rate limit operations.
 */
export const ALL_RATE_LIMITS = {
    ...SYNC_RATE_LIMITS,
    ...STORAGE_RATE_LIMITS,
    ...AUTH_RATE_LIMITS,
};

/** Maximum age for entries before cleanup (10 minutes). */
const MAX_ENTRY_AGE_MS = 10 * 60 * 1000;

/**
 * Rate limit store using LRU cache to prevent unbounded growth.
 */
const rateLimitStore = new LRUCache<string, RateLimitEntry>({
    max: 10_000,
    ttl: MAX_ENTRY_AGE_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

/**
 * Purpose:
 * Build a cache key from a subject identifier and operation.
 */
function getRateLimitKey(subjectKey: string, operation: string): string {
    return `${subjectKey}:${operation}`;
}

/**
 * Purpose:
 * Check whether a request is allowed under the configured limits.
 *
 * Behavior:
 * - Does not record the request. Call `recordSyncRequest` after success.
 * - Unknown operations are allowed by default.
 *
 * Constraints:
 * - Sliding window is computed in-process only.
 */
export function checkSyncRateLimit(subjectKey: string, operation: string): RateLimitResult {
    const config = ALL_RATE_LIMITS[operation as keyof typeof ALL_RATE_LIMITS];
    if (!config) {
        // Unknown operation - allow by default
        return { allowed: true, remaining: Infinity };
    }

    const key = getRateLimitKey(subjectKey, operation);
    const entry = rateLimitStore.get(key);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    if (!entry) {
        return { allowed: true, remaining: config.maxRequests };
    }

    // Filter to only requests within the current window
    const recentRequests = entry.timestamps.filter((ts) => ts > windowStart);
    const requestCount = recentRequests.length;
    const remaining = Math.max(0, config.maxRequests - requestCount);

    if (requestCount >= config.maxRequests) {
        // Find when the oldest request in the window will expire
        const oldestInWindow = recentRequests[0]!;
        const retryAfterMs = oldestInWindow + config.windowMs - now;

        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, retryAfterMs),
        };
    }

    return { allowed: true, remaining };
}

/**
 * Purpose:
 * Record a request for a subject and operation.
 *
 * Behavior:
 * - Adds a timestamp to the sliding window.
 * - Prunes timestamps outside the current window.
 *
 * Constraints:
 * - Call only after a request is allowed.
 */
export function recordSyncRequest(subjectKey: string, operation: string): void {
    const config = ALL_RATE_LIMITS[operation as keyof typeof ALL_RATE_LIMITS];
    if (!config) {
        return;
    }

    const key = getRateLimitKey(subjectKey, operation);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
    }

    // Add current request timestamp
    entry.timestamps.push(now);

    // Prune old timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    rateLimitStore.set(key, entry);
}

/**
 * Purpose:
 * Reset rate limit entries for a subject or all subjects.
 *
 * Behavior:
 * - When `subjectKey` is provided, clears known operations for that subject.
 * - When omitted, clears the entire cache.
 */
export function resetSyncRateLimits(subjectKey?: string): void {
    if (subjectKey) {
        for (const operation of Object.keys(ALL_RATE_LIMITS)) {
            rateLimitStore.delete(getRateLimitKey(subjectKey, operation));
        }
    } else {
        rateLimitStore.clear();
    }
}

/**
 * Purpose:
 * Retrieve rate limit stats for diagnostics or headers.
 *
 * Behavior:
 * - Returns `null` when the operation is unknown.
 */
export function getSyncRateLimitStats(
    subjectKey: string,
    operation: string
): { limit: number; remaining: number; resetMs: number } | null {
    const config = ALL_RATE_LIMITS[operation as keyof typeof ALL_RATE_LIMITS];
    if (!config) {
        return null;
    }

    const result = checkSyncRateLimit(subjectKey, operation);
    return {
        limit: config.maxRequests,
        remaining: result.remaining,
        resetMs: config.windowMs,
    };
}
