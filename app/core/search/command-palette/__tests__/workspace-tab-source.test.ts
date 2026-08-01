import { afterEach, describe, expect, it } from 'vitest';
import {
    createWorkspaceTabPaletteSource,
    setWorkspaceTabPaletteProvider,
} from '../sources/workspace-tab-source';

describe('workspace-tab palette source', () => {
    let dispose: (() => void) | undefined;

    afterEach(() => dispose?.());

    it('lists tabs by stable tab ID and activates that exact tab', async () => {
        dispose = setWorkspaceTabPaletteProvider(() => [
            {
                id: 'duplicate-chat-tab',
                resource: { kind: 'chat', threadId: 'chat-1' },
                cachedTitle: 'Planning',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: false,
            },
        ]);
        const resources = await createWorkspaceTabPaletteSource().load({
            workspaceId: 'local',
            workspaceGeneration: 1,
            getDb: async () => undefined,
            canOpenNewPane: () => true,
        });

        expect(resources).toHaveLength(1);
        expect(resources[0]).toMatchObject({
            key: 'workspace-tab:duplicate-chat-tab',
            categoryId: 'tab',
            primaryAction: {
                target: {
                    kind: 'workspace-tab',
                    tabId: 'duplicate-chat-tab',
                },
            },
        });
    });
});
