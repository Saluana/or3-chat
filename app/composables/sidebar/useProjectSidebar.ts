import { useState } from '#imports';
import { setActiveSidebarPage } from './useActiveSidebarPage';

/** Project navigation belongs to the sidebar; chat ownership is independent. */
export function useProjectSidebar() {
    const projectId = useState<string>('or3-sidebar-project-id', () => '');
    const returnTo = useState<'home' | 'projects'>(
        'or3-sidebar-project-return',
        () => 'home',
    );
    const settingsRequest = useState<string | null>('or3-sidebar-project-settings-request', () => null);
    const navigationGeneration = useState<number>('or3-sidebar-project-navigation-generation', () => 0);

    async function openProjectSidebar(
        id: string,
        from: 'home' | 'projects' = 'home',
        section?: 'Settings',
    ) {
        const generation = ++navigationGeneration.value;
        const previous = projectId.value;
        const previousReturn = returnTo.value;
        projectId.value = id;
        returnTo.value = from;
        const activated = await setActiveSidebarPage('sidebar-projects-home');
        // A superseded sidebar transition must not roll back a newer project
        // selection made through another consumer of this shared state.
        if (generation !== navigationGeneration.value) return;
        if (!activated) {
            projectId.value = previous;
            returnTo.value = previousReturn;
            throw new Error('Projects is unavailable in this workspace.');
        }
        if (section === 'Settings' && projectId.value === id) settingsRequest.value = id;
    }

    async function openProjectsSidebar() {
        const generation = ++navigationGeneration.value;
        const previous = projectId.value;
        projectId.value = '';
        const activated = await setActiveSidebarPage('sidebar-projects-home');
        if (generation !== navigationGeneration.value) return true;
        if (!activated) {
            projectId.value = previous;
            throw new Error('Projects is unavailable in this workspace.');
        }
        return true;
    }

    return { projectId, returnTo, settingsRequest, openProjectSidebar, openProjectsSidebar };
}
