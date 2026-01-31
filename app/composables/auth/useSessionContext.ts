/**
 * Workspace-aware session context composable.
 * Fetches the full session context including workspace info from the server.
 */
import { computed, ref, watchEffect } from 'vue';
import { $fetch } from 'ofetch';
import { useFetch, useState } from '#imports';
import type { SessionContext } from '~/core/hooks/hook-types';

type SessionPayload = { session: SessionContext | null };

let inFlight: Promise<SessionPayload> | null = null;

/**
 * Fetch workspace-specific session context from the server.
 * - SSR: uses useFetch to hydrate state
 * - Client: uses $fetch to avoid "already mounted" warning
 */
export function useSessionContext() {
    const state = useState<SessionPayload | null>('auth-session', () => null);
    const pending = ref(false);
    const error = ref<Error | null>(null);

    const data = computed<SessionPayload | null>(() => state.value);

    const refresh = async () => {
        // Check-and-assign atomically to prevent race conditions
        if (inFlight) return inFlight;
        
        // Create the promise immediately before any async gap
        const fetchPromise = $fetch<SessionPayload>('/api/auth/session');
        inFlight = fetchPromise;
        
        pending.value = true;
        error.value = null;
        
        return fetchPromise
            .then((res) => {
                state.value = res;
                return res;
            })
            .catch((err) => {
                error.value = err instanceof Error ? err : new Error(String(err));
                throw err;
            })
            .finally(() => {
                pending.value = false;
                inFlight = null;
            });
    };

    if (import.meta.server) {
        const asyncData = useFetch<SessionPayload>('/api/auth/session', {
            key: 'auth-session',
            dedupe: 'defer',
        });

        watchEffect(() => {
            if (asyncData.data.value) {
                state.value = asyncData.data.value;
            }
        });

        return {
            data: computed(() => asyncData.data.value ?? state.value),
            pending: asyncData.pending,
            error: asyncData.error,
            refresh: asyncData.refresh,
        };
    }

    if (!state.value) {
        void refresh();
    }

    return {
        data,
        pending,
        error,
        refresh,
    };
}
