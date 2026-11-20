/**
 * Workspace-aware session context composable.
 * Fetches the full session context including workspace info from the server.
 */
import { computed, ref, watchEffect } from 'vue';
import { useFetch, useRuntimeConfig, useState } from 'nuxt/app';
import type { ComputedRef, Ref } from 'vue';
import type { SessionContext } from '~/core/hooks/hook-types';
import type { CloudAccess } from '~~/shared/cloud/access';
import { fetchClientSession } from '~/composables/auth/client-session-request';
import { takeBootSession } from '~/utils/boot-session';

export type SessionPayload = {
    session: SessionContext | null;
    appAccessAllowed: boolean;
    workspaceItemCapability?: 'v1';
    explorerCapability?: 'v1';
    secretStoreEnabled?: boolean;
    cloudAccess?: CloudAccess;
};
type SessionRefreshOptions = {
    dedupe?: 'defer';
    shouldCommit?: (payload: SessionPayload) => boolean | Promise<boolean>;
};

type SessionContextState = {
    data: ComputedRef<SessionPayload | null>;
    pending: Ref<boolean>;
    error: Ref<Error | null | undefined>;
    refresh: (options?: SessionRefreshOptions) => Promise<SessionPayload | void>;
};

// Every client refresh owns a monotonic generation. A later auth/workspace
// refresh supersedes older network work even when responses arrive out of order.
let latestRefreshGeneration = 0;

// Dozens of plugins and components call useSessionContext() while the app
// starts. When no session is cached yet they must share one automatic fetch,
// and after any failed check wait before trying again: otherwise a single
// failing check (a 403, or a 429 from the endpoint's own limit) is repeated by
// every caller and the burst itself exhausts the rate limit.
const AUTO_LOAD_COOLDOWN_MS = 10_000;
const clientPending = ref(false);
const clientError = ref<Error | null>(null);
let latestRequest: Promise<SessionPayload | void> | undefined;
let lastSessionFailureAt = 0;

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
 *
 * On the client, a caller that finds no cached session starts one shared
 * fetch. Pass `autoLoad: false` when the caller will `refresh()` right away
 * anyway, so the same request isn't sent twice.
 */
export function useSessionContext(
    options: { autoLoad?: boolean } = {}
): SessionContextState {
    const state = useState<SessionPayload | null>('auth-session', () => null);
    const pending = import.meta.server ? ref(false) : clientPending;
    const error = import.meta.server ? ref<Error | null>(null) : clientError;

    const data = computed<SessionPayload | null>(() => state.value);

    const refresh = async ({ dedupe, shouldCommit }: SessionRefreshOptions = {}) => {
        // Never fetch when auth is disabled (static builds, no server)
        if (isAuthDisabled()) {
            state.value = {
                session: null,
                appAccessAllowed: false,
            };
            return state.value;
        }

        let generation = latestRefreshGeneration;
        let request = latestRequest;
        const canJoin = dedupe === 'defer' && !shouldCommit;
        if (!canJoin || !pending.value || !request) {
            generation = ++latestRefreshGeneration;
            const ownGeneration = generation;
            pending.value = true;
            error.value = null;

            request = latestRequest = (async () => {
                try {
                    const bootSession = shouldCommit ? null : await takeBootSession();
                    const payload = await fetchClientSession(bootSession);
                    if (ownGeneration !== latestRefreshGeneration) return;
                    const commit = !shouldCommit || await shouldCommit(payload);
                    if (ownGeneration !== latestRefreshGeneration) return;
                    if (!commit) return payload;
                    state.value = payload;
                    return state.value;
                } catch (err) {
                    if (ownGeneration !== latestRefreshGeneration) return;
                    lastSessionFailureAt = Date.now();
                    error.value = err instanceof Error ? err : new Error(String(err));
                    throw err;
                } finally {
                    if (ownGeneration === latestRefreshGeneration) pending.value = false;
                }
            })();
        }

        // A deferred validation follows the winner if a newer request takes
        // over. Explicit refreshes settle with the shared request state, but
        // only their own result can trigger caller-specific side effects.
        let superseded = false;
        for (;;) {
            try {
                const payload = await request;
                if (generation === latestRefreshGeneration) {
                    return superseded && !canJoin ? undefined : payload;
                }
            } catch (err) {
                if (generation === latestRefreshGeneration) {
                    if (superseded && !canJoin) return;
                    throw err;
                }
            }
            superseded = true;
            generation = latestRefreshGeneration;
            request = latestRequest;
        }
    };

    if (import.meta.server) {
        // Skip server-side fetch when auth is disabled (static prerender)
        if (isAuthDisabled()) {
            return { data, pending, error, refresh };
        }

        const asyncData = useFetch<SessionPayload>('/api/auth/session', {
            key: 'auth-session',
            dedupe: 'defer',
            retry: 0,
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

    if (
        options.autoLoad !== false &&
        !state.value &&
        !pending.value &&
        Date.now() - lastSessionFailureAt > AUTO_LOAD_COOLDOWN_MS
    ) {
        void refresh({ dedupe: 'defer' }).catch(() => undefined);
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
export function getCachedSessionPayload(): SessionPayload | null {
    try {
        const state = useState<SessionPayload | null>('auth-session');
        return state.value ?? null;
    } catch {
        return null;
    }
}

export function getCachedSessionContext(): SessionContext | null {
    return getCachedSessionPayload()?.session ?? null;
}

/** Refresh the existing client session generation during bounded auth recovery. */
export async function refreshCachedSessionContext(): Promise<void> {
    await useSessionContext().refresh();
}
