import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type {
    AdminUserStore,
    WorkspaceAccessStore,
    WorkspaceSettingsStore,
} from '../types';

const runtimeConfig = vi.hoisted(() => ({
    sync: { provider: 'contract-provider' },
    public: { sync: { provider: '' } },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: vi.fn(() => runtimeConfig),
}));
vi.mock('h3', () => ({
    createError: (input: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(input.statusMessage), { statusCode: input.statusCode }),
}));

const event = { context: {} } as H3Event;
const access = {} as WorkspaceAccessStore;
const settings = {} as WorkspaceSettingsStore;
const admins = {} as AdminUserStore;

describe('admin store provider registry', () => {
    beforeEach(async () => {
        runtimeConfig.sync.provider = 'contract-provider';
        const { clearAdminStoreCache } = await import('../registry');
        clearAdminStoreCache();
    });

    it('resolves all three abstractions from the configured provider', async () => {
        const registry = await import('../registry');
        registry.registerAdminStoreProvider({
            id: 'contract-provider',
            createWorkspaceAccessStore: () => access,
            createWorkspaceSettingsStore: () => settings,
            createAdminUserStore: () => admins,
        });

        expect(registry.getWorkspaceAccessStore(event)).toBe(access);
        expect(registry.getWorkspaceSettingsStore(event)).toBe(settings);
        expect(registry.getAdminUserStore(event)).toBe(admins);
    });

    it('fails explicitly when the configured provider has no admin bridge', async () => {
        const registry = await import('../registry');
        runtimeConfig.sync.provider = 'missing-provider';

        expect(() => registry.getWorkspaceAccessStore(event))
            .toThrow(/not implemented for provider: missing-provider/);
        try {
            registry.getAdminUserStore(event);
        } catch (error) {
            expect(error).toMatchObject({ statusCode: 501 });
        }
    });

    it('wraps providers with a legacy namespace in the migration policy', async () => {
        const registry = await import('../registry');
        const legacy = new Map([
            ['ws-1:plugins.enabled', '["attacker"]'],
            ['ws-1:plugin:alpha:setup-values', '{"theme":"retro"}'],
        ]);
        const privateValues = new Map<string, string>();
        registry.registerAdminStoreProvider({
            id: 'contract-provider',
            createWorkspaceAccessStore: () => access,
            createAdminUserStore: () => admins,
            createWorkspaceSettingsStore: () => ({
                async get(workspaceId, key) {
                    return privateValues.get(`${workspaceId}:${key}`) ?? null;
                },
                async set(workspaceId, key, value) {
                    privateValues.set(`${workspaceId}:${key}`, value);
                },
                async getLegacy(workspaceId, key) {
                    return legacy.get(`${workspaceId}:${key}`) ?? null;
                },
            }),
        });

        const store = registry.getWorkspaceSettingsStore(event);
        expect(store).not.toBe(settings);
        await expect(store.get('ws-1', 'plugins.enabled')).resolves.toBeNull();
        await expect(store.get('ws-1', 'plugin:alpha:setup-values')).resolves.toBe(
            '{"theme":"retro"}'
        );
        expect(privateValues.has('ws-1:plugins.enabled')).toBe(false);
        expect(privateValues.get('ws-1:plugin:alpha:setup-values')).toBe(
            '{"theme":"retro"}'
        );
    });

    it('invalidates cached capabilities when HMR replaces a provider', async () => {
        const registry = await import('../registry');
        const capabilities = (supportsWorkspaceManagement: boolean) => ({
            supportsServerSideAdmin: true,
            supportsUserSearch: true,
            supportsWorkspaceList: true,
            supportsWorkspaceManagement,
            supportsDeploymentAdminGrants: true,
        });
        const base = {
            id: 'contract-provider',
            createWorkspaceAccessStore: () => access,
            createWorkspaceSettingsStore: () => settings,
            createAdminUserStore: () => admins,
        };

        registry.registerAdminStoreProvider({
            ...base,
            getCapabilities: () => capabilities(false),
        });
        expect(registry.getAdminStoreCapabilities(event).supportsWorkspaceManagement).toBe(false);

        registry.registerAdminStoreProvider({
            ...base,
            getCapabilities: () => capabilities(true),
        });
        expect(registry.getAdminStoreCapabilities(event).supportsWorkspaceManagement).toBe(true);
    });
});
