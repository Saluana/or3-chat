import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: readBodyMock,
    createError: (opts: { statusCode: number; statusMessage?: string }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
        };
        err.statusCode = opts.statusCode;
        return err;
    },
}));

const requireAdminApiContextMock = vi.fn();
vi.mock('../../../../admin/api', () => ({
    requireAdminApiContext: requireAdminApiContextMock as any,
}));

const resolveAdminWorkspaceTargetMock = vi.fn();
vi.mock('../../../../admin/workspace-target', () => ({
    resolveAdminWorkspaceTarget: resolveAdminWorkspaceTargetMock as any,
}));

const getWorkspaceSettingsStoreMock = vi.fn();
vi.mock('../../../../admin/stores/registry', () => ({
    getWorkspaceSettingsStore: getWorkspaceSettingsStoreMock as any,
}));

const setPluginSettingsMock = vi.fn();
vi.mock('../../../../admin/plugins/workspace-plugin-store', () => ({
    setPluginSettings: setPluginSettingsMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('POST /api/admin/plugins/workspace-settings', () => {
    beforeEach(() => {
        readBodyMock.mockReset();
        requireAdminApiContextMock.mockReset().mockResolvedValue({
            kind: 'super_admin',
        });
        resolveAdminWorkspaceTargetMock.mockReset().mockReturnValue('ws-1');
        getWorkspaceSettingsStoreMock.mockReset().mockReturnValue({});
        setPluginSettingsMock.mockReset().mockResolvedValue(undefined);
    });

    it('accepts valid access policy and persists settings', async () => {
        const handler = (await import('../workspace-settings.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        readBodyMock.mockResolvedValue({
            pluginId: 'plugin.a',
            settings: {
                customKey: 'ok',
                access: {
                    authRequired: true,
                    requiredEntitlements: ['paid'],
                    requiredWorkspaceRoles: ['owner'],
                    mode: 'all',
                },
            },
        });

        await expect(handler(makeEvent())).resolves.toEqual({ ok: true });
        expect(setPluginSettingsMock).toHaveBeenCalledWith(
            {},
            'ws-1',
            'plugin.a',
            expect.objectContaining({
                customKey: 'ok',
                access: expect.objectContaining({ authRequired: true }),
            })
        );
    });

    it('rejects invalid access policy payloads', async () => {
        const handler = (await import('../workspace-settings.post')).default as (
            event: H3Event
        ) => Promise<unknown>;

        readBodyMock.mockResolvedValue({
            pluginId: 'plugin.a',
            settings: {
                access: {
                    requiredWorkspaceRoles: ['superuser'],
                },
            },
        });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
        expect(setPluginSettingsMock).not.toHaveBeenCalled();
    });
});
