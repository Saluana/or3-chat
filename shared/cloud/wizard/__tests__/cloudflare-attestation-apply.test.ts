import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Or3CloudWizardApi } from '../api';
import { validateCloudflareValidationAttestation } from '../cloudflare-attestation';

let sandbox = '';
let previousWizardHome: string | undefined;

function successfulCloudflareFetch() {
    return vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            if (url.endsWith('/user/tokens/verify')) {
                return Response.json({
                    success: true,
                    result: { status: 'active' },
                });
            }
            if (url.includes('/zones?name=')) {
                return Response.json({
                    success: true,
                    result: url.includes('name=connect.example.com')
                        ? [
                              {
                                  id: 'zone-a',
                                  name: 'connect.example.com',
                                  account: { id: 'account-a' },
                              },
                          ]
                        : [],
                });
            }
            if (
                url.includes('/cfd_tunnel?') &&
                method === 'GET'
            ) {
                return Response.json({ success: true, result: [] });
            }
            if (url.endsWith('/cfd_tunnel') && method === 'POST') {
                return Response.json({
                    success: true,
                    result: { id: 'tunnel-a', account_tag: 'account-a' },
                });
            }
            if (url.endsWith('/dns_records') && method === 'POST') {
                return Response.json({
                    success: true,
                    result: { id: 'dns-a' },
                });
            }
            if (
                url.includes('/dns_records?') &&
                method === 'GET'
            ) {
                return Response.json({ success: true, result: [] });
            }
            return Response.json({ success: true, result: {} });
        }
    );
}

async function createConnectSession(api: Or3CloudWizardApi) {
    const session = await api.createSession({
        instanceDir: sandbox,
        includeSecrets: true,
        prefillFromEnv: false,
    });
    await api.submitAnswers(session.id, {
        basicAuthJwtSecret: 'jwt-secret-jwt-secret-jwt-secret-1234',
        basicAuthBootstrapEmail: 'admin@example.com',
        basicAuthBootstrapPassword: 'SuperSecurePassword123',
        fsTokenSecret: 'fs-token-secret-fs-token-secret-fs-token',
        fsRoot: resolve(sandbox, 'storage'),
        adminUsername: 'admin',
        adminPassword: 'AdminPassword123',
        connectEnabled: true,
        connectPublicUrl: 'https://chat.example.com',
        connectEncryptionKey: 'connect-key-connect-key-connect-key-1234',
        connectCloudflareApiToken: 'cloudflare-secret-token',
        connectHostnameSuffix: 'connect.example.com',
    });
    return session.id;
}

describe('wizard Cloudflare attestation apply flow', () => {
    beforeEach(async () => {
        sandbox = await mkdtemp(resolve(tmpdir(), 'or3-cf-attestation-'));
        previousWizardHome = process.env.OR3_CLOUD_WIZARD_HOME;
        process.env.OR3_CLOUD_WIZARD_HOME = resolve(sandbox, 'wizard-home');
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        if (previousWizardHome === undefined) {
            delete process.env.OR3_CLOUD_WIZARD_HOME;
        } else {
            process.env.OR3_CLOUD_WIZARD_HOME = previousWizardHome;
        }
        await rm(sandbox, { recursive: true, force: true });
    });

    it('automatically runs one canary and writes a configuration-bound attestation', async () => {
        const fetchMock = successfulCloudflareFetch();
        vi.stubGlobal('fetch', fetchMock);
        const api = new Or3CloudWizardApi();
        const sessionId = await createConnectSession(api);

        const result = await api.apply(sessionId, { dryRun: false });
        const attestation =
            result.envUpdates
                .OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION;

        expect(typeof attestation).toBe('string');
        expect(
            validateCloudflareValidationAttestation({
                attestation: attestation ?? undefined,
                config: {
                    apiToken: 'cloudflare-secret-token',
                    hostnameSuffix: 'connect.example.com',
                },
            })
        ).toMatchObject({ valid: true });
        expect(
            fetchMock.mock.calls.filter(
                ([input, init]) =>
                    String(input).endsWith('/cfd_tunnel') &&
                    (init as RequestInit | undefined)?.method === 'POST'
            )
        ).toHaveLength(1);
    });

    it('reuses a successful manual check and keeps dry-runs non-mutating', async () => {
        const fetchMock = successfulCloudflareFetch();
        vi.stubGlobal('fetch', fetchMock);
        const api = new Or3CloudWizardApi();
        const sessionId = await createConnectSession(api);
        const credentials = {
            apiToken: 'cloudflare-secret-token',
            hostnameSuffix: 'connect.example.com',
        };

        await expect(
            api.testProviderConnection('cloudflare-connect', credentials)
        ).resolves.toMatchObject({ success: true });
        await api.apply(sessionId, { dryRun: false });
        expect(
            fetchMock.mock.calls.filter(
                ([input, init]) =>
                    String(input).endsWith('/cfd_tunnel') &&
                    (init as RequestInit | undefined)?.method === 'POST'
            )
        ).toHaveLength(1);

        const secondApi = new Or3CloudWizardApi();
        const secondSessionId = await createConnectSession(secondApi);
        fetchMock.mockClear();
        const dryRun = await secondApi.apply(secondSessionId, {
            dryRun: true,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(
            dryRun.envUpdates
                .OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION
        ).toBeNull();
    });
});
