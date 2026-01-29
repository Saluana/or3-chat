import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDatabaseNames = vi.fn<() => Promise<string[]>>();
const deleteDb = vi.fn<(name: string) => Promise<void>>();

vi.mock('dexie', () => ({
    default: {
        getDatabaseNames,
        delete: deleteDb,
    },
}));

vi.mock('~/db/client', () => ({
    getDefaultDb: () => ({ name: 'or3-db' }),
}));

const getKvByName = vi.fn();
vi.mock('~/db/kv', () => ({
    getKvByName,
}));

describe('clearWorkspaceDbsOnLogout', () => {
    beforeEach(() => {
        getDatabaseNames.mockReset();
        deleteDb.mockReset();
        getKvByName.mockReset();
    });

    it('deletes only workspace DBs marked for clear', async () => {
        getDatabaseNames.mockResolvedValue([
            'or3-db',
            'or3-db-ws-1',
            'or3-db-ws-2',
        ]);
        getKvByName.mockImplementation(async (name: string) => {
            if (name.endsWith('ws-1')) return { value: 'clear' };
            if (name.endsWith('ws-2')) return { value: 'keep' };
            return null;
        });

        const { clearWorkspaceDbsOnLogout } = await import(
            '~/utils/workspace-db-logout'
        );
        await clearWorkspaceDbsOnLogout();

        expect(deleteDb).toHaveBeenCalledTimes(1);
        expect(deleteDb).toHaveBeenCalledWith('or3-db-ws-1');
    });

    it('does nothing when no workspace databases exist', async () => {
        getDatabaseNames.mockResolvedValue(['or3-db']);
        const { clearWorkspaceDbsOnLogout } = await import(
            '~/utils/workspace-db-logout'
        );
        await clearWorkspaceDbsOnLogout();
        expect(deleteDb).not.toHaveBeenCalled();
    });

    it('falls back to cached workspace list when getDatabaseNames fails', async () => {
        getDatabaseNames.mockRejectedValue(new Error('blocked'));
        getKvByName.mockImplementation(async (name: string) => {
            if (name === 'workspace.manager.cache') {
                return {
                    value: JSON.stringify({
                        workspaces: [{ _id: 'ws-3' }, { _id: 'ws-4' }],
                    }),
                };
            }
            if (name.endsWith('ws-3')) return { value: 'clear' };
            if (name.endsWith('ws-4')) return { value: 'keep' };
            return null;
        });

        const { clearWorkspaceDbsOnLogout } = await import(
            '~/utils/workspace-db-logout'
        );
        await clearWorkspaceDbsOnLogout();

        expect(deleteDb).toHaveBeenCalledTimes(1);
        expect(deleteDb).toHaveBeenCalledWith('or3-db-ws-3');
    });
});
