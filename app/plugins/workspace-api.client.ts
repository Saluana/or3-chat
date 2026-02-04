import { registerWorkspaceApi } from '~/core/workspaces/workspace-api-registry';
import { createGatewayWorkspaceApi } from '~/core/workspaces/gateway-workspace-api';

export default defineNuxtPlugin(() => {
    if (import.meta.server) return;

    try {
        registerWorkspaceApi({
            id: 'gateway',
            create: createGatewayWorkspaceApi,
        });
    } catch (error) {
        console.error('[workspace-api] Failed to register gateway api:', error);
    }
});
