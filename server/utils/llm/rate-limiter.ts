import { LRUCache } from 'lru-cache';

export interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
}

export interface RateLimitResult {
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

export function checkLlmRateLimit(
    key: string,
    config: RateLimitConfig
): RateLimitResult {
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

export function recordLlmRequest(key: string, config: RateLimitConfig): void {
    const now = Date.now();
    const windowStart = now - config.windowMs;

    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
    }

    entry.timestamps.push(now);
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    rateLimitStore.set(key, entry);
}

export function getLlmRateLimitStats(
    key: string,
    config: RateLimitConfig
): { limit: number; remaining: number; resetMs: number } {
    const result = checkLlmRateLimit(key, config);
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
