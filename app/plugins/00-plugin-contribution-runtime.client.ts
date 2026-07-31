import { useRuntimeConfig } from '#imports';
import { initializeContributionSurfaceSelection } from '~/composables/plugins/contribution-surface-selection';

export default defineNuxtPlugin({
    name: 'plugin-contribution-runtime-selection',
    enforce: 'pre',
    setup() {
        const runtimeConfig = useRuntimeConfig();
        initializeContributionSurfaceSelection(
            runtimeConfig.public?.admin?.pluginContributionV2Surfaces ?? []
        );
    },
});
