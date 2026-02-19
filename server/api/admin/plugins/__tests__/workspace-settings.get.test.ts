import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const getQueryMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: getQueryMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const requireAdminApiMock = vi.fn();
vi.mock('../../../../admin/api', () => ({
    requireAdminApi: requireAdminApiMock as any,
}));

const getWorkspaceSettingsStoreMock = vi.fn();
vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: getWorkspaceSettingsStoreMock as any,
}));

const getPluginSettingsMock = vi.fn();
const getPluginAccessPolicyMock = vi.fn();
vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({
    getPluginSettings: getPluginSettingsMock as any,
    getPluginAccessPolicy: getPluginAccessPolicyMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('GET /api/admin/plugins/workspace-settings', () => {
    beforeEach(() => {
        getQueryMock.mockReset().mockReturnValue({ pluginId: 'plugin.a' });
        requireAdminApiMock.mockReset().mockResolvedValue({
            workspace: { id: 'ws-1' },
        });
        getWorkspaceSettingsStoreMock.mockReset().mockReturnValue({});
        getPluginSettingsMock.mockReset().mockResolvedValue({ foo: 'bar' });
        getPluginAccessPolicyMock.mockReset().mockResolvedValue({
            authRequired: false,
            requiredEntitlements: [],
            requiredWorkspaceRoles: [],
            mode: 'all',
        });
    });

    it('returns settings with normalized effective access policy', async () => {
        const handler = (await import('../workspace-settings.get')).default as (
            event: H3Event
        ) => Promise<unknown>;

        await expect(handler(makeEvent())).resolves.toEqual({
            settings: { foo: 'bar' },
            effectiveAccessPolicy: {
                authRequired: false,
                requiredEntitlements: [],
                requiredWorkspaceRoles: [],
                mode: 'all',
            },
        });
    });
});
