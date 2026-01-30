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

const WORKSPACE_STATE_KEY = 'admin-selected-workspace';

// Use global Nuxt/Vue composables (auto-imported)
declare const useState: <T>(key: string, init?: () => T) => Ref<T>;
declare const computed: <T>(getter: () => T) => { readonly value: T };
declare const readonly: <T>(ref: { value: T }) => Readonly<{ value: T }>;

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
    // These standalone functions should only be called within Vue/Nuxt context
    // where useState is auto-imported
    const state = (globalThis as unknown as { useState?: Function }).useState;
    if (!state) return null;
    const id = state(`${WORKSPACE_STATE_KEY}-id`) as { value: string | null };
    return id.value;
}

export function setSelectedWorkspaceId(id: string) {
    const state = (globalThis as unknown as { useState?: Function }).useState;
    if (!state) return;
    const selectedId = state(`${WORKSPACE_STATE_KEY}-id`) as { value: string | null };
    selectedId.value = id;
}
