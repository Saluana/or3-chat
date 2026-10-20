import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import { createApp, toWebHandler } from 'h3';
import type { InstalledExtensionRecord } from '../../../../admin/extensions/types';

const resolveSessionContextMock = vi.fn();
vi.mock('../../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const resolveEntitlementsMock = vi.fn();
vi.mock('../../../../auth/entitlements/registry', () => ({
    resolveEntitlements: resolveEntitlementsMock as any,
}));

const listInstalledExtensionsMock = vi.fn();
vi.mock('../../../../admin/extensions/extension-manager', () => ({
    listInstalledExtensions: listInstalledExtensionsMock as any,
}));

const getEnabledPluginsMock = vi.fn();
const getPluginSettingsMock = vi.fn();
const readPluginAccessPolicyMock = vi.fn();
vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({
    getEnabledPlugins: getEnabledPluginsMock as any,
    getPluginSettings: getPluginSettingsMock as any,
    readPluginAccessPolicy: readPluginAccessPolicyMock as any,
}));

vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: () => ({}) as any,
}));
vi.mock('../../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: () => true,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function installedPlugin(id: string): InstalledExtensionRecord {
    return {
        kind: 'plugin',
        id,
        name: id,
        version: '1.0.0',
        description: '',
        capabilities: [],
        access: undefined,
        runtime: undefined,
        path: `/tmp/${id}`,
    };
}

describe('checkPluginAccess', () => {
    beforeEach(() => {
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            provider: 'basic-auth',
            providerUserId: 'provider-user-1',
            user: { id: 'user-1' },
            workspace: { id: 'ws-1', name: 'Workspace 1' },
            role: 'owner',
        });
        resolveEntitlementsMock.mockReset().mockResolvedValue([]);
        listInstalledExtensionsMock.mockReset().mockResolvedValue([]);
        getEnabledPluginsMock.mockReset().mockResolvedValue([]);
        getPluginSettingsMock.mockReset().mockResolvedValue({});
        readPluginAccessPolicyMock.mockReset().mockReturnValue(null);
    });

    it('serves independent batched HTTP decisions with shared request reads', async () => {
        listInstalledExtensionsMock.mockResolvedValue([
            installedPlugin('plugin.one'), installedPlugin('plugin.two'),
        ]);
        getEnabledPluginsMock.mockResolvedValue(['plugin.one']);
        const route = (await import('../../../../api/plugins/access.get')).default;
        const request = toWebHandler(createApp().use(route));
        const response = await request(new Request('http://fixture.test/api/plugins/access?pluginIds=plugin.one&pluginIds=plugin.two&pluginIds=plugin.one'));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const body = await response.json();
        expect(Object.keys(body.decisions)).toEqual(['plugin.one', 'plugin.two']);
        expect(body.decisions['plugin.one'].allowed).toBe(true);
        expect(body.decisions['plugin.two'].reasons).toContain('plugin-disabled');
        expect(listInstalledExtensionsMock).toHaveBeenCalledTimes(1);
        expect(getEnabledPluginsMock).toHaveBeenCalledTimes(1);
        expect(getPluginSettingsMock).toHaveBeenCalledTimes(2);

        // A new request must see policy changes; no cross-request auth cache.
        getEnabledPluginsMock.mockResolvedValue([]);
        const legacy = await request(new Request('http://fixture.test/api/plugins/access?pluginId=plugin.one'));
        expect((await legacy.json()).reasons).toContain('plugin-disabled');
        expect(listInstalledExtensionsMock).toHaveBeenCalledTimes(2);
        const singleBatch = await request(new Request('http://fixture.test/api/plugins/access?pluginIds=plugin.one'));
        expect((await singleBatch.json()).decisions['plugin.one'].allowed).toBe(false);
    });

    it.each([
        '',
        'pluginId=plugin.one&pluginIds=plugin.two',
        Array.from({ length: 51 }, (_, i) => `pluginIds=plugin.${i}`).join('&'),
    ])('rejects invalid or oversized access batches before provider work: %s', async query => {
        const route = (await import('../../../../api/plugins/access.get')).default;
        const response = await toWebHandler(createApp().use(route))(new Request(`http://fixture.test/api/plugins/access?${query}`));
        expect(response.status).toBe(400);
        expect(resolveSessionContextMock).not.toHaveBeenCalled();
        expect(getPluginSettingsMock).not.toHaveBeenCalled();
    });

    it('does not apply extension enabled-list gating to non-extension plugin ids', async () => {
        const { checkPluginAccess } = await import('../require-plugin-access');

        const result = await checkPluginAccess(makeEvent(), {
            pluginId: 'core:settings',
            action: 'view',
        });

        expect(result.decision.allowed).toBe(true);
        expect(result.decision.reasons).toEqual([]);
        expect(getEnabledPluginsMock).not.toHaveBeenCalled();
        expect(getPluginSettingsMock).toHaveBeenCalledWith(
            expect.anything(),
            'ws-1',
            'core:settings'
        );
    });

    it('denies installed extensions that are not in workspace enabled list', async () => {
        const { checkPluginAccess } = await import('../require-plugin-access');
        listInstalledExtensionsMock.mockResolvedValue([installedPlugin('plugin.reports')]);
        getEnabledPluginsMock.mockResolvedValue([]);

        const result = await checkPluginAccess(makeEvent(), {
            pluginId: 'plugin.reports',
            action: 'view',
        });

        expect(result.decision.allowed).toBe(false);
        expect(result.decision.reasons).toContain('plugin-disabled');
        expect(getEnabledPluginsMock).toHaveBeenCalledWith(
            expect.anything(),
            'ws-1'
        );
    });

    it('allows installed extensions when enabled for the workspace', async () => {
        const { checkPluginAccess } = await import('../require-plugin-access');
        listInstalledExtensionsMock.mockResolvedValue([installedPlugin('plugin.reports')]);
        getEnabledPluginsMock.mockResolvedValue(['plugin.reports']);

        const result = await checkPluginAccess(makeEvent(), {
            pluginId: 'plugin.reports',
            action: 'view',
        });

        expect(result.decision.allowed).toBe(true);
        expect(result.decision.reasons).toEqual([]);
    });

    it('applies package-runtime manifest defaults and enabled-list gating', async () => {
        const { checkPluginAccess } = await import('../require-plugin-access');
        getEnabledPluginsMock.mockResolvedValue(['plugin.v2']);
        resolveEntitlementsMock.mockResolvedValue(['paid']);

        const result = await checkPluginAccess(makeEvent(), {
            pluginId: 'plugin.v2',
            action: 'view',
            extension: {
                access: {
                    authRequired: true,
                    requiredEntitlements: ['paid'],
                },
            },
        });

        expect(result.decision.allowed).toBe(true);
        expect(getEnabledPluginsMock).toHaveBeenCalledWith(
            expect.anything(),
            'ws-1'
        );
        expect(listInstalledExtensionsMock).not.toHaveBeenCalled();
    });

    it('denies package-runtime extensions that are disabled for the workspace', async () => {
        const { checkPluginAccess } = await import('../require-plugin-access');

        const result = await checkPluginAccess(makeEvent(), {
            pluginId: 'plugin.v2',
            action: 'view',
            extension: { access: null },
        });

        expect(result.decision.allowed).toBe(false);
        expect(result.decision.reasons).toContain('plugin-disabled');
    });
});
