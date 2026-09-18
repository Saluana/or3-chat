import { describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { LibraryLinkStatusView } from '../../../../admin/library/link-service';

vi.mock('h3', async (importOriginal) => ({
    // Real h3 readers are kept so proxy/host resolution behaves as in production;
    // only the request-scoped writers and the error factory are observable.
    ...(await importOriginal<typeof import('h3')>()),
    defineEventHandler: (handler: unknown) => handler,
    createError: (input: Record<string, unknown>) =>
        Object.assign(new Error(String(input.statusMessage ?? 'error')), input),
    setResponseHeader: vi.fn(),
    setResponseStatus: vi.fn(),
}));

const resolveSessionContextMock = vi.fn();
vi.mock('../../../../auth/session', () => ({
    resolveSessionContext: resolveSessionContextMock as never,
}));

const statusMock = vi.fn();
const startMock = vi.fn();
const disconnectMock = vi.fn();
vi.mock('../../../../admin/library/route-support', () => ({
    libraryLinkServiceFor: async () => ({
        configured: true,
        config: {
            registryOrigin: 'https://marketplace.example.test',
            secret: 'secret',
            instanceId: 'inst-1',
            requestTimeoutMs: 10_000,
        },
        service: {
            status: statusMock as never,
            start: startMock as never,
            disconnect: disconnectMock as never,
        },
    }),
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => ({
        security: { proxy: { trustProxy: false } },
        admin: { libraryLinkSecret: 'secret' },
    }),
}));

const { default: statusRoute } = await import('../link.get');
const { default: startRoute } = await import('../link.post');
const { default: disconnectRoute } = await import('../link/disconnect.post');

const SESSION = {
    authenticated: true,
    provider: 'basic-auth',
    user: { id: 'user-1', email: 'user@example.test' },
    workspace: { id: 'ws-1', name: 'Workspace' },
    role: 'owner' as const,
};

function event(): H3Event {
    return {
        context: {},
        // A TLS-terminating proxy is the documented deployment; the socket
        // flag keeps host/protocol resolution on the real code path.
        node: { req: { headers: { host: 'or3.example.test' }, socket: { encrypted: true } } },
        headers: {},
    } as unknown as H3Event;
}

const UNLINKED: LibraryLinkStatusView = { configured: true, state: 'unlinked' };

describe('library link routes', () => {
    it('requires an authenticated local user', async () => {
        resolveSessionContextMock.mockResolvedValue(null);
        await expect(statusRoute(event() as never)).rejects.toMatchObject({ statusCode: 401 });
        await expect(startRoute(event() as never)).rejects.toMatchObject({ statusCode: 401 });
        await expect(disconnectRoute(event() as never)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('returns the caller’s own link state without credential fields', async () => {
        resolveSessionContextMock.mockResolvedValue(SESSION);
        statusMock.mockResolvedValue(UNLINKED);
        const result = (await statusRoute(event() as never)) as LibraryLinkStatusView & {
            token?: unknown;
            secret?: unknown;
        };
        expect(statusMock).toHaveBeenCalledWith('user-1');
        expect(result.state).toBe('unlinked');
        expect(result).not.toHaveProperty('token');
        expect(result).not.toHaveProperty('secret');
    });

    it('starts a pairing with this server’s own public host as label and origin', async () => {
        resolveSessionContextMock.mockResolvedValue(SESSION);
        startMock.mockResolvedValue({
            ok: true,
            value: {
                configured: true,
                state: 'pending',
                pairing: {
                    code: 'ABCD-EFGH',
                    verificationUrl: 'https://marketplace.example.test/link?code=ABCD-EFGH',
                    expiresAt: '2026-09-17T12:10:00.000Z',
                    retryAfterMs: 5_000,
                },
            },
        });

        const result = (await startRoute(event() as never)) as LibraryLinkStatusView;
        expect(startMock).toHaveBeenCalledWith('user-1', {
            label: 'or3.example.test',
            origin: 'https://or3.example.test',
        });
        expect(result.pairing?.code).toBe('ABCD-EFGH');
    });

    it('reports a retryable marketplace failure without pretending to be paired', async () => {
        resolveSessionContextMock.mockResolvedValue(SESSION);
        startMock.mockResolvedValue({
            ok: false,
            failure: { code: 'central-unreachable', message: 'down', retryable: true },
        });
        const result = (await startRoute(event() as never)) as {
            error: { code: string; retryable: boolean };
        };
        expect(result.error).toEqual({
            code: 'central-unreachable',
            message: 'down',
            retryable: true,
        });
    });

    it('disconnects the caller’s own link only', async () => {
        resolveSessionContextMock.mockResolvedValue(SESSION);
        disconnectMock.mockResolvedValue({
            ok: true,
            value: { configured: true, state: 'revoked', centralRevokePending: true },
        });
        const result = (await disconnectRoute(event() as never)) as LibraryLinkStatusView;
        expect(disconnectMock).toHaveBeenCalledWith('user-1');
        expect(result.state).toBe('revoked');
        expect(result.centralRevokePending).toBe(true);
    });
});
