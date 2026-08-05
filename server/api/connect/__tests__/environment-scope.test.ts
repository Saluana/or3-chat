import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const readBodyMock = vi.fn();
const getHeaderMock = vi.fn();
vi.mock('h3', () => ({
    defineEventHandler: (handler: unknown) => handler,
    readBody: (...args: unknown[]) => readBodyMock(...args),
    getHeader: (...args: unknown[]) => getHeaderMock(...args),
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

const listEnvironmentsMock = vi.fn();
const rotateEnvironmentCredentialMock = vi.fn();
const getEnvironmentMock = vi.fn();
const beginEnvironmentRevocationMock = vi.fn();
const saveEnvironmentRelayProgressMock = vi.fn();
const completeEnvironmentRevocationMock = vi.fn();
const recordEnvironmentLifecycleFailureMock = vi.fn();
vi.mock('../../../connect/store/require', () => ({
    requireConnectStore: () => ({
        listEnvironments: listEnvironmentsMock,
        rotateEnvironmentCredential: rotateEnvironmentCredentialMock,
        getEnvironmentByControlTokenHash: getEnvironmentMock,
        beginEnvironmentRevocation: beginEnvironmentRevocationMock,
        saveEnvironmentRelayProgress:
            saveEnvironmentRelayProgressMock,
        completeEnvironmentRevocation:
            completeEnvironmentRevocationMock,
        recordEnvironmentLifecycleFailure:
            recordEnvironmentLifecycleFailureMock,
    }),
}));

const revokeRelayMock = vi.fn();
vi.mock('../../../connect/relay/require', () => ({
    requireConnectRelay: () => ({ revoke: revokeRelayMock }),
}));

vi.mock('../../../connect/config', () => ({
    getConnectServerConfig: () => ({ encryptionKey: 'encryption-key' }),
}));

const decryptCredentialMock = vi.fn();
const legacyCredentialMock = vi.fn();
vi.mock('../../../connect/crypto', () => ({
    decryptConnectCredential: (...args: unknown[]) => decryptCredentialMock(...args),
    encryptConnectCredential: () => 'v2.rotated',
    isLegacyConnectCredentialEnvelope: (...args: unknown[]) => legacyCredentialMock(...args),
    createConnectRelayMetadataAuthenticator: () =>
        'relay-authenticator',
    safeSecretEqual: (left: string, right: string) => left === right,
    hashConnectSecret: (value: string) => `hash:${value}`,
    randomURLSecret: () => 'lifecycle-claim-token',
}));

vi.mock('../../../connect/helpers', async () => ({
    ...(await vi.importActual<typeof import('../../../connect/helpers')>(
        '../../../connect/helpers'
    )),
    noStore: vi.fn(),
}));

const requireSameOriginMutationMock = vi.fn();
vi.mock('../../../utils/security/mutation-guard', () => ({
    requireSameOriginMutation: (...args: unknown[]) =>
        requireSameOriginMutationMock(...args),
}));

const event = { context: {} } as H3Event;
const controlToken = 'control-token-that-is-long-enough-1234567890';
const environment = {
    id: 'environment-a',
    user_id: 'user-one',
    workspace_id: 'workspace-a',
    name: 'Computer A',
    hostname: 'a.connect.example.test',
    tunnel_id: 'tunnel-a',
    dns_record_id: 'dns-a',
    access_credential_ciphertext: 'ciphertext-a',
    status: 'active',
    runtime: 'openclaw',
    driver: 'runs',
    base_path: '/or3/',
};

async function listHandler() {
    return (await import('../environments/index.get')).default as (
        event: H3Event
    ) => Promise<unknown>;
}

async function revokeHandler() {
    return (await import('../environments/revoke.post')).default as (
        event: H3Event
    ) => Promise<unknown>;
}

async function removeHandler() {
    return (await import('../environments/remove.post')).default as (
        event: H3Event
    ) => Promise<unknown>;
}

describe('Connect environment workspace scope', () => {
    beforeEach(() => {
        vi.resetModules();
        requireWorkspaceSessionMock.mockReset().mockResolvedValue({
            authenticated: true,
            user: { id: 'user-one' },
            workspace: { id: 'workspace-a' },
        });
        listEnvironmentsMock.mockReset().mockResolvedValue([environment]);
        rotateEnvironmentCredentialMock.mockReset().mockResolvedValue(true);
        decryptCredentialMock.mockReset().mockImplementation(() => ({
            controlToken: 'decrypted-token',
            runtime: 'openclaw',
            driver: 'runs',
            basePath: '/or3/',
        }));
        legacyCredentialMock.mockReset().mockReturnValue(false);
        getEnvironmentMock.mockReset().mockResolvedValue(environment);
        beginEnvironmentRevocationMock
            .mockReset()
            .mockImplementation(async () => ({
                claimed: true,
                environment: {
                    ...environment,
                    status: 'revoking',
                    lifecycle_attempts: 0,
                },
            }));
        saveEnvironmentRelayProgressMock
            .mockReset()
            .mockResolvedValue(true);
        completeEnvironmentRevocationMock
            .mockReset()
            .mockResolvedValue(true);
        recordEnvironmentLifecycleFailureMock
            .mockReset()
            .mockResolvedValue(true);
        revokeRelayMock
            .mockReset()
            .mockImplementation(async (_input, onProgress) => {
                await onProgress?.({ dnsDeleted: true });
                await onProgress?.({ tunnelDeleted: true });
            });
        requireSameOriginMutationMock.mockReset();
        readBodyMock.mockReset().mockResolvedValue({
            accountId: 'user-one',
            workspaceId: 'workspace-a',
        });
        getHeaderMock.mockReset().mockReturnValue(`Bearer ${controlToken}`);
    });

    it('lists only the authenticated active workspace and labels the response', async () => {
        const handler = await listHandler();

        const response = (await handler(event)) as {
            workspaceId: string;
            environments: Array<Record<string, unknown>>;
        };
        expect(response).toMatchObject({
            workspaceId: 'workspace-a',
            environments: [
                {
                    id: 'environment-a',
                    accessToken: 'decrypted-token',
                },
            ],
        });
        expect(response.environments[0]).not.toHaveProperty('status');
        expect(listEnvironmentsMock).toHaveBeenCalledWith({
            userId: 'user-one',
            workspaceId: 'workspace-a',
        });
    });

    it('refuses to list without both a user and active workspace', async () => {
        requireWorkspaceSessionMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-one' },
            workspace: undefined,
        });
        const handler = await listHandler();

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 });
        expect(listEnvironmentsMock).not.toHaveBeenCalled();
    });

    it('uses real Runs metadata, excludes inactive and malformed records, and keeps valid runtimes', async () => {
        const hermes = {
            ...environment,
            id: 'environment-hermes',
            hostname: 'hermes.connect.example.test',
            access_credential_ciphertext: 'ciphertext-hermes',
            runtime: 'hermes',
            driver: 'runs',
            base_path: '/',
        };
        const inactive = { ...environment, id: 'environment-inactive', status: 'revoked' };
        const malformed = { ...environment, id: 'environment-malformed', driver: 'intern' };
        listEnvironmentsMock.mockResolvedValue([environment, hermes, inactive, malformed]);
        decryptCredentialMock.mockImplementation((ciphertext) =>
            ciphertext === 'ciphertext-hermes'
                ? {
                      controlToken: 'hermes-token',
                      runtime: 'hermes',
                      driver: 'runs',
                      basePath: '/',
                  }
                : {
                      controlToken: 'decrypted-token',
                      runtime: 'openclaw',
                      driver: 'runs',
                      basePath: '/or3/',
                  }
        );
        const handler = await listHandler();

        await expect(handler(event)).resolves.toMatchObject({
            environments: [
                { id: 'environment-a', runtime: 'openclaw', baseUrl: 'https://a.connect.example.test/or3/' },
                { id: 'environment-hermes', runtime: 'hermes', baseUrl: 'https://hermes.connect.example.test/' },
            ],
        });
    });

    it('propagates credential-rotation store failures after a record validates', async () => {
        legacyCredentialMock.mockReturnValue(true);
        rotateEnvironmentCredentialMock.mockRejectedValue(new Error('database unavailable'));
        const handler = await listHandler();

        await expect(handler(event)).rejects.toThrow('database unavailable');
    });

    it('logs a fixed credential-safe reason when an environment cannot decrypt', async () => {
        decryptCredentialMock.mockImplementation(() => {
            throw new Error('decrypted-token must never appear in logs');
        });
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handler = await listHandler();

        await expect(handler(event)).resolves.toMatchObject({ environments: [] });
        expect(warning).toHaveBeenCalledWith(
            '[connect] skipping environment environment-a: credential_decryption_failed'
        );
        expect(warning).not.toHaveBeenCalledWith(
            expect.stringContaining('decrypted-token')
        );
        warning.mockRestore();
    });

    it('binds token lookup and revocation to the credential scope', async () => {
        const handler = await revokeHandler();

        await expect(handler(event)).resolves.toEqual({ revoked: true });
        const scope = {
            userId: 'user-one',
            workspaceId: 'workspace-a',
        };
        expect(getEnvironmentMock).toHaveBeenCalledWith(
            `hash:${controlToken}`,
            scope
        );
        expect(beginEnvironmentRevocationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                environmentId: 'environment-a',
                scope,
            })
        );
        expect(revokeRelayMock).toHaveBeenCalledWith(
            {
                tunnelId: 'tunnel-a',
                dnsRecordId: 'dns-a',
            },
            expect.any(Function)
        );
        expect(completeEnvironmentRevocationMock).toHaveBeenCalledWith(
            'environment-a',
            'lifecycle-claim-token',
            expect.any(Number)
        );
    });

    it('cannot resolve or revoke a token under a different workspace', async () => {
        readBodyMock.mockResolvedValue({
            accountId: 'user-one',
            workspaceId: 'workspace-b',
        });
        getEnvironmentMock.mockResolvedValue(null);
        const handler = await revokeHandler();

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(getEnvironmentMock).toHaveBeenCalledWith(
            `hash:${controlToken}`,
            {
                userId: 'user-one',
                workspaceId: 'workspace-b',
            }
        );
        expect(revokeRelayMock).not.toHaveBeenCalled();
        expect(beginEnvironmentRevocationMock).not.toHaveBeenCalled();
    });

    it('removes a cloud computer through a confirmed signed-in workspace action', async () => {
        readBodyMock.mockResolvedValue({ environmentId: 'environment-a' });
        const handler = await removeHandler();

        await expect(handler(event)).resolves.toEqual({ revoked: true });
        expect(requireSameOriginMutationMock).toHaveBeenCalledWith(event, {
            intentHeader: 'x-or3-connect-intent',
            intentValue: 'remove',
            requireJson: true,
        });
        const scope = {
            userId: 'user-one',
            workspaceId: 'workspace-a',
        };
        expect(beginEnvironmentRevocationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                environmentId: 'environment-a',
                scope,
            })
        );
        expect(revokeRelayMock).toHaveBeenCalledWith(
            {
                tunnelId: 'tunnel-a',
                dnsRecordId: 'dns-a',
            },
            expect.any(Function)
        );
        expect(completeEnvironmentRevocationMock).toHaveBeenCalled();
    });

    it('cannot remove another workspace computer through the browser', async () => {
        requireWorkspaceSessionMock.mockResolvedValue({
            authenticated: true,
            user: { id: 'user-one' },
            workspace: { id: 'workspace-b' },
        });
        readBodyMock.mockResolvedValue({ environmentId: 'environment-a' });
        beginEnvironmentRevocationMock.mockResolvedValue(null);
        const handler = await removeHandler();

        await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 });
        expect(beginEnvironmentRevocationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                environmentId: 'environment-a',
                scope: {
                    userId: 'user-one',
                    workspaceId: 'workspace-b',
                },
            })
        );
        expect(revokeRelayMock).not.toHaveBeenCalled();
        expect(completeEnvironmentRevocationMock).not.toHaveBeenCalled();
    });

    it('keeps durable revoking work when relay cleanup is not confirmed', async () => {
        readBodyMock.mockResolvedValue({ environmentId: 'environment-a' });
        revokeRelayMock.mockRejectedValue(new Error('relay unavailable'));
        const handler = await removeHandler();

        await expect(handler(event)).rejects.toMatchObject({
            statusCode: 503,
        });
        expect(beginEnvironmentRevocationMock).toHaveBeenCalled();
        expect(recordEnvironmentLifecycleFailureMock).toHaveBeenCalledWith(
            'environment-a',
            'revoking',
            'lifecycle-claim-token',
            'relay unavailable',
            expect.any(Number),
            expect.any(Number)
        );
        expect(completeEnvironmentRevocationMock).not.toHaveBeenCalled();
    });
});
