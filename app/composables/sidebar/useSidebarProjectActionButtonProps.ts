import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

interface SidebarProjectActionButtonOptions {
    identifier: string;
    icon?: string;
    className?: string;
}

export function useSidebarProjectActionButtonProps(
    options: SidebarProjectActionButtonOptions
) {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'sidebar',
        identifier: options.identifier,
        isNuxtUI: true,
    });

    return computed(() => ({
        color: 'neutral' as const,
        variant: 'popover' as const,
        size: 'sm' as const,
        ...(options.icon ? { icon: options.icon } : {}),
        ...(options.className ? { class: options.className } : {}),
        ...overrides.value,
    }));
}
