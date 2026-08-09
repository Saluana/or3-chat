import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useWorkspaceResourceActions } from '../useWorkspaceResourceActions';
import { setWorkspaceResourceNavigationApi } from '~/utils/workspaceResourceNavigation';

describe('useWorkspaceResourceActions', () => {
    afterEach(() => {
        setWorkspaceResourceNavigationApi(null);
    });

    it('opens a duplicate tab for any workspace resource', async () => {
        const openResource = vi.fn(async () => true);
        setWorkspaceResourceNavigationApi({
            canOpenInNewTab: () => true,
            canOpenInNewPane: () => true,
            openResource,
        });
        const resource = ref({ kind: 'document' as const, documentId: 'doc-1' });
        const actions = useWorkspaceResourceActions(resource);

        expect(actions.canOpenInNewTab.value).toBe(true);
        await expect(actions.openInNewTab()).resolves.toBe(true);
        expect(openResource).toHaveBeenCalledWith(resource.value, 'new-tab');
    });

    it('reflects pane capacity and prevents a blocked split action', async () => {
        const openResource = vi.fn(async () => true);
        setWorkspaceResourceNavigationApi({
            canOpenInNewTab: () => true,
            canOpenInNewPane: () => false,
            openResource,
        });
        const actions = useWorkspaceResourceActions(
            ref({ kind: 'chat' as const, threadId: 'thread-1' })
        );

        expect(actions.canOpenInNewPane.value).toBe(false);
        await expect(actions.openInNewPane()).resolves.toBe(false);
        expect(openResource).not.toHaveBeenCalled();
    });
});
