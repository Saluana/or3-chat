/**
 * Workspace-aware session context composable.
 * Fetches the full session context including workspace info from the server.
 */
import { computed, ref, watchEffect } from 'vue';
import { $fetch } from 'ofetch';
import { useFetch, useRuntimeConfig, useState } from 'nuxt/app';
import type { ComputedRef, Ref } from 'vue';
import type { SessionContext } from '~/core/hooks/hook-types';
import { recoverClientSession } from '~/composables/auth/useClientSessionRecovery';

export type SessionPayload = {
    session: SessionContext | null;
    appAccessAllowed: boolean;
};
type SessionContextState = {
    data: ComputedRef<SessionPayload | null>;
    pending: Ref<boolean>;
    error: Ref<Error | null | undefined>;
    refresh: () => Promise<SessionPayload | void>;
};

// Every client refresh owns a monotonic generation. A later auth/workspace
// refresh supersedes older network work even when responses arrive out of order.
let latestRefreshGeneration = 0;

/** True when SSR auth is disabled — blocks all network requests. */
function isAuthDisabled(): boolean {
    try {
        return useRuntimeConfig().public.ssrAuthEnabled !== true;
    } catch {
        // runtimeConfig unavailable (e.g. outside Nuxt lifecycle) — assume disabled
        return true;
    }
}

/**
 * Fetch workspace-specific session context from the server.
 * - SSR: uses useFetch to hydrate state
 * - Client: uses $fetch to avoid "already mounted" warning
 *
 * Safety: when `ssrAuthEnabled` is false the composable returns static
 * unauthenticated state and never hits the network.
 */
export function useSessionContext(): SessionContextState {
    const state = useState<SessionPayload | null>('auth-session', () => null);
    const pending = ref(false);
    const error = ref<Error | null>(null);

    const data = computed<SessionPayload | null>(() => state.value);

    const refresh = async () => {
        // Never fetch when auth is disabled (static builds, no server)
        if (isAuthDisabled()) {
            state.value = {
                session: null,
                appAccessAllowed: false,
            };
            return state.value;
        }

        const refreshGeneration = ++latestRefreshGeneration;
        pending.value = true;
        error.value = null;

        const fetchSession = () =>
            $fetch<SessionPayload>('/api/auth/session', {
                // Always bypass caches; workspace switching depends on fresh session reads.
                cache: 'no-store',
            });

        return (async () => {
            try {
                let res = await fetchSession();

                // Access may be expired while refresh is still valid. Let the
                // active provider recover (silent refresh / Clerk session touch)
                // once, then retry. No-op when no recovery is registered.
                if (!res.session?.authenticated) {
                    const recovered = await recoverClientSession();
                    if (recovered) {
                        res = await fetchSession();
                    }
                }

                if (refreshGeneration !== latestRefreshGeneration) {
                    return undefined;
                }
                state.value = res;
                return res;
            } catch (err) {
                if (refreshGeneration === latestRefreshGeneration) {
                    error.value = err instanceof Error ? err : new Error(String(err));
                }
                throw err;
            } finally {
                if (refreshGeneration === latestRefreshGeneration) {
                    pending.value = false;
                }
            }
        })();
    };

    if (import.meta.server) {
        // Skip server-side fetch when auth is disabled (static prerender)
        if (isAuthDisabled()) {
            return { data, pending, error, refresh };
        }

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
        void refresh().catch(() => undefined);
    }

    return {
        data,
        pending,
        error,
        refresh,
    };
}

/**
 * Read the current cached session payload without triggering a network request.
 * Safe to call from non-component utilities (returns null when unavailable).
 */
export function getCachedSessionContext(): SessionContext | null {
    try {
        const state = useState<SessionPayload | null>('auth-session');
        return state.value?.session ?? null;
    } catch {
        return null;
    }
}

/** Refresh the existing client session generation during bounded auth recovery. */
export async function refreshCachedSessionContext(): Promise<void> {
    await useSessionContext().refresh();
}
