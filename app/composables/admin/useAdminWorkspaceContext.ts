import type { Ref } from 'vue';

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

export const ADMIN_WORKSPACE_STATE_KEY = 'admin-selected-workspace';

// Use global Nuxt/Vue composables (auto-imported)
declare const useState: <T>(key: string, init?: () => T) => Ref<T>;
declare const computed: <T>(getter: () => T) => { readonly value: T };
declare const readonly: <T>(ref: { value: T }) => Readonly<{ value: T }>;

export function useAdminWorkspaceContext() {
    // Use useState for shared state across components
    const selectedWorkspaceId = useState<string | null>(
        `${ADMIN_WORKSPACE_STATE_KEY}-id`,
        () => null
    );
    const selectedWorkspace = useState<Workspace | null>(
        `${ADMIN_WORKSPACE_STATE_KEY}-data`,
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
