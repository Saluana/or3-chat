import { LRUCache } from 'lru-cache';

/** LLM-specific rate limit config (avoids conflict with sync rate-limiter) */
export interface LlmRateLimitConfig {
    windowMs: number;
    maxRequests: number;
}

/** LLM-specific rate limit result (avoids conflict with sync rate-limiter) */
export interface LlmRateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs?: number;
}

interface RateLimitEntry {
    timestamps: number[];
}

const MAX_ENTRY_AGE_MS = 10 * 60 * 1000;

const rateLimitStore = new LRUCache<string, RateLimitEntry>({
    max: 20_000,
    ttl: MAX_ENTRY_AGE_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

/**
 * Atomically check and record a rate limit request.
 * This prevents TOCTOU race conditions where concurrent requests could bypass limits.
 */
export function checkAndRecordLlmRequest(
    key: string,
    config: LlmRateLimitConfig
): LlmRateLimitResult {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let entry = rateLimitStore.get(key);

    // Initialize or prune expired timestamps
    if (!entry) {
        entry = { timestamps: [] };
    } else {
        entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    }

    const requestCount = entry.timestamps.length;

    // CHECK: If at limit, reject
    if (requestCount >= config.maxRequests) {
        const oldestInWindow = entry.timestamps[0]!;
        const retryAfterMs = oldestInWindow + config.windowMs - now;
        return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(0, retryAfterMs),
        };
    }

    // RECORD: Atomic with check - add timestamp before returning
    entry.timestamps.push(now);
    rateLimitStore.set(key, entry);

    return {
        allowed: true,
        remaining: config.maxRequests - entry.timestamps.length,
    };
}

/**
 * @deprecated Use checkAndRecordLlmRequest for atomic check+record.
 * This is kept for backwards compatibility with getLlmRateLimitStats.
 */
function checkLlmRateLimitInternal(
    key: string,
    config: LlmRateLimitConfig
): LlmRateLimitResult {
    const entry = rateLimitStore.get(key);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    if (!entry) {
        return { allowed: true, remaining: config.maxRequests };
    }

    const recentRequests = entry.timestamps.filter((ts) => ts > windowStart);
    const requestCount = recentRequests.length;
    const remaining = Math.max(0, config.maxRequests - requestCount);

    if (requestCount >= config.maxRequests) {
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

export function getLlmRateLimitStats(
    key: string,
    config: LlmRateLimitConfig
): { limit: number; remaining: number; resetMs: number } {
    const result = checkLlmRateLimitInternal(key, config);
    return {
        limit: config.maxRequests,
        remaining: result.remaining,
        resetMs: config.windowMs,
    };
}

export function resetLlmRateLimits(key?: string): void {
    if (key) {
        rateLimitStore.delete(key);
    } else {
        rateLimitStore.clear();
    }
}
