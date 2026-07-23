import { computed } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

export function useSidebarThemeProps() {
    const selectOverrides = useThemeOverrides({
        component: 'selectmenu',
        context: 'sidebar',
        identifier: 'sidebar.project-select',
        isNuxtUI: true,
    });
    const projectSelect = computed(() => {
        const override =
            selectOverrides.value as Record<string, unknown>;
        const overrideClass =
            typeof override.class === 'string' ? override.class : '';
        return {
            ...override,
            class: ['w-full', overrideClass].filter(Boolean).join(' '),
        };
    });
    const formField = useThemeOverrides({
        component: 'formField',
        context: 'sidebar',
        isNuxtUI: true,
    });
    return { projectSelect, formField };
}
