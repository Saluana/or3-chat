import { $fetch } from 'ofetch';
import type { SessionPayload } from './useSessionContext';
import { recoverClientSession } from './useClientSessionRecovery';

export async function fetchClientSession(bootSession?: SessionPayload | null): Promise<SessionPayload> {
    const fetchSession = () => $fetch<SessionPayload>('/api/auth/session', {
        cache: 'no-store',
        // ofetch retries failed GETs immediately, including after a 429.
        retry: 0,
    });

    const payload = bootSession ?? await fetchSession();
    if (!payload.session?.authenticated && await recoverClientSession()) {
        return fetchSession();
    }
    return payload;
}
