/**
 * @module server/utils/rate-limit/types
 *
 * Purpose:
 * Define the provider contract and shared types for rate limiting.
 *
 * Responsibilities:
 * - Describe rate limit configuration and result shapes.
 * - Provide the provider interface for pluggable backends.
 *
 * Non-Goals:
 * - Enforcing any particular rate limit policy.
 */

/**
 * Purpose:
 * Result of a rate limit check.
 */
export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Remaining requests in the current window */
    remaining: number;
    /** Milliseconds until rate limit resets when blocked */
    retryAfterMs?: number;
}

/**
 * Purpose:
 * Read-only statistics about a rate limit window.
 */
export interface RateLimitStats {
    /** Maximum requests allowed in the window */
    limit: number;
    /** Remaining requests in the current window */
    remaining: number;
    /** Milliseconds until the window resets */
    resetMs: number;
}

/**
 * Purpose:
 * Configuration for a rate limit window.
 */
export interface RateLimitConfig {
    /** Time window in milliseconds */
    windowMs: number;
    /** Maximum requests allowed in the window */
    maxRequests: number;
}

/**
 * Purpose:
 * Contract for rate limit storage providers.
 *
 * Behavior:
 * - Providers must implement atomic check and record semantics.
 * - Stats queries are read-only and must not mutate state.
 */
export interface RateLimitProvider {
    /** Provider name for logging and diagnostics */
    readonly name: string;

    /**
     * Atomically check and record a request.
     * This is the primary API to avoid race conditions.
     */
    checkAndRecord(key: string, config: RateLimitConfig): Promise<RateLimitResult>;

    /**
     * Retrieve current rate limit stats for a key.
     */
    getStats(key: string, config: RateLimitConfig): Promise<RateLimitStats | null>;
}
