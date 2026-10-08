import { computed, type Ref } from 'vue';
import type { Post, Project, Thread } from '~/db';
import {
    normalizeProjectData,
    type ProjectEntry,
} from '~/utils/projects/normalizeProjectData';

type SidebarProject = Omit<Project, 'data'> & { data: ProjectEntry[] };

interface UseSidebarProjectDisplayOptions {
    sidebarQuery: Ref<string>;
    items: Ref<Thread[]>;
    projects: Ref<Project[]>;
    docs: Ref<Post[]>;
    threadResults: Ref<Thread[]>;
    projectResults: Ref<Array<{ id: string }>>;
    documentResults: Ref<Post[]>;
    documentsEnabled: Ref<boolean>;
}

export function useSidebarProjectDisplay(
    options: UseSidebarProjectDisplayOptions,
) {
    const displayThreads = computed(() =>
        options.sidebarQuery.value.trim()
            ? options.threadResults.value
            : options.items.value,
    );

    const displayProjects = computed<SidebarProject[]>(() => {
        if (!options.sidebarQuery.value.trim()) {
            // Five Home shortcuts plus one sentinel for Show more. Do not walk
            // the membership of projects that Home will never render.
            return options.projects.value.slice(0, 6).map((project) => ({
                ...project,
                data: normalizeProjectData(project.data),
            }));
        }

        const threadSet = new Set(
            options.threadResults.value.map((thread) => thread.id),
        );
        const docSet = new Set(
            options.documentResults.value.map((doc) => doc.id),
        );
        const directProjectSet = new Set(
            options.projectResults.value.map((project) => project.id),
        );

        const results: SidebarProject[] = [];
        for (const project of options.projects.value) {
            const entries = normalizeProjectData(project.data);
            const filteredEntries = entries.filter((entry) =>
                entry.kind === 'doc'
                    ? docSet.has(entry.id)
                    : threadSet.has(entry.id),
            );

            if (
                directProjectSet.has(project.id) ||
                filteredEntries.length > 0
            ) {
                results.push({ ...project, data: filteredEntries });
                if (results.length === 6) break;
            }
        }

        return results;
    });

    const displayDocuments = computed(() =>
        options.documentsEnabled.value && options.sidebarQuery.value.trim()
            ? options.documentResults.value
            : undefined,
    );

    return {
        displayThreads,
        displayProjects,
        displayDocuments,
    };
}
