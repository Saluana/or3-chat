import { loadAdminPlugins } from '~/composables/admin/useAdminPlugins';

export default defineNuxtPlugin(async () => {
    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled) return;
    await loadAdminPlugins();
});
