import { initializeServerContributionSurfaceSelection } from '../utils/plugins/contribution-surface-selection';

export default defineNitroPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    initializeServerContributionSurfaceSelection(
        runtimeConfig.public?.admin?.pluginContributionV2Surfaces ?? []
    );
});
