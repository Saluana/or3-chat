import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const getQueryMock = vi.fn();

vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: getQueryMock,
    createError: (opts: { statusCode: number; statusMessage?: string; data?: unknown }) => {
        const err = new Error(opts.statusMessage ?? 'Error') as Error & {
            statusCode: number;
            data?: unknown;
        };
        err.statusCode = opts.statusCode;
        err.data = opts.data;
        return err;
    },
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const requirePluginAccessMock = vi.fn();
vi.mock('../../../utils/plugins/access/require-plugin-access', () => ({
    requirePluginAccess: requirePluginAccessMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

describe('GET /api/plugins/protected', () => {
    beforeEach(() => {
        getQueryMock.mockReset().mockReturnValue({ pluginId: 'plugin.a' });
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        requirePluginAccessMock.mockReset();
        requireCanMock.mockReset();
    });

    it('denies unauthenticated access', async () => {
        const handler = (await import('../protected.get')).default as (
            event: H3Event
        ) => Promise<unknown>;

        requirePluginAccessMock.mockRejectedValue(
            Object.assign(new Error('Unauthorized'), { statusCode: 401 })
        );

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 });
        expect(requireCanMock).not.toHaveBeenCalled();
    });

    it('denies missing entitlement', async () => {
        const handler = (await import('../protected.get')).default as (
            event: H3Event
        ) => Promise<unknown>;

        requirePluginAccessMock.mockRejectedValue(
            Object.assign(new Error('Forbidden'), {
                statusCode: 403,
                data: { reason: 'missing-entitlement' },
            })
        );

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 });
        expect(requireCanMock).not.toHaveBeenCalled();
    });

    it('allows entitled users and enforces can() after gate', async () => {
        const handler = (await import('../protected.get')).default as (
            event: H3Event
        ) => Promise<unknown>;

        requirePluginAccessMock.mockResolvedValue({
            session: {
                authenticated: true,
                user: { id: 'u1' },
                workspace: { id: 'ws1', name: 'Workspace 1' },
                role: 'owner',
            },
            decision: {
                allowed: true,
                reasons: [],
                effectivePolicy: {
                    authRequired: true,
                    requiredEntitlements: ['paid'],
                    requiredWorkspaceRoles: [],
                    mode: 'all',
                },
            },
        });

        await expect(handler(makeEvent())).resolves.toEqual({
            ok: true,
            pluginId: 'plugin.a',
            reasons: [],
        });

        expect(requireCanMock).toHaveBeenCalledWith(
            expect.objectContaining({ authenticated: true }),
            'workspace.read',
            { kind: 'workspace', id: 'ws1' }
        );
    });
});
