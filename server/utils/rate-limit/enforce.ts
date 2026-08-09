import { createError, setResponseHeader, type H3Event } from 'h3';
import type { RateLimitResult } from './types';

export function enforceRateLimit(
    event: H3Event,
    result: RateLimitResult,
    message?: string,
): void {
    if (result.allowed) return;
    const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.retryAfterMs ?? 1_000) / 1_000),
    );
    setResponseHeader(event, 'Retry-After', retryAfterSeconds);
    throw createError({
        statusCode: 429,
        statusMessage: message ?? `Rate limit exceeded. Retry after ${retryAfterSeconds}s`,
    });
}
