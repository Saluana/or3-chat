import { useRuntimeConfig } from '#imports';
import { loadAdminPlugins } from '~/composables/admin/useAdminPlugins';
import { discoverNonCorePlugins } from '~~/shared/plugins/safe-mode';

export default defineNuxtPlugin(async () => {
    const config = useRuntimeConfig();
    if (!config.public.ssrAuthEnabled) return;
    await discoverNonCorePlugins(config.public.admin, loadAdminPlugins);
});
