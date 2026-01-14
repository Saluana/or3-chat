export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    registerDashboardPlugin({
        id: 'workspaces',
        icon: 'pixelarticons:users',
        label: 'Workspaces',
        description: 'Manage and backup your workspaces',
        order: 140,
        pages: [
            {
                id: 'manage',
                title: 'Manage Workspaces',
                icon: 'pixelarticons:edit',
                description: 'Create, switch, and configure workspace settings.',
                component: async () =>
                    await import('./workspaces/WorkspaceManager.vue'),
            },
            {
                id: 'backup',
                title: 'Backup & Restore',
                icon: 'pixelarticons:upload',
                description: 'Export and import full workspace backups.',
                component: async () =>
                    await import('~/components/dashboard/workspace/WorkspaceBackupApp.vue'),
            },
        ],
    });
});
