import { computed, type Ref } from 'vue';
import type { Post, Thread } from '~/db';

interface UseSidebarProjectDisplayOptions {
    sidebarQuery: Ref<string>;
    items: Ref<Thread[]>;
    projects: Ref<any[]>;
    docs: Ref<Post[]>;
    threadResults: Ref<Thread[]>;
    projectResults: Ref<Array<{ id: string }>>;
    documentResults: Ref<Post[]>;
    documentsEnabled: Ref<boolean>;
}

export function useSidebarProjectDisplay(options: UseSidebarProjectDisplayOptions) {
    const displayThreads = computed(() =>
        options.sidebarQuery.value.trim()
            ? options.threadResults.value
            : options.items.value
    );

    const projectsFilteredByExistence = computed<any[]>(() => {
        const threadSet = new Set(options.items.value.map((thread) => thread.id));
        const docSet = new Set(options.docs.value.map((doc) => doc.id));

        return options.projects.value.map((project) => {
            const filteredEntries = project.data.filter((entry: any) => {
                const id = entry?.id;
                if (!id) return false;
                const kind = entry.kind ?? 'chat';
                return (
                    (kind === 'chat' && threadSet.has(id)) ||
                    (kind === 'doc' && docSet.has(id)) ||
                    (kind !== 'chat' && kind !== 'doc')
                );
            });

            return filteredEntries.length === project.data.length
                ? project
                : { ...project, data: filteredEntries };
        });
    });

    const displayProjects = computed<any[]>(() => {
        if (!options.sidebarQuery.value.trim()) {
            return projectsFilteredByExistence.value;
        }

        const threadSet = new Set(
            options.threadResults.value.map((thread) => thread.id)
        );
        const docSet = new Set(options.documentResults.value.map((doc) => doc.id));
        const directProjectSet = new Set(
            options.projectResults.value.map((project) => project.id)
        );

        const results: any[] = [];
        for (const project of projectsFilteredByExistence.value) {
            const filteredEntries = project.data.filter(
                (entry: any) => threadSet.has(entry.id) || docSet.has(entry.id)
            );

            if (directProjectSet.has(project.id) || filteredEntries.length > 0) {
                results.push({ ...project, data: filteredEntries });
            }
        }

        return results;
    });

    const displayDocuments = computed(() =>
        options.documentsEnabled.value && options.sidebarQuery.value.trim()
            ? options.documentResults.value
            : undefined
    );

    return {
        displayThreads,
        displayProjects,
        displayDocuments,
    };
}
