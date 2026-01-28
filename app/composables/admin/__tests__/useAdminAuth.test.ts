import { describe, it, expect, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useAdminAuth } from '../useAdminAuth';
import type { WorkspaceResponse } from '../useAdminTypes';

describe('useAdminAuth', () => {
    function createWorkspaceData(role: string | undefined): Ref<WorkspaceResponse | null | undefined> {
        return ref(role ? {
            workspace: { id: 'w1', name: 'Test' },
            role,
            members: [],
            enabledPlugins: [],
            guestAccessEnabled: false,
        } : null);
    }

    it('returns undefined role when workspace data is null', () => {
        const data = createWorkspaceData(undefined);
        const { role, isOwner, isEditor, canManage } = useAdminAuth(data);

        expect(role.value).toBeUndefined();
        expect(isOwner.value).toBe(false);
        expect(isEditor.value).toBe(false);
        expect(canManage.value).toBe(false);
    });

    it('identifies owner role correctly', () => {
        const data = createWorkspaceData('owner');
        const { role, isOwner, isEditor, canManage } = useAdminAuth(data);

        expect(role.value).toBe('owner');
        expect(isOwner.value).toBe(true);
        expect(isEditor.value).toBe(true);
        expect(canManage.value).toBe(true);
    });

    it('identifies editor role correctly', () => {
        const data = createWorkspaceData('editor');
        const { role, isOwner, isEditor, canManage } = useAdminAuth(data);

        expect(role.value).toBe('editor');
        expect(isOwner.value).toBe(false);
        expect(isEditor.value).toBe(true);
        expect(canManage.value).toBe(false);
    });

    it('identifies viewer role correctly', () => {
        const data = createWorkspaceData('viewer');
        const { role, isOwner, isEditor, canManage } = useAdminAuth(data);

        expect(role.value).toBe('viewer');
        expect(isOwner.value).toBe(false);
        expect(isEditor.value).toBe(false);
        expect(canManage.value).toBe(false);
    });

    it('reacts to role changes', async () => {
        const data = ref<WorkspaceResponse | null>({
            workspace: { id: 'w1', name: 'Test' },
            role: 'viewer',
            members: [],
            enabledPlugins: [],
            guestAccessEnabled: false,
        });

        const { isOwner, isEditor } = useAdminAuth(data);

        expect(isOwner.value).toBe(false);
        expect(isEditor.value).toBe(false);

        // Change role
        data.value = {
            ...data.value!,
            role: 'owner',
        };

        await nextTick();

        expect(isOwner.value).toBe(true);
        expect(isEditor.value).toBe(true);
    });

    it('handles empty string role as non-owner', () => {
        const data = ref<WorkspaceResponse | null>({
            workspace: { id: 'w1', name: 'Test' },
            role: '',
            members: [],
            enabledPlugins: [],
            guestAccessEnabled: false,
        });

        const { isOwner, isEditor } = useAdminAuth(data);

        expect(isOwner.value).toBe(false);
        expect(isEditor.value).toBe(false);
    });
});
