import { LRUCache } from 'lru-cache';
import type { RateLimitConfig, RateLimitResult } from './types';

type RateLimitEntry = { timestamps: number[] };

export function createSlidingWindowRateLimiter(input: {
    maxEntries: number;
    entryTtlMs: number;
}) {
    const store = new LRUCache<string, RateLimitEntry>({
        max: input.maxEntries,
        ttl: input.entryTtlMs,
        updateAgeOnGet: false,
        updateAgeOnHas: false,
    });

    function recent(entry: RateLimitEntry | undefined, config: RateLimitConfig) {
        const now = Date.now();
        const timestamps = (entry?.timestamps ?? []).filter(
            (timestamp) => timestamp > now - config.windowMs,
        );
        return { now, timestamps };
    }

    function result(
        timestamps: number[],
        now: number,
        config: RateLimitConfig,
    ): RateLimitResult {
        if (timestamps.length >= config.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: Math.max(
                    0,
                    timestamps[0]! + config.windowMs - now,
                ),
            };
        }
        return {
            allowed: true,
            remaining: Math.max(0, config.maxRequests - timestamps.length),
        };
    }

    return {
        check(key: string, config: RateLimitConfig): RateLimitResult {
            const { now, timestamps } = recent(store.get(key), config);
            return result(timestamps, now, config);
        },
        record(key: string, config: RateLimitConfig): void {
            const { now, timestamps } = recent(store.get(key), config);
            timestamps.push(now);
            store.set(key, { timestamps });
        },
        checkAndRecord(key: string, config: RateLimitConfig): RateLimitResult {
            const { now, timestamps } = recent(store.get(key), config);
            const current = result(timestamps, now, config);
            if (!current.allowed) return current;
            timestamps.push(now);
            store.set(key, { timestamps });
            return {
                allowed: true,
                remaining: config.maxRequests - timestamps.length,
            };
        },
        clear(key?: string): void {
            if (key) store.delete(key);
            else store.clear();
        },
    };
}
