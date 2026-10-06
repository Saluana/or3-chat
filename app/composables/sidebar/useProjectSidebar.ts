import { useState } from '#imports';
import { setActiveSidebarPage } from './useActiveSidebarPage';

/** Project navigation belongs to the sidebar; chat ownership is independent. */
export function useProjectSidebar() {
    const projectId = useState<string>('or3-sidebar-project-id', () => '');

    async function openProjectSidebar(id: string) {
        const previous = projectId.value;
        projectId.value = id;
        if (!(await setActiveSidebarPage('sidebar-projects-home'))) {
            projectId.value = previous;
            throw new Error('Projects is unavailable in this workspace.');
        }
    }

    return { projectId, openProjectSidebar };
}
