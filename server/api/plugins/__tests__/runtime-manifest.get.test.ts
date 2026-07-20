import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { createDescriptorKey } from '../../../../shared/plugins/descriptor-key';

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

function legacyEntry(entry: Record<string, unknown>) {
    return {
        clientEntry: entry.clientEntry,
        hasServerRoutes: entry.hasServerRoutes,
        loadAllowed: entry.loadAllowed,
        loadDeniedReason: entry.loadDeniedReason,
    };
}

const defaultEffectivePolicy = {
    authRequired: false,
    requiredEntitlements: [],
    requiredWorkspaceRoles: [],
    mode: 'all',
};

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
            decision: { allowed: true, reasons: [], effectivePolicy: defaultEffectivePolicy },
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
        // A V1 consumer can still select and parse its original exact fields.
        expect(legacyEntry(result.runtime.alpha)).toEqual({
            clientEntry: 'client/main.client.ts',
            hasServerRoutes: true,
            loadAllowed: true,
            loadDeniedReason: undefined,
        });
        expect(legacyEntry(result.runtime.beta)).toEqual({
            clientEntry: undefined,
            hasServerRoutes: false,
            loadAllowed: false,
            loadDeniedReason: 'plugin-disabled',
        });
        expect(result.runtime.alpha).toMatchObject({
            lifecycleCoverage: 'legacy-global-possible',
            descriptorStatus: 'ready',
            descriptor: {
                id: 'alpha',
                version: '1.0.0',
                manifestVersion: 1,
                pluginApiVersion: '1',
                source: 'extension',
                trust: 'trusted-host',
                workspaceId: 'ws-1',
                artifact: {
                    kind: 'bundled-v1',
                    hostBuildId: 'test-host-build',
                    moduleKey: '../../extensions/plugins/alpha/client/main.client.ts',
                    rebuildRequired: true,
                },
            },
        });
        expect(result.runtime.alpha.descriptor.policyRevision).toMatch(/^sha256-[a-f0-9]{64}$/);
        expect(result.runtime.alpha.descriptor.grantsRevision).toMatch(/^sha256-[a-f0-9]{64}$/);
        expect(result.runtime.alpha.descriptor.descriptorKey).toMatch(/^sha256-[a-f0-9]{64}$/);
        const { descriptorKey, ...identity } = result.runtime.alpha.descriptor;
        expect(await createDescriptorKey(identity)).toBe(descriptorKey);
        expect(result.runtime.beta).toMatchObject({
            lifecycleCoverage: 'legacy-global-possible',
            descriptorStatus: 'rebuild-required',
            rebuildRequiredReason: 'not-in-host-build',
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
                effectivePolicy: {
                    ...defaultEffectivePolicy,
                    authRequired: true,
                    requiredWorkspaceRoles: ['owner'],
                },
            },
        });

        const handler = (await import('../runtime-manifest.get')).default as (
            event: H3Event
        ) => Promise<any>;

        const result = await handler(makeEvent());
        expect(result.enabledPluginIds).toEqual([]);
        expect(result.runtime.alpha.loadAllowed).toBe(false);
        expect(result.runtime.alpha.loadDeniedReason).toBe('insufficient-role');
        expect(result.runtime.alpha.descriptorStatus).toBe('ready');
    });

    it('normalizes policy and legacy capability revisions into descriptor identity', async () => {
        const plugin = {
            kind: 'plugin',
            id: 'alpha',
            name: 'Alpha',
            version: '1.0.0',
            capabilities: ['storage', 'network', 'storage'],
            path: '/tmp/alpha',
            runtime: { client: { entry: 'plugin.client.ts' } },
        };
        listInstalledExtensionsMock.mockResolvedValue([plugin]);
        getEnabledPluginsMock.mockResolvedValue(['alpha']);
        checkPluginAccessMock.mockResolvedValue({
            session: { authenticated: true },
            decision: {
                allowed: true,
                reasons: [],
                effectivePolicy: {
                    ...defaultEffectivePolicy,
                    requiredEntitlements: ['write', 'read'],
                    requiredWorkspaceRoles: ['viewer', 'owner'],
                },
            },
        });
        const handler = (await import('../runtime-manifest.get')).default as (
            event: H3Event
        ) => Promise<any>;

        const first = await handler(makeEvent());
        plugin.capabilities = ['network', 'storage'];
        checkPluginAccessMock.mockResolvedValue({
            session: { authenticated: true },
            decision: {
                allowed: true,
                reasons: [],
                effectivePolicy: {
                    ...defaultEffectivePolicy,
                    requiredEntitlements: ['read', 'write'],
                    requiredWorkspaceRoles: ['owner', 'viewer'],
                },
            },
        });
        const reordered = await handler(makeEvent());

        expect(reordered.runtime.alpha.descriptor.descriptorKey).toBe(
            first.runtime.alpha.descriptor.descriptorKey
        );
        expect(reordered.revision).toBe(first.revision);

        checkPluginAccessMock.mockResolvedValue({
            session: { authenticated: true },
            decision: {
                allowed: true,
                reasons: [],
                effectivePolicy: {
                    ...defaultEffectivePolicy,
                    requiredEntitlements: ['read'],
                    requiredWorkspaceRoles: ['owner', 'viewer'],
                },
            },
        });
        const changed = await handler(makeEvent());
        expect(changed.runtime.alpha.descriptor.descriptorKey).not.toBe(
            first.runtime.alpha.descriptor.descriptorKey
        );
        expect(changed.revision).not.toBe(first.revision);
    });
});
