import {
    registerDashboardPluginPage,
    type DashboardPlugin,
} from '~/composables/dashboard/useDashboardPlugins';
import { useIcon } from '~/composables/useIcon';
import { listWorkspaceProfiles } from '~/core/workspace-profiles';

export function createCoreDashboardItems(ssrAuthEnabled: boolean): DashboardPlugin[] {
    const access = ssrAuthEnabled ? { authRequired: true } : undefined;

    return [
        {
            id: 'core:settings',
            icon: useIcon('dashboard.settings').value,
            iconToken: 'dashboard.settings',
            label: 'Settings',
            description: 'Preferences and layout',
            order: 1,
            access,
            pages: [
                {
                    id: 'theme-settings',
                    title: 'Appearance',
                    description: 'Theme and display',
                    iconToken: 'shell.theme.light',
                    component: () => import('~/components/dashboard/ThemePage.vue'),
                },
                {
                    id: 'ai-settings',
                    title: 'AI Settings',
                    description: 'Models, prompts and tools',
                    iconToken: 'ui.sparkles',
                    component: () => import('~/components/dashboard/AiPage.vue'),
                },
                {
                    id: 'workspace-profile-settings',
                    title: 'Workspace Profile',
                    description: 'Navigation and layout',
                    iconToken: 'sidebar.page.default',
                    component: () =>
                        import('~/components/dashboard/WorkspaceProfileSettings.vue'),
                    isAvailable: () => listWorkspaceProfiles().length > 1,
                },
            ],
        },
        {
            id: 'core:images',
            icon: useIcon('dashboard.images').value,
            iconToken: 'dashboard.images',
            label: 'Images',
            description: 'Saved and generated',
            order: 10,
            access,
            pages: [
                {
                    id: 'images-library',
                    title: 'Images',
                    description: 'Browse saved and generated images.',
                    iconToken: 'dashboard.images',
                    component: () => import('~/pages/images/index.vue'),
                },
            ],
        },
    ];
}

export function registerCoreDashboardPages(items: DashboardPlugin[]): void {
    for (const item of items) {
        for (const page of item.pages ?? []) {
            registerDashboardPluginPage(item.id, page);
        }
    }
}
