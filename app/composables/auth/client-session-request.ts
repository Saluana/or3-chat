import { $fetch } from 'ofetch';
import { normalizeError } from '~~/shared/errors';
import type { SessionPayload } from './useSessionContext';
import { recoverClientSession } from './useClientSessionRecovery';

const DEFAULT_SESSION_RETRY_MS = 60_000;
let backoff: { until: number; error: unknown } | undefined;

/** Keep real Retry-After deadlines shared by the tab's session callers. */
export function noteClientSessionRateLimit(error: unknown, now = Date.now()): number | undefined {
    if (normalizeError(error).status !== 429) return undefined;
    // Requests rejected locally during the same window must not extend it.
    if (backoff?.error === error) return backoff?.until;

    const header = (error as { response?: { headers?: Headers } }).response?.headers?.get('retry-after')?.trim();
    const seconds = header ? Number(header) : NaN;
    const delay = Number.isFinite(seconds)
        ? seconds * 1_000
        : header ? Date.parse(header) - now : NaN;
    const until = now + (Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_SESSION_RETRY_MS);
    if (!backoff || until >= backoff.until) backoff = { until, error };
    return backoff.until;
}

export async function fetchClientSession(
    bootSession?: SessionPayload | null,
    signal?: AbortSignal
): Promise<SessionPayload> {
    const fetchSession = async () => {
        signal?.throwIfAborted();
        if (backoff && Date.now() < backoff.until) throw backoff.error;
        backoff = undefined;
        const payload = await $fetch<SessionPayload>('/api/auth/session', {
            cache: 'no-store',
            // ofetch retries failed GETs immediately, including after a 429.
            retry: 0,
            signal,
        }).catch(error => {
            if (!signal?.aborted) noteClientSessionRateLimit(error);
            throw error;
        });
        signal?.throwIfAborted();
        return payload;
    };

    signal?.throwIfAborted();
    const payload = bootSession ?? await fetchSession();
    signal?.throwIfAborted();
    if (!payload.session?.authenticated) {
        // Provider SDK recovery may not support cancellation. Fence its result
        // so an expired validation cannot start another session request.
        const recovered = await recoverClientSession();
        signal?.throwIfAborted();
        if (recovered) return fetchSession();
    }
    return payload;
}
