/**
 * Viewers can read a shared workspace but the server refuses their writes, so
 * editing surfaces lock instead of accepting input that would never sync.
 */
import { computed } from 'vue';
import { getLocalWorkspaceSession, useLocalWorkspaceSession } from '~/composables/auth/useLocalWorkspaceSession';

export const VIEW_ONLY_NOTICE = 'You have view-only access to this workspace.';

export function isViewOnlyMember(): boolean {
    return getLocalWorkspaceSession()?.role === 'viewer';
}

export function useViewOnlyAccess() {
    const data = useLocalWorkspaceSession();
    return computed(() => data.value?.session?.role === 'viewer');
}
