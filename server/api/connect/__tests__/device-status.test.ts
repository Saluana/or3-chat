import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const getQueryMock = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    getQuery: (...args: unknown[]) => getQueryMock(...args),
    getRequestIP: () => '127.0.0.1',
    createError: (options: {
        statusCode: number;
        statusMessage?: string;
    }) =>
        Object.assign(new Error(options.statusMessage), {
            statusCode: options.statusCode,
        }),
}));

const requireWorkspaceSessionMock = vi.fn();
vi.mock('../../workspaces/_helpers', () => ({
    requireWorkspaceSession: (...args: unknown[]) =>
        requireWorkspaceSessionMock(...args),
}));

const getAuthorizationMock = vi.fn();
const listEnvironmentsMock = vi.fn();
vi.mock('../../../connect/store/require', () => ({
    requireConnectStore: () => ({
        getAuthorizationByUserHash: getAuthorizationMock,
        listEnvironments: listEnvironmentsMock,
    }),
}));

vi.mock('../../../connect/config', () => ({
    getConnectServerConfig: () => ({ encryptionKey: 'encryption-key' }),
}));

const decryptCredentialMock = vi.fn();
vi.mock('../../../connect/crypto', () => ({
    createConnectUserCodeLookup: (code: string) => `lookup:${code}`,
    decryptConnectCredential: (...args: unknown[]) =>
        decryptCredentialMock(...args),
}));

vi.mock('../../../connect/helpers', async () => ({
    ...(await vi.importActual<typeof import('../../../connect/helpers')>(
        '../../../connect/helpers'
    )),
    noStore: vi.fn(),
}));

const probeRunsCapabilitiesMock = vi.fn();
vi.mock('../../../connect/runs-probe', () => ({
    probeRunsCapabilities: (...args: unknown[]) => probeRunsCapabilitiesMock(...args),
}));

const checkAndRecordMock = vi.fn();
vi.mock('../../../utils/rate-limit/store', () => ({
    getRateLimitProvider: () => ({
        checkAndRecord: checkAndRecordMock,
    }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const health = {
    status: 'ok', runtimeAvailable: true, jobRegistryAvailable: true,
    approvalBrokerAvailable: true, processId: 1, startedAt: '2026-09-26T00:00:00Z',
};
const readiness = { status: 'ready', ready: true };
const runners = { runners: [{
    id: 'runner-a', display_name: 'Runner A', status: 'available',
    auth_status: 'ready', supports: {},
}] };

const event = { context: {} } as H3Event;
const environmentId = 'env-abcdefgh';
const authorization = {
    _id: 'authorization-a',
    status: 'delivering',
    host: {
        name: 'Grandma computer',
        platform: 'darwin',
        architecture: 'arm64',
        intern_version: '1.0.0',
    },
    approved_user_id: 'user-one',
    approved_workspace_id: 'workspace-a',
    environment_id: environmentId,
    credential_ciphertext: 'authorization-ciphertext',
    expires_at: Date.now() + 60_000,
};
const environment = {
    id: environmentId,
    name: 'Grandma computer',
    hostname: 'grandma.connect.example.test',
    tunnel_id: 'tunnel-a',
    dns_record_id: 'dns-a',
    access_credential_ciphertext: 'access-ciphertext',
    status: 'active',
};

async function statusHandler() {
    return (await import('../device/status.get')).default as (
        event: H3Event
    ) => Promise<unknown>;
}

describe('Connect device online status', () => {
    beforeEach(() => {
        vi.resetModules();
        getQueryMock.mockReset().mockReturnValue({
            code: 'bright-moon-tree-042',
            environmentId,
        });
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-one' },
            workspace: { id: 'workspace-a' },
        });
        getAuthorizationMock.mockReset().mockResolvedValue(authorization);
        listEnvironmentsMock.mockReset().mockResolvedValue([environment]);
        decryptCredentialMock.mockReset().mockImplementation((ciphertext) => {
            if (ciphertext === 'authorization-ciphertext') {
                return {
                    accountId: 'user-one',
                    workspaceId: 'workspace-a',
                    environmentId,
                };
            }
            return { controlToken: 'paired-device-token' };
        });
        checkAndRecordMock.mockReset().mockResolvedValue({ allowed: true });
        fetchMock.mockReset().mockImplementation(async (input: string | URL) => {
            const path = new URL(String(input)).pathname;
            if (path === '/internal/v1/health') return Response.json(health);
            if (path === '/internal/v1/readiness') return Response.json(readiness);
            if (path === '/internal/v1/chat-runners') return Response.json(runners);
            throw new Error(`Unexpected probe path: ${path}`);
        });
        probeRunsCapabilitiesMock
            .mockReset()
            .mockResolvedValue({ sessions: true, events: true });
    });

    it('keeps the browser approved while the terminal has not redeemed its credential', async () => {
        getAuthorizationMock.mockResolvedValue({
            ...authorization,
            status: 'approved',
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'approved' });
        expect(listEnvironmentsMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps durable relay provisioning in the honest approved stage', async () => {
        getAuthorizationMock.mockResolvedValue({
            ...authorization,
            status: 'provisioning',
            credential_ciphertext: undefined,
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'approved' });
        expect(listEnvironmentsMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports online only after an authenticated protected runner probe succeeds', async () => {
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({
            stage: 'online',
            readiness: true,
        });
        expect(listEnvironmentsMock).toHaveBeenCalledWith({
            userId: 'user-one',
            workspaceId: 'workspace-a',
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const [input, init] of fetchMock.mock.calls) {
            const url = new URL(String(input));
            const headers = new Headers(init.headers);
            expect(url.hostname).toBe('grandma.connect.example.test');
            expect(url.searchParams.has('_or3_setup_probe')).toBe(true);
            expect(headers.get('Authorization')).toBe('Bearer paired-device-token');
            expect(headers.get('X-Or3-Auth-Method')).toBe('paired-device');
            expect(init.cache).toBe('no-store');
            expect(init.redirect).toBe('error');
            expect(init.signal).toBeInstanceOf(AbortSignal);
        }
    });

    it('accepts an unavailable readiness response while requiring healthy authenticated runners', async () => {
        fetchMock.mockImplementation(async (input: string | URL) => {
            const path = new URL(String(input)).pathname;
            if (path === '/internal/v1/health') return Response.json(health);
            if (path === '/internal/v1/readiness') return Response.json({ status: 'not-ready', ready: false }, { status: 503 });
            if (path === '/internal/v1/chat-runners') return Response.json(runners);
            throw new Error(`Unexpected probe path: ${path}`);
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'online', readiness: false });
    });

    it('rejects malformed runner status rather than reporting a computer online', async () => {
        fetchMock.mockImplementation(async (input: string | URL) => {
            const path = new URL(String(input)).pathname;
            if (path === '/internal/v1/health') return Response.json(health);
            if (path === '/internal/v1/readiness') return Response.json(readiness);
            if (path === '/internal/v1/chat-runners') return Response.json({ runners: [{ ...runners.runners[0], status: 3 }] });
            throw new Error(`Unexpected probe path: ${path}`);
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'installing' });
    });

    it('bounds a stalled authenticated runner probe', async () => {
        fetchMock.mockImplementation(async (input: string | URL, init: RequestInit) => {
            const path = new URL(String(input)).pathname;
            if (path === '/internal/v1/health') return Response.json(health);
            if (path === '/internal/v1/readiness') return Response.json(readiness);
            return await new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
            });
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'installing' });
    }, 10_000);

    it('keeps probing after the bounded delivery ciphertext is erased', async () => {
        getAuthorizationMock.mockResolvedValue({
            ...authorization,
            status: 'consumed',
            credential_ciphertext: undefined,
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({
            stage: 'online',
            readiness: true,
        });
        expect(decryptCredentialMock).toHaveBeenCalledWith(
            'access-ciphertext',
            'encryption-key',
            {
                purpose: 'environment-access',
                environmentId,
                userId: 'user-one',
                workspaceId: 'workspace-a',
            }
        );
    });

    it('stays installing while credential redemption precedes service startup', async () => {
        fetchMock.mockImplementation(async (input: string | URL) => {
            if (new URL(String(input)).pathname === '/internal/v1/chat-runners') throw new Error('tunnel not online');
            return Response.json(health);
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'installing' });
    });

    it('uses the Runs capability probe for an OpenClaw environment', async () => {
        listEnvironmentsMock.mockResolvedValue([
            {
                ...environment,
                runtime: 'openclaw',
                driver: 'runs',
                base_path: '/or3/',
            },
        ]);
        decryptCredentialMock.mockImplementation((ciphertext) =>
            ciphertext === 'authorization-ciphertext'
                ? {
                      accountId: 'user-one',
                      workspaceId: 'workspace-a',
                      environmentId,
                  }
                : {
                      controlToken: 'paired-device-token',
                      runtime: 'openclaw',
                      driver: 'runs',
                      basePath: '/or3/',
                  }
        );
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'online', readiness: true });
        expect(probeRunsCapabilitiesMock).toHaveBeenCalledWith(
            'https://grandma.connect.example.test/or3/',
            'paired-device-token'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a re-enroll reason when a Runs credential binding disagrees with its environment', async () => {
        listEnvironmentsMock.mockResolvedValue([
            {
                ...environment,
                runtime: 'openclaw',
                driver: 'runs',
                base_path: '/or3/',
            },
        ]);
        decryptCredentialMock.mockImplementation((ciphertext) =>
            ciphertext === 'authorization-ciphertext'
                ? {
                      accountId: 'user-one',
                      workspaceId: 'workspace-a',
                      environmentId,
                  }
                : {
                      controlToken: 'paired-device-token',
                      runtime: 'hermes',
                      driver: 'runs',
                      basePath: '/',
                  }
        );
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({
            stage: 'error',
            reason: 'runtime_binding_mismatch',
        });
        expect(warning).toHaveBeenCalledWith(
            '[connect] device-status environment env-abcdefgh: runtime_binding_mismatch'
        );
        expect(probeRunsCapabilitiesMock).not.toHaveBeenCalled();
        warning.mockRestore();
    });

    it('cannot probe an approved computer through another workspace session', async () => {
        requireWorkspaceSessionMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-one' },
            workspace: { id: 'workspace-b' },
        });
        const handler = await statusHandler();

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(listEnvironmentsMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
