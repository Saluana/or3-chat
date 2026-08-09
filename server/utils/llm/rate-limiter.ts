/**
 * @module server/utils/llm/rate-limiter
 *
 * Purpose:
 * Provides an in-memory rate limiter dedicated to LLM request paths.
 * This is intentionally separate from sync and storage rate limiting to avoid
 * shared keys and accidental coupling of limits.
 *
 * Responsibilities:
 * - Track recent request timestamps per key in a sliding window.
 * - Provide an atomic check-and-record operation to prevent races.
 * - Expose stats and reset helpers for diagnostics and tests.
 *
 * Non-Goals:
 * - Distributed rate limiting or persistence across restarts.
 * - Per-route enforcement or policy selection.
 *
 * Constraints:
 * - In-memory only and resets on server restart.
 * - Bounded LRU cache to avoid unbounded growth.
 */

import { createSlidingWindowRateLimiter } from '../rate-limit/sliding-window';

/**
 * Purpose:
 * Describes the window and request count limit for an LLM subject.
 *
 * Constraints:
 * - `windowMs` is in milliseconds.
 * - `maxRequests` applies per subject key.
 */
export interface LlmRateLimitConfig {
    windowMs: number;
    maxRequests: number;
}

/**
 * Purpose:
 * Represents the outcome of an LLM rate limit check.
 *
 * Behavior:
 * - `remaining` reflects the number of requests still allowed in the window.
 * - `retryAfterMs` is only present when the request is rejected.
 */
export interface LlmRateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterMs?: number;
}

const MAX_ENTRY_AGE_MS = 10 * 60 * 1000;

const rateLimitStore = createSlidingWindowRateLimiter({
    maxEntries: 20_000,
    entryTtlMs: MAX_ENTRY_AGE_MS,
});

/**
 * Purpose:
 * Perform a single atomic check-and-record step for an LLM request.
 *
 * Behavior:
 * - Prunes timestamps outside the window.
 * - Rejects requests once `maxRequests` is reached.
 * - Records the current request timestamp before returning success.
 *
 * Constraints:
 * - Atomic within a single process. It does not coordinate across instances.
 *
 * Non-Goals:
 * - Emitting metrics or headers. Callers handle that separately.
 *
 * @example
 * ```ts
 * const result = checkAndRecordLlmRequest(userId, { windowMs: 60_000, maxRequests: 30 });
 * if (!result.allowed) return sendTooManyRequests(result.retryAfterMs);
 * ```
 */
export function checkAndRecordLlmRequest(
    key: string,
    config: LlmRateLimitConfig
): LlmRateLimitResult {
    return rateLimitStore.checkAndRecord(key, config);
}

/**
 * @deprecated Use `checkAndRecordLlmRequest` for atomic check and record.
 * This helper is retained for compatibility with `getLlmRateLimitStats`.
 */
function checkLlmRateLimitInternal(
    key: string,
    config: LlmRateLimitConfig
): LlmRateLimitResult {
    return rateLimitStore.check(key, config);
}

/**
 * Purpose:
 * Expose rate limit stats for an LLM subject without mutating state.
 *
 * Behavior:
 * - Returns the configured limit, remaining count, and window size.
 * - Uses the internal non-mutating check for compatibility.
 *
 * Constraints:
 * - Stats are per-process and reset on server restart.
 */
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

/**
 * Purpose:
 * Clear stored LLM rate limit entries for a single key or all keys.
 *
 * Behavior:
 * - When `key` is provided, only that subject is cleared.
 * - When omitted, the entire cache is cleared.
 */
export function resetLlmRateLimits(key?: string): void {
    if (key) {
        rateLimitStore.clear(key);
    } else {
        rateLimitStore.clear();
    }
}
