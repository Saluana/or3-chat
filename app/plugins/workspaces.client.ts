export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    registerDashboardPlugin({
        id: 'workspaces',
        icon: 'pixelarticons:users',
        label: 'Workspaces',
        description: 'Select, create, and manage workspace metadata',
        order: 140,
        pages: [
            {
                id: 'manage',
                title: 'Workspaces',
                icon: 'pixelarticons:edit',
                description: 'Manage workspace access and settings',
                component: async () =>
                    await import('./workspaces/WorkspaceManager.vue'),
            },
        ],
    });
});
