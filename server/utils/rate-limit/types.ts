/**
 * Rate Limit Provider Interface
 *
 * Defines a pluggable storage backend for rate limiting.
 * Implementations can use in-memory, Convex, Redis, Postgres, etc.
 */

export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Remaining requests in the current window */
    remaining: number;
    /** Milliseconds until rate limit resets (if blocked) */
    retryAfterMs?: number;
}

export interface RateLimitStats {
    /** Maximum requests allowed in the window */
    limit: number;
    /** Remaining requests in the current window */
    remaining: number;
    /** Milliseconds until the window resets */
    resetMs: number;
}

export interface RateLimitConfig {
    /** Time window in milliseconds */
    windowMs: number;
    /** Maximum requests allowed in the window */
    maxRequests: number;
}

/**
 * Rate Limit Provider Interface
 *
 * Implement this interface to add a new storage backend for rate limiting.
 * The provider is responsible for tracking request counts within sliding windows.
 *
 * IMPORTANT: Use checkAndRecord() for atomic check-and-increment to prevent
 * race conditions. The separate check() method is only for read-only queries.
 */
export interface RateLimitProvider {
    /** Provider name for logging/debugging */
    readonly name: string;

    /**
     * Atomically check and record a request.
     * This is the primary method - use this to prevent race conditions.
     *
     * @param key - Unique identifier (e.g., "daily:user:123")
     * @param config - Rate limit configuration
     * @returns Rate limit result with allowed status and remaining requests
     */
    checkAndRecord(key: string, config: RateLimitConfig): Promise<RateLimitResult>;

    /**
     * Get current rate limit stats for a key (read-only).
     *
     * @param key - Unique identifier
     * @param config - Rate limit configuration
     * @returns Current stats or null if no data
     */
    getStats(key: string, config: RateLimitConfig): Promise<RateLimitStats | null>;
}
