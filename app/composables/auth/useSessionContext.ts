/**
 * Workspace-aware session context composable.
 * Fetches the full session context including workspace info from the server.
 */
import type { SessionContext } from '~/core/hooks/hook-types';

/**
 * Fetch workspace-specific session context from the server.
 * Uses SSR-safe fetching via useFetch.
 *
 * @returns AsyncData with session context or null
 */
export function useSessionContext() {
    return useFetch<{ session: SessionContext | null }>('/api/auth/session', {
        key: 'auth-session',
        // Don't refetch on client-side navigation; session is stable
        dedupe: 'defer',
    });
}
