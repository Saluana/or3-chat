import { useRuntimeConfig } from '#imports';
import { computed } from 'vue';
import { useLocalWorkspaceSession } from '~/composables/auth/useLocalWorkspaceSession';

export function useExplorerAvailable() {
    const config = useRuntimeConfig().public;
    const data = useLocalWorkspaceSession();
    return computed(() => config.ssrAuthEnabled !== true || data.value?.appAccessAllowed === true);
}
