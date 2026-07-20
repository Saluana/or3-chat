import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const listInstalledExtensionsMock = vi.fn();
vi.mock('../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: listInstalledExtensionsMock as any,
}));

const getWorkspaceSettingsStoreMock = vi.fn(() => ({ id: 'store' }));
vi.mock('../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: getWorkspaceSettingsStoreMock as any,
}));

const getEnabledPluginsMock = vi.fn();
vi.mock('../../../admin/plugins/workspace-plugin-store', () => ({
    getEnabledPlugins: getEnabledPluginsMock as any,
}));

const checkPluginAccessMock = vi.fn();
vi.mock('../../../utils/plugins/access/require-plugin-access', () => ({
    checkPluginAccess: checkPluginAccessMock as any,
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        admin: { pluginRuntimeLoaderEnabled: true },
    }),
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('GET /api/plugins/runtime-manifest', () => {
    beforeEach(() => {
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            workspace: { id: 'ws-1', name: 'Workspace 1' },
        });
        listInstalledExtensionsMock.mockReset().mockResolvedValue([]);
        getWorkspaceSettingsStoreMock.mockReset().mockReturnValue({ id: 'store' });
        getEnabledPluginsMock.mockReset().mockResolvedValue([]);
        checkPluginAccessMock.mockReset().mockResolvedValue({
            session: { authenticated: true },
            decision: { allowed: true, reasons: [], effectivePolicy: {} },
        });
    });

    it('returns empty manifest when SSR auth is disabled', async () => {
        isSsrAuthEnabledMock.mockReturnValue(false);
        const handler = (await import('../runtime-manifest.get')).default as (
            event: H3Event
        ) => Promise<any>;

        const result = await handler(makeEvent());
        expect(result.workspaceId).toBeNull();
        expect(result.enabledPluginIds).toEqual([]);
        expect(result.installedPluginIds).toEqual([]);
        expect(result.runtime).toEqual({});
    });

    it('returns empty manifest when workspace is not resolved', async () => {
        resolveSessionContextMock.mockResolvedValue({ authenticated: true, workspace: undefined });
        const handler = (await import('../runtime-manifest.get')).default as (
            event: H3Event
        ) => Promise<any>;

        const result = await handler(makeEvent());
        expect(result.workspaceId).toBeNull();
        expect(result.enabledPluginIds).toEqual([]);
    });

    it('intersects enabled plugins with installed inventory and includes runtime metadata', async () => {
        listInstalledExtensionsMock.mockResolvedValue([
            {
                kind: 'plugin',
                id: 'alpha',
                name: 'Alpha',
                version: '1.0.0',
                capabilities: [],
                path: '/tmp/alpha',
                runtime: {
                    client: { entry: 'client/main.client.ts' },
                    server: { routes: [{ method: 'GET', path: 'ping', handler: 'server/ping.get.mjs' }] },
                },
            },
            {
                kind: 'plugin',
                id: 'beta',
                name: 'Beta',
                version: '1.0.0',
                capabilities: [],
                path: '/tmp/beta',
            },
            {
                kind: 'theme',
                id: 'theme-1',
                name: 'Theme',
                version: '1.0.0',
                capabilities: [],
                path: '/tmp/theme-1',
            },
        ]);
        getEnabledPluginsMock.mockResolvedValue(['alpha', 'missing', 'alpha']);

        const handler = (await import('../runtime-manifest.get')).default as (
            event: H3Event
        ) => Promise<any>;

        const result = await handler(makeEvent());
        expect(result.workspaceId).toBe('ws-1');
        expect(result.installedPluginIds).toEqual(['alpha', 'beta']);
        expect(result.enabledPluginIds).toEqual(['alpha']);
        expect(result.runtime.alpha).toEqual({
            clientEntry: 'client/main.client.ts',
            hasServerRoutes: true,
            loadAllowed: true,
            loadDeniedReason: undefined,
        });
        expect(result.runtime.beta).toEqual({
            clientEntry: undefined,
            hasServerRoutes: false,
            loadAllowed: false,
            loadDeniedReason: 'plugin-disabled',
        });
        expect(typeof result.revision).toBe('string');
        expect(result.revision.length).toBeGreaterThan(0);
    });

    it('excludes access-denied plugins from enabledPluginIds', async () => {
        listInstalledExtensionsMock.mockResolvedValue([
            {
                kind: 'plugin',
                id: 'alpha',
                name: 'Alpha',
                version: '1.0.0',
                capabilities: [],
                path: '/tmp/alpha',
                runtime: { client: { entry: 'plugin.client.ts' } },
            },
        ]);
        getEnabledPluginsMock.mockResolvedValue(['alpha']);
        checkPluginAccessMock.mockResolvedValue({
            session: { authenticated: true },
            decision: {
                allowed: false,
                reasons: ['insufficient-role'],
                effectivePolicy: {},
            },
        });

        const handler = (await import('../runtime-manifest.get')).default as (
            event: H3Event
        ) => Promise<any>;

        const result = await handler(makeEvent());
        expect(result.enabledPluginIds).toEqual([]);
        expect(result.runtime.alpha.loadAllowed).toBe(false);
        expect(result.runtime.alpha.loadDeniedReason).toBe('insufficient-role');
    });
});
