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

vi.mock('../../../connect/helpers', () => ({
    noStore: vi.fn(),
    normalizeUserCode: (value: unknown) =>
        typeof value === 'string' ? value.trim().toUpperCase() : '',
}));

const checkAndRecordMock = vi.fn();
vi.mock('../../../utils/rate-limit/store', () => ({
    getRateLimitProvider: () => ({
        checkAndRecord: checkAndRecordMock,
    }),
}));

const healthMock = vi.fn();
const readinessMock = vi.fn();
const listRunnersMock = vi.fn();
const createInternClientMock = vi.fn();
vi.mock('@or3/intern-client', () => ({
    createInternClient: (...args: unknown[]) => {
        createInternClientMock(...args);
        return {
            health: healthMock,
            readiness: readinessMock,
            listRunners: listRunnersMock,
        };
    },
}));

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
        healthMock
            .mockReset()
            .mockResolvedValue({ status: 'ok', runtimeAvailable: true });
        readinessMock.mockReset().mockResolvedValue({ ready: true });
        listRunnersMock.mockReset().mockResolvedValue({
            runners: [
                {
                    id: 'runner-a',
                    status: 'available',
                    auth_status: 'ready',
                },
            ],
        });
        createInternClientMock.mockReset();
    });

    it('keeps the browser approved while the terminal has not redeemed its credential', async () => {
        getAuthorizationMock.mockResolvedValue({
            ...authorization,
            status: 'approved',
        });
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'approved' });
        expect(listEnvironmentsMock).not.toHaveBeenCalled();
        expect(createInternClientMock).not.toHaveBeenCalled();
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
        expect(createInternClientMock).not.toHaveBeenCalled();
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
        const clientOptions = createInternClientMock.mock.calls[0]?.[0] as {
            resolveAuth: () => Promise<unknown>;
        };
        await expect(clientOptions.resolveAuth()).resolves.toEqual({
            token: 'paired-device-token',
            headers: { 'X-Or3-Auth-Method': 'paired-device' },
        });
        expect(listRunnersMock).toHaveBeenCalledOnce();
    });

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
        listRunnersMock.mockRejectedValue(new Error('tunnel not online'));
        const handler = await statusHandler();

        await expect(handler(event)).resolves.toEqual({ stage: 'installing' });
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
        expect(createInternClientMock).not.toHaveBeenCalled();
    });
});
