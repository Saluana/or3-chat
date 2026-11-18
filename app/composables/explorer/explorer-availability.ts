import { useRuntimeConfig } from '#imports';
import { computed } from 'vue';
import { useSessionContext } from '~/composables/auth/useSessionContext';

export function useExplorerAvailable() {
    const config = useRuntimeConfig().public;
    const { data } = useSessionContext({ autoLoad: false });
    return computed(() => config.ssrAuthEnabled !== true || data.value?.appAccessAllowed === true);
}
