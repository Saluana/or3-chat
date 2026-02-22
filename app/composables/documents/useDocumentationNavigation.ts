import { computed, ref, shallowRef, type Ref } from 'vue';

export interface DocsNavItem {
    label: string;
    path: string;
}

export interface DocsNavGroup {
    label: string;
    items: DocsNavItem[];
}

export interface DocsNavCategory {
    label: string;
    groups: DocsNavGroup[];
}

interface DocmapFile {
    name: string;
    path: string;
    category?: string;
}

interface DocmapSection {
    title: string;
    files?: DocmapFile[];
}

interface Docmap {
    sections?: DocmapSection[];
}

export function useDocumentationNavigation(
    routePath: Ref<string>,
    navigationOverride: Ref<DocsNavCategory[] | undefined>
) {
    const internalNavigation = shallowRef<DocsNavCategory[]>([]);
    const resolvedNavigation = computed<DocsNavCategory[]>(
        () => navigationOverride.value ?? internalNavigation.value
    );

    const expandedGroups = ref<Set<string>>(new Set());

    function groupKey(category: string, group: string) {
        return `${category}::${group}`;
    }

    function isGroupExpanded(category: string, group: string): boolean {
        return expandedGroups.value.has(groupKey(category, group));
    }

    function setGroupExpanded(category: string, group: string, expanded: boolean) {
        const next = new Set(expandedGroups.value);
        const key = groupKey(category, group);
        if (expanded) next.add(key);
        else next.delete(key);
        expandedGroups.value = next;
    }

    function toggleGroup(category: string, group: string) {
        setGroupExpanded(category, group, !isGroupExpanded(category, group));
    }

    function expandGroupsForPath(path: string) {
        const next = new Set(expandedGroups.value);
        for (const category of resolvedNavigation.value) {
            for (const group of category.groups) {
                if (group.items.some((item) => item.path === path)) {
                    next.add(groupKey(category.label, group.label));
                }
            }
        }
        expandedGroups.value = next;
    }

    function applyDocmapNavigation(map: Docmap) {
        if (navigationOverride.value) return;
        if (internalNavigation.value.length) return;

        const sortedSections = [...(map.sections ?? [])].sort((a, b) => {
            const aIsGettingStarted = a.title.toLowerCase() === 'getting started';
            const bIsGettingStarted = b.title.toLowerCase() === 'getting started';
            if (aIsGettingStarted) return -1;
            if (bIsGettingStarted) return 1;
            return a.title.localeCompare(b.title);
        });

        const categories: DocsNavCategory[] = [];

        for (const section of sortedSections) {
            const grouped = new Map<string, DocsNavItem[]>();
            const sortedFiles = [...(section.files ?? [])].sort((a, b) =>
                a.name.replace(/\.md$/i, '').localeCompare(b.name.replace(/\.md$/i, ''))
            );

            for (const file of sortedFiles) {
                const groupLabel = file.category?.trim() || 'General';
                const list = grouped.get(groupLabel) ?? [];
                list.push({
                    label: file.name.replace(/\.md$/i, ''),
                    path: `/documentation${file.path}`,
                });
                grouped.set(groupLabel, list);
            }

            const groups = Array.from(grouped.entries())
                .map(([label, items]) => ({
                    label,
                    items: [...items].sort((a, b) => a.label.localeCompare(b.label)),
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

            categories.push({
                label: section.title,
                groups,
            });
        }

        internalNavigation.value = categories;
        if (routePath.value.startsWith('/documentation')) {
            expandGroupsForPath(routePath.value);
        }
    }

    return {
        internalNavigation,
        resolvedNavigation,
        expandedGroups,
        groupKey,
        isGroupExpanded,
        setGroupExpanded,
        toggleGroup,
        expandGroupsForPath,
        applyDocmapNavigation,
    };
}
