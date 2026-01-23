/**
 * Convex Rate Limit Provider
 *
 * Uses Convex for persistent rate limiting storage.
 * Falls back to memory provider if Convex calls fail.
 */

import { ConvexHttpClient } from 'convex/browser';
import { api } from '~~/convex/_generated/api';
import type {
    RateLimitProvider,
    RateLimitConfig,
    RateLimitResult,
    RateLimitStats,
} from '../types';
import { memoryRateLimitProvider } from './memory';

export class ConvexRateLimitProvider implements RateLimitProvider {
    readonly name = 'convex';
    private client: ConvexHttpClient | null = null;
    private initialized = false;

    private getClient(): ConvexHttpClient | null {
        if (this.initialized) {
            return this.client;
        }
        this.initialized = true;

        const config = useRuntimeConfig();
        const convexUrl = config.public.sync.convexUrl;

        if (!convexUrl) {
            return null;
        }

        this.client = new ConvexHttpClient(convexUrl);
        return this.client;
    }

    async checkAndRecord(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
        const client = this.getClient();
        if (!client) {
            // Fall back to memory if Convex not available
            return memoryRateLimitProvider.checkAndRecord(key, config);
        }

        try {
            // Atomic check and record
            const result = await client.mutation(api.rateLimits.checkAndRecord, {
                key,
                windowMs: config.windowMs,
                maxRequests: config.maxRequests,
            });

            return {
                allowed: result.allowed,
                remaining: result.remaining,
                retryAfterMs: result.retryAfterMs,
            };
        } catch (error) {
            console.warn('[rate-limit] Convex checkAndRecord failed, falling back to memory:', error);
            return memoryRateLimitProvider.checkAndRecord(key, config);
        }
    }

    async getStats(key: string, config: RateLimitConfig): Promise<RateLimitStats | null> {
        const client = this.getClient();
        if (!client) {
            return memoryRateLimitProvider.getStats(key, config);
        }

        try {
            return await client.query(api.rateLimits.getStats, {
                key,
                windowMs: config.windowMs,
                maxRequests: config.maxRequests,
            });
        } catch (error) {
            console.warn('[rate-limit] Convex getStats failed, falling back to memory:', error);
            return memoryRateLimitProvider.getStats(key, config);
        }
    }
}

// Singleton instance
export const convexRateLimitProvider = new ConvexRateLimitProvider();
