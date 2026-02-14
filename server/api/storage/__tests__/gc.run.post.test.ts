import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const useRuntimeConfigMock = vi.fn();

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

vi.mock('#imports', () => ({
    useRuntimeConfig: useRuntimeConfigMock as any,
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as any,
}));

const requireCanMock = vi.fn();
vi.mock('../../../auth/can', () => ({
    requireCan: requireCanMock as any,
}));

const isSsrAuthEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({
    isSsrAuthEnabled: isSsrAuthEnabledMock as any,
}));

const isStorageEnabledMock = vi.fn(() => true);
vi.mock('../../../utils/storage/is-storage-enabled', () => ({
    isStorageEnabled: isStorageEnabledMock as any,
}));

const gcMock = vi.fn();
const getActiveStorageGatewayAdapterMock = vi.fn();
vi.mock('../../../storage/gateway/registry', () => ({
    getActiveStorageGatewayAdapter: getActiveStorageGatewayAdapterMock as any,
}));

function makeEvent(): H3Event {
    return { context: {}, node: { req: { headers: {} } } } as H3Event;
}

function makeBody() {
    return {
        workspace_id: 'ws-1',
        retention_seconds: 100,
        limit: 50,
    };
}

async function loadHandler() {
    return (await import('../gc/run.post')).default as (event: H3Event) => Promise<unknown>;
}

describe('POST /api/storage/gc/run', () => {
    beforeEach(() => {
        vi.resetModules();
        readBodyMock.mockReset();
        resolveSessionContextMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'ws-1' },
        });
        requireCanMock.mockReset();
        isSsrAuthEnabledMock.mockReset().mockReturnValue(true);
        isStorageEnabledMock.mockReset().mockReturnValue(true);
        gcMock.mockReset().mockResolvedValue({ deleted_count: 2 });
        getActiveStorageGatewayAdapterMock.mockReset().mockReturnValue({
            id: 'adapter-1',
            gc: gcMock as any,
        });
        useRuntimeConfigMock.mockReset().mockReturnValue({
            storage: {
                gcRetentionSeconds: 30 * 24 * 3600,
                gcCooldownMs: 60_000,
            },
        });
    });

    it('returns 400 for schema errors', async () => {
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue({});

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 });
    });

    it('uses default retention_seconds of 30 days when omitted', async () => {
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });

        await handler(makeEvent());

        expect(gcMock).toHaveBeenCalledWith(expect.anything(), {
            workspace_id: 'ws-1',
            retention_seconds: 30 * 24 * 3600,
            limit: undefined,
        });
    });

    it('uses runtime-config retention_seconds default when omitted', async () => {
        const handler = await loadHandler();
        useRuntimeConfigMock.mockReturnValue({
            storage: {
                gcRetentionSeconds: 7200,
                gcCooldownMs: 60_000,
            },
        });
        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });

        await handler(makeEvent());

        expect(gcMock).toHaveBeenCalledWith(expect.anything(), {
            workspace_id: 'ws-1',
            retention_seconds: 7200,
            limit: undefined,
        });
    });

    it('enforces admin.access permission', async () => {
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue(makeBody());

        await handler(makeEvent());

        expect(requireCanMock).toHaveBeenCalledWith(
            expect.objectContaining({ authenticated: true }),
            'admin.access',
            { kind: 'workspace', id: 'ws-1' }
        );
    });

    it('returns 429 with wait message when same workspace is called during cooldown', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue(makeBody());

        await handler(makeEvent());
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });

        vi.useRealTimers();
    });

    it('throttles repeated runs per workspace but allows other workspaces', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-06T12:00:00.000Z'));
        const handler = await loadHandler();

        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });
        await expect(handler(makeEvent())).resolves.toEqual({ deleted_count: 2 });

        readBodyMock.mockResolvedValue({ workspace_id: 'ws-1' });
        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 429 });

        readBodyMock.mockResolvedValue({ workspace_id: 'ws-2' });
        await expect(handler(makeEvent())).resolves.toEqual({ deleted_count: 2 });

        vi.useRealTimers();
    });

    it('returns 500 when adapter is missing', async () => {
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue(makeBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue(null);

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 500 });
    });

    it('returns 501 when adapter does not support gc', async () => {
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue(makeBody());
        getActiveStorageGatewayAdapterMock.mockReturnValue({ id: 'adapter-1' });

        await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 501 });
    });

    it('passes through adapter deleted_count result', async () => {
        const handler = await loadHandler();
        readBodyMock.mockResolvedValue(makeBody());

        await expect(handler(makeEvent())).resolves.toEqual({ deleted_count: 2 });
    });
});
