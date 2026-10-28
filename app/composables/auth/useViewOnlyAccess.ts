/**
 * Viewers can read a shared workspace but the server refuses their writes, so
 * editing surfaces lock instead of accepting input that would never sync.
 */
import { computed } from 'vue';
import { getCachedSessionContext, useSessionContext } from '~/composables/auth/useSessionContext';

export const VIEW_ONLY_NOTICE = 'You have view-only access to this workspace.';

export function isViewOnlyMember(): boolean {
    return getCachedSessionContext()?.role === 'viewer';
}

export function useViewOnlyAccess() {
    const { data } = useSessionContext();
    return computed(() => data.value?.session?.role === 'viewer');
}
