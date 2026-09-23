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
            label: 'Settings',
            order: 1,
            access,
            pages: [
                {
                    id: 'theme-settings',
                    title: 'Theme Settings',
                    description: 'Configure application theme and appearance.',
                    icon: useIcon('ui.view').value,
                    component: () => import('~/components/dashboard/ThemePage.vue'),
                },
                {
                    id: 'ai-settings',
                    title: 'AI Settings',
                    description: 'Configure AI-related preferences and options.',
                    icon: useIcon('dashboard.plugins').value,
                    component: () => import('~/components/dashboard/AiPage.vue'),
                },
                {
                    id: 'workspace-profile-settings',
                    title: 'Workspace Profile',
                    description:
                        'Choose how navigation, dashboard tools, commands, and initial panes are arranged.',
                    icon: 'i-lucide-panels-top-left',
                    component: () =>
                        import('~/components/dashboard/WorkspaceProfileSettings.vue'),
                    isAvailable: () => listWorkspaceProfiles().length > 1,
                },
            ],
        },
        {
            id: 'core:images',
            icon: useIcon('dashboard.images').value,
            label: 'Images',
            order: 10,
            access,
            pages: [
                {
                    id: 'images-library',
                    title: 'Images',
                    description: 'Browse saved and generated images.',
                    icon: useIcon('dashboard.images').value,
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
