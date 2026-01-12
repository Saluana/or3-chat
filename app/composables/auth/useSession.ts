/**
 * Client-side session composable.
 * Uses the server session endpoint when SSR auth is enabled.
 * When disabled, returns unauthenticated state.
 */
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useRuntimeConfig } from '#imports';
import { useSessionContext } from './useSessionContext';

interface SessionState {
    isSignedIn: ComputedRef<boolean>;
    isLoaded: ComputedRef<boolean>;
    userId: ComputedRef<string | null>;
    sessionId: ComputedRef<string | null>;
}

// Static refs for when SSR auth is disabled
const staticRefs: SessionState = {
    isSignedIn: computed(() => false),
    isLoaded: computed(() => true),
    userId: computed(() => null),
    sessionId: computed(() => null),
};

/**
 * Get the current auth session state.
 * Uses Clerk when SSR auth is enabled, otherwise returns unauthenticated state.
 *
 * @returns Session state with isSignedIn, isLoaded, userId, sessionId
 */
export function useSession(): SessionState {
    const config = useRuntimeConfig();
    const isSsrAuthEnabled = config.public?.ssrAuthEnabled === true;

    if (!isSsrAuthEnabled) {
        return staticRefs;
    }

    const { data, status } = useSessionContext();
    const session = computed(() => data.value?.session ?? null);

    return {
        isSignedIn: computed(() => session.value?.authenticated === true),
        isLoaded: computed(() => status.value !== 'pending'),
        userId: computed(() => session.value?.user?.id ?? null),
        // Provider session id is not currently surfaced by the API.
        sessionId: computed(() => null),
    };
}
