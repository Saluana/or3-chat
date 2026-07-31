import { computed, type Ref, type ComputedRef } from 'vue';
import type { WorkspaceResponse } from './useAdminTypes';
import { useAdminWorkspace } from './useAdminData';

export type AdminAuth = {
    role: ComputedRef<string | undefined>;
    isOwner: ComputedRef<boolean>;
    isEditor: ComputedRef<boolean>;
    canManage: ComputedRef<boolean>;
};

/**
 * Extract admin authentication state from workspace data.
 * Provides role-based computed properties for permission checks.
 */
export function useAdminAuth(
    workspaceData: Ref<WorkspaceResponse | null | undefined>
): AdminAuth {
    const role = computed(() => workspaceData.value?.role);
    
    const isOwner = computed(() => role.value === 'owner');
    
    const isEditor = computed(() => 
        role.value === 'owner' || role.value === 'editor'
    );
    
    const canManage = computed(() => isOwner.value);

    return {
        role,
        isOwner,
        isEditor,
        canManage,
    };
}

/**
 * Standalone helper for pages that fetch their own workspace data.
 * Combines useAdminWorkspace and useAdminAuth.
 */
export function useAdminWorkspaceAuth() {
    const { data: workspaceData } = useAdminWorkspace();
    return useAdminAuth(workspaceData);
}
