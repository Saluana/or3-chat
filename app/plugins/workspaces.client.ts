import { isFeatureEnabled } from '~/composables/useOr3Config';

export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig();
    if (!runtimeConfig.public.ssrAuthEnabled) {
        return;
    }

    const backupEnabled = isFeatureEnabled('backup');

    // Build pages array, conditionally including backup
    const pages = [
        {
            id: 'manage',
            title: 'Manage Workspaces',
            icon: 'pixelarticons:edit',
            iconToken: 'dashboard.workspaces.manage' as const,
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
                      iconToken: 'dashboard.workspaces.backup' as const,
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
        iconToken: 'dashboard.workspaces',
        label: 'Workspaces',
        description: 'Manage and back up your workspaces',
        order: 140,
        access: { authRequired: true },
        pages,
    });
});
