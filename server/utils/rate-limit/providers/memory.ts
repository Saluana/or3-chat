/**
 * @module server/utils/rate-limit/providers/memory
 *
 * Purpose:
 * In-memory rate limit provider using fixed windows and LRU cache.
 *
 * Responsibilities:
 * - Track request counts per key within a fixed time window.
 * - Provide atomic check-and-record behavior in-process.
 *
 * Non-Goals:
 * - Distributed rate limiting or persistence across restarts.
 * - Sliding window semantics.
 *
 * Constraints:
 * - In-memory only and resets on restart.
 */

import { LRUCache } from 'lru-cache';
import type {
    RateLimitProvider,
    RateLimitConfig,
    RateLimitResult,
    RateLimitStats,
} from '../types';

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours for daily limits

const cache = new LRUCache<string, RateLimitEntry>({
    max: 50_000,
    ttl: MAX_ENTRY_AGE_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

/**
 * Purpose:
 * In-memory implementation of the rate limit provider contract.
 */
export class MemoryRateLimitProvider implements RateLimitProvider {
    readonly name = 'memory';

    async checkAndRecord(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
        const now = Date.now();
        const windowStart = now - config.windowMs;

        let entry = cache.get(key);

        // No entry or window expired - start fresh
        if (!entry || entry.windowStart < windowStart) {
            cache.set(key, { count: 1, windowStart: now });
            return {
                allowed: true,
                remaining: config.maxRequests - 1,
            };
        }

        // Window active - check limit
        if (entry.count >= config.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: entry.windowStart + config.windowMs - now,
            };
        }

        // Increment atomically
        entry.count += 1;
        cache.set(key, entry);

        return {
            allowed: true,
            remaining: config.maxRequests - entry.count,
        };
    }

    async getStats(key: string, config: RateLimitConfig): Promise<RateLimitStats | null> {
        const now = Date.now();
        const windowStart = now - config.windowMs;

        const entry = cache.get(key);

        if (!entry || entry.windowStart < windowStart) {
            return {
                limit: config.maxRequests,
                remaining: config.maxRequests,
                resetMs: config.windowMs,
            };
        }

        return {
            limit: config.maxRequests,
            remaining: Math.max(0, config.maxRequests - entry.count),
            resetMs: entry.windowStart + config.windowMs - now,
        };
    }
}

/**
 * Purpose:
 * Singleton in-memory provider instance.
 */
export const memoryRateLimitProvider = new MemoryRateLimitProvider();
