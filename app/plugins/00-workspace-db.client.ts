import { watch } from 'vue';
import { setActiveWorkspaceDb } from '~/db/client';
import { useSessionContext } from '~/composables/auth/useSessionContext';

export default defineNuxtPlugin(async () => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        setActiveWorkspaceDb(null);
        return;
    }

    const { data, refresh } = useSessionContext();

    await refresh();

    const resolveWorkspaceId = () =>
        data.value?.session?.authenticated ? data.value?.session?.workspace?.id ?? null : null;

    setActiveWorkspaceDb(resolveWorkspaceId());

    watch(
        () => data.value?.session,
        () => {
            setActiveWorkspaceDb(resolveWorkspaceId());
        }
    );
});
