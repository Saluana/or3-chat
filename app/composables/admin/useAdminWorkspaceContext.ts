/**
 * Global workspace selection state for admin pages.
 * In-memory only (no localStorage persistence as per requirements).
 * Uses useState for shared state across the app.
 */
interface Workspace {
    id: string;
    name: string;
    memberCount: number;
    ownerEmail?: string;
}

const WORKSPACE_STATE_KEY = 'admin-selected-workspace';

export function useAdminWorkspaceContext() {
    // Use useState for shared state across components
    const selectedWorkspaceId = useState<string | null>(
        `${WORKSPACE_STATE_KEY}-id`,
        () => null
    );
    const selectedWorkspace = useState<Workspace | null>(
        `${WORKSPACE_STATE_KEY}-data`,
        () => null
    );

    const selectWorkspace = (workspace: Workspace) => {
        selectedWorkspaceId.value = workspace.id;
        selectedWorkspace.value = workspace;
    };

    const clearWorkspace = () => {
        selectedWorkspaceId.value = null;
        selectedWorkspace.value = null;
    };

    const hasWorkspace = computed(() => !!selectedWorkspaceId.value);

    return {
        selectedWorkspaceId: readonly(selectedWorkspaceId),
        selectedWorkspace: readonly(selectedWorkspace),
        selectWorkspace,
        clearWorkspace,
        hasWorkspace,
    };
}

export function getSelectedWorkspaceId(): string | null {
    const id = useState<string | null>(`${WORKSPACE_STATE_KEY}-id`);
    return id.value;
}

export function setSelectedWorkspaceId(id: string) {
    const selectedId = useState<string | null>(`${WORKSPACE_STATE_KEY}-id`);
    selectedId.value = id;
}
