import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';
import type { ThemePlugin } from '~/plugins/90.theme.client';
import { CORE_APP_COMPONENT_DEFAULTS } from '~/theme/_shared/theme-components-registry';

export function usePageShellTheme(themePlugin: ThemePlugin | undefined) {
    const sidebarExpandedComponent = computed(
        () =>
            themePlugin?.activeComponents.value.sidebar ??
            CORE_APP_COMPONENT_DEFAULTS.sidebar
    );
    const sidebarCollapsedComponent = computed(
        () =>
            themePlugin?.activeComponents.value['sidebar-collapsed'] ??
            CORE_APP_COMPONENT_DEFAULTS['sidebar-collapsed']
    );
    const dashboardModalComponent = computed(
        () =>
            themePlugin?.activeComponents.value['dashboard-modal'] ??
            CORE_APP_COMPONENT_DEFAULTS['dashboard-modal']
    );
    const systemPromptsModalComponent = computed(
        () =>
            themePlugin?.activeComponents.value['system-prompts-modal'] ??
            CORE_APP_COMPONENT_DEFAULTS['system-prompts-modal']
    );

    function button(identifier: string, fallback: Record<string, unknown>) {
        const overrides = themePlugin
            ? useThemeOverrides({
                  component: 'button',
                  identifier,
                  isNuxtUI: true,
              })
            : computed(() => ({} as Record<string, unknown>));
        return computed(() => ({ ...fallback, ...overrides.value }));
    }
    const base = {
        class: 'theme-btn',
        variant: 'ghost',
        size: 'sm',
        color: 'neutral',
        ui: { base: 'theme-btn' },
    };
    const sidebarToggleButtonProps = button('shell.sidebar-toggle', base);
    const newPaneButtonProps = button('shell.new-pane', base);
    const themeToggleButtonProps = button('shell.theme-toggle', base);
    const notificationButtonProps = computed(() => ({
        ...themeToggleButtonProps.value,
        square: true,
    }));
    const headerActionButtonProps = button('shell.header-action', {
        ...base,
        color: undefined,
    });
    const paneCloseButtonProps = button('shell.pane-close', {
        ...base,
        size: 'sm',
        ui: {
            base: 'theme-btn',
        },
    });

    return {
        sidebarExpandedComponent,
        sidebarCollapsedComponent,
        dashboardModalComponent,
        systemPromptsModalComponent,
        sidebarToggleButtonProps,
        newPaneButtonProps,
        themeToggleButtonProps,
        notificationButtonProps,
        headerActionButtonProps,
        paneCloseButtonProps,
    };
}
