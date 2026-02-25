import { ref, watch, type Ref } from 'vue';
import { useAdminSession } from '~/composables/admin/useAdminData';
import { useAdminWorkspaceContext } from '~/composables/admin/useAdminWorkspaceContext';

export function useAdminWorkspaceGate(
    refreshWorkspace?: (workspaceId: Ref<string | null>) => void | Promise<void>
) {
    const { hasWorkspace, selectWorkspace, selectedWorkspaceId } =
        useAdminWorkspaceContext();
    const { data: session } = useAdminSession();
    const showWorkspaceSelector = ref(false);

    watch(
        [hasWorkspace, () => session.value?.kind],
        ([hasSelectedWorkspace, adminKind]) => {
            showWorkspaceSelector.value =
                adminKind === 'super_admin' && !hasSelectedWorkspace;
        },
        { immediate: true }
    );

    function onWorkspaceSelected(workspace: unknown) {
        selectWorkspace(workspace as never);
    }

    watch(selectedWorkspaceId, (newId) => {
        if (!newId) {
            if (session.value?.kind === 'super_admin') {
                showWorkspaceSelector.value = true;
            }
            return;
        }
        showWorkspaceSelector.value = false;
        if (refreshWorkspace) {
            void refreshWorkspace(selectedWorkspaceId);
        }
    });

    return {
        selectedWorkspaceId,
        showWorkspaceSelector,
        onWorkspaceSelected,
    };
}
