import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeConfig = vi.hoisted(() => ({
    sync: {
        convexUrl: 'https://convex.example',
        convexAdminKey: 'admin-key',
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

vi.mock('~~/convex/_generated/api', () => ({
    api: {
        workspaces: {
            resolveSession: 'workspaces.resolveSession',
            ensure: 'workspaces.ensure',
            listMyWorkspaces: 'workspaces.listMyWorkspaces',
            create: 'workspaces.create',
            update: 'workspaces.update',
            remove: 'workspaces.remove',
            setActive: 'workspaces.setActive',
        },
    },
}));

const queryMock = vi.hoisted(() => vi.fn());
const mutationMock = vi.hoisted(() => vi.fn());
const createdClients = vi.hoisted(() => [] as Array<{ setAdminAuth: ReturnType<typeof vi.fn> }>);

vi.mock('convex/browser', () => ({
    ConvexHttpClient: class {
        url: string;
        setAdminAuth = vi.fn();
        constructor(url: string) {
            this.url = url;
            createdClients.push(this);
        }
        query(...args: unknown[]) {
            return queryMock(...args);
        }
        mutation(...args: unknown[]) {
            return mutationMock(...args);
        }
    },
}));

async function loadStore() {
    return import('or3-provider-convex/src/runtime/server/auth/convex-auth-workspace-store');
}

describe('ConvexAuthWorkspaceStore', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeConfig.sync.convexUrl = 'https://convex.example';
        runtimeConfig.sync.convexAdminKey = 'admin-key';
        queryMock.mockReset();
        mutationMock.mockReset();
        createdClients.length = 0;
    });

    it('throws clear errors for missing convexUrl or convexAdminKey', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        runtimeConfig.sync.convexUrl = '' as any;
        await expect(
            store.getOrCreateUser({ provider: 'clerk', providerUserId: 'u1' })
        ).rejects.toThrow('Convex URL not configured');

        runtimeConfig.sync.convexUrl = 'https://convex.example';
        runtimeConfig.sync.convexAdminKey = '' as any;
        await expect(
            store.getOrCreateUser({ provider: 'clerk', providerUserId: 'u1' })
        ).rejects.toThrow('Convex admin key not configured');
    });

    it('sets admin auth subject/tokenIdentifier from providerUserId', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        queryMock.mockResolvedValue({ id: 'ws-1' });
        await store.getOrCreateUser({ provider: 'clerk', providerUserId: 'user_123' });

        const client = createdClients[0] as { setAdminAuth: ReturnType<typeof vi.fn> };
        expect(client.setAdminAuth).toHaveBeenCalledWith('admin-key', {
            subject: 'user_123',
            issuer: 'https://clerk.or3.ai',
            tokenIdentifier: 'https://clerk.or3.ai|user_123',
        });
    });

    it('getOrCreateUser handles existing-user and create-user paths', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        queryMock.mockResolvedValueOnce({ id: 'ws-1' });
        await expect(
            store.getOrCreateUser({ provider: 'clerk', providerUserId: 'u1' })
        ).resolves.toEqual({ userId: 'u1' });
        expect(mutationMock).not.toHaveBeenCalled();

        queryMock.mockResolvedValueOnce(null);
        mutationMock.mockResolvedValueOnce({ id: 'ws-created' });
        await expect(
            store.getOrCreateUser({ provider: 'clerk', providerUserId: 'u2', email: 'a@test.com', displayName: 'A' })
        ).resolves.toEqual({ userId: 'u2' });
        expect(mutationMock).toHaveBeenCalledWith('workspaces.ensure', {
            provider: 'clerk',
            provider_user_id: 'u2',
            email: 'a@test.com',
            name: 'A',
        });
    });

    it('getOrCreateDefaultWorkspace maps workspace id/name', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        mutationMock.mockResolvedValue({ id: 'ws-1', name: 'Default Workspace' });

        await expect(store.getOrCreateDefaultWorkspace('user-1')).resolves.toEqual({
            workspaceId: 'ws-1',
            workspaceName: 'Default Workspace',
        });
    });

    it('getWorkspaceRole returns null for workspace mismatch', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        queryMock.mockResolvedValue({ id: 'ws-1', role: 'editor' });
        await expect(
            store.getWorkspaceRole({ userId: 'u1', workspaceId: 'ws-2' })
        ).resolves.toBeNull();
    });

    it('normalizes listUserWorkspaces response fields', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        queryMock.mockResolvedValue([
            null,
            {
                _id: 'ws-1',
                name: 'Workspace One',
                description: undefined,
                role: 'owner',
                created_at: 100,
                is_active: 1,
            },
        ]);

        await expect(store.listUserWorkspaces('u1')).resolves.toEqual([
            {
                id: 'ws-1',
                name: 'Workspace One',
                description: null,
                role: 'owner',
                createdAt: 100,
                isActive: true,
            },
        ]);
    });

    it('maps create/update/remove/setActive mutation payloads', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        mutationMock.mockResolvedValueOnce('ws-new');
        await expect(
            store.createWorkspace({ userId: 'u1', name: 'New', description: 'Desc' })
        ).resolves.toEqual({ workspaceId: 'ws-new' });

        await store.updateWorkspace({ userId: 'u1', workspaceId: 'ws-1', name: 'Renamed', description: null });
        await store.removeWorkspace({ userId: 'u1', workspaceId: 'ws-1' });
        await store.setActiveWorkspace({ userId: 'u1', workspaceId: 'ws-2' });

        expect(mutationMock).toHaveBeenCalledWith('workspaces.update', {
            workspace_id: 'ws-1',
            name: 'Renamed',
            description: undefined,
        });
        expect(mutationMock).toHaveBeenCalledWith('workspaces.remove', { workspace_id: 'ws-1' });
        expect(mutationMock).toHaveBeenCalledWith('workspaces.setActive', { workspace_id: 'ws-2' });
    });

    it('propagates backend errors without swallowing', async () => {
        const { ConvexAuthWorkspaceStore } = await loadStore();
        const store = new ConvexAuthWorkspaceStore();

        mutationMock.mockRejectedValue(new Error('backend exploded'));

        await expect(
            store.createWorkspace({ userId: 'u1', name: 'Name' })
        ).rejects.toThrow('backend exploded');
    });
});
