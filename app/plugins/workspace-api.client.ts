import { registerWorkspaceApi } from '~/core/workspace/registry';
import { createGatewayWorkspaceApi } from '~/core/workspace/gateway-workspace-api';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    try {
        registerWorkspaceApi({
            id: 'gateway',
            order: 100,
            create: createGatewayWorkspaceApi,
        });
    } catch (error) {
        console.error('[workspace] Failed to register gateway WorkspaceApi:', error);
    }
});
