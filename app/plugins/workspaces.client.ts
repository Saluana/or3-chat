import { useOr3Config, isFeatureEnabled } from '~/composables/useOr3Config';

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    const or3Config = useOr3Config();
    const backupEnabled = isFeatureEnabled('backup');

    // Build pages array, conditionally including backup
    const pages = [
        {
            id: 'manage',
            title: 'Manage Workspaces',
            icon: 'pixelarticons:edit',
            description: 'Create, switch, and configure workspace settings.',
            component: async () =>
                await import('./workspaces/WorkspaceManager.vue'),
        },
        // Only include backup page if backup feature is enabled
        ...(backupEnabled
            ? [
                  {
                      id: 'backup',
                      title: 'Backup & Restore',
                      icon: 'pixelarticons:upload',
                      description: 'Export and import full workspace backups.',
                      component: async () =>
                          await import('~/components/dashboard/workspace/WorkspaceBackupApp.vue'),
                  },
              ]
            : []),
    ];

    registerDashboardPlugin({
        id: 'workspaces',
        icon: 'pixelarticons:users',
        label: 'Workspaces',
        description: 'Manage and backup your workspaces',
        order: 140,
        pages,
    });
});
