import {
    computed,
    defineAsyncComponent,
    type Component,
    type Ref,
} from 'vue';
import type { SidebarSection } from '~/composables/sidebar/useSidebarSections';

interface ComponentModule {
    default?: Component;
    component?: Component;
}

const componentCache = new Map<string, Component>();

function isVueComponent(source: unknown): source is Component {
    return (
        typeof source === 'object' &&
        source !== null &&
        ('render' in source || 'setup' in source)
    );
}

function resolveSectionComponent(
    id: string,
    source: SidebarSection['component']
): Component {
    if (isVueComponent(source)) return source;
    if (typeof source !== 'function') return source as Component;

    const cached = componentCache.get(id);
    if (cached) return cached;
    const component = defineAsyncComponent(async () => {
        const loaded = await (
            source as () => Promise<ComponentModule | Component>
        )();
        if (typeof loaded === 'object' && 'default' in loaded) {
            const module = loaded as ComponentModule;
            const resolved = module.default ?? module.component;
            if (!resolved) {
                throw new Error(
                    `Sidebar section "${id}" did not export a component`
                );
            }
            return resolved;
        }
        return loaded as Component;
    });
    componentCache.set(id, component);
    return component;
}

export function useResolvedSidebarSections(
    sections: Ref<{
        top: SidebarSection[];
        main: SidebarSection[];
        bottom: SidebarSection[];
    }>
) {
    return computed(() => {
        const map = (entries: SidebarSection[]) =>
            entries.map((entry) => ({
                id: entry.id,
                component: resolveSectionComponent(
                    entry.id,
                    entry.component
                ),
            }));
        return {
            top: map(sections.value.top),
            main: map(sections.value.main),
            bottom: map(sections.value.bottom),
        };
    });
}
