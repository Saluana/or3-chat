import { $fetch } from 'ofetch';
import type { SessionPayload } from './useSessionContext';
import { recoverClientSession } from './useClientSessionRecovery';

export async function fetchClientSession(
    bootSession?: SessionPayload | null,
    signal?: AbortSignal
): Promise<SessionPayload> {
    const fetchSession = async () => {
        signal?.throwIfAborted();
        const payload = await $fetch<SessionPayload>('/api/auth/session', {
            cache: 'no-store',
            // ofetch retries failed GETs immediately, including after a 429.
            retry: 0,
            signal,
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
