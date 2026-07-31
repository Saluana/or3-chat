import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAnswers } from '../../shared/cloud/wizard/catalog';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';

describe('or3 cloud wizard phase 1 enhancements', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('prefills defaults from existing env map', () => {
        const answers = createDefaultAnswers({
            instanceDir: '/tmp/or3',
            existingEnv: {
                AUTH_PROVIDER: 'clerk',
                OR3_SYNC_PROVIDER: 'convex',
                NUXT_PUBLIC_STORAGE_PROVIDER: 'convex',
                NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_test',
                NUXT_CLERK_SECRET_KEY: 'sk_live_test',
                VITE_CONVEX_URL: 'https://demo.convex.cloud',
            },
        });

        expect(answers.authProvider).toBe('clerk');
        expect(answers.syncProvider).toBe('convex');
        expect(answers.storageProvider).toBe('convex');
        expect(answers.clerkPublishableKey).toBe('pk_live_test');
        expect(answers.clerkSecretKey).toBe('sk_live_test');
        expect(answers.convexUrl).toBe('https://demo.convex.cloud');
        expect(answers.wizardMode).toBe('preset-clerk-convex');
    });

    it('createSession supports env prefill opt-in and opt-out', async () => {
        const wizardHome = await mkdtemp(resolve(tmpdir(), 'or3-wizard-home-'));
        const previousWizardHome = process.env.OR3_CLOUD_WIZARD_HOME;
        process.env.OR3_CLOUD_WIZARD_HOME = wizardHome;

        try {
            const api = new Or3CloudWizardApi();

            const prefills = await api.createSession({
                instanceDir: '/tmp/or3',
                existingEnvMap: {
                    AUTH_PROVIDER: 'clerk',
                    OR3_SYNC_PROVIDER: 'convex',
                    NUXT_PUBLIC_STORAGE_PROVIDER: 'convex',
                },
                prefillFromEnv: true,
            });
            expect(prefills.answers.authProvider).toBe('clerk');
            expect(prefills.answers.syncProvider).toBe('convex');

            const fresh = await api.createSession({
                instanceDir: '/tmp/or3',
                existingEnvMap: {
                    AUTH_PROVIDER: 'clerk',
                },
                prefillFromEnv: false,
            });
            expect(fresh.answers.authProvider).toBe('basic-auth');
        } finally {
            if (previousWizardHome === undefined) {
                delete process.env.OR3_CLOUD_WIZARD_HOME;
            } else {
                process.env.OR3_CLOUD_WIZARD_HOME = previousWizardHome;
            }
            await rm(wizardHome, { recursive: true, force: true });
        }
    });

    it('generates cryptographically secure secrets at requested length', () => {
        const api = new Or3CloudWizardApi();
        const first = api.generateSecureSecret(48);
        const second = api.generateSecureSecret(48);

        expect(first).toHaveLength(48);
        expect(second).toHaveLength(48);
        expect(first).not.toBe(second);
    });

    it('prepares hidden self-hosted secrets and reuses login credentials for admin', async () => {
        const wizardHome = await mkdtemp(
            resolve(tmpdir(), 'or3-wizard-self-hosted-')
        );
        const previousWizardHome = process.env.OR3_CLOUD_WIZARD_HOME;
        process.env.OR3_CLOUD_WIZARD_HOME = wizardHome;
        try {
            const api = new Or3CloudWizardApi();
            const session = await api.createSession({
                presetName: 'recommended',
                instanceDir: '/tmp/or3',
                deploymentTarget: 'docker',
                includeSecrets: false,
                prefillFromEnv: false,
            });
            expect(session.answers.basicAuthJwtSecret).toBeUndefined();

            const withSecrets = await api.getSession(session.id, {
                includeSecrets: true,
            });
            expect(withSecrets.answers.basicAuthJwtSecret).toHaveLength(48);
            expect(withSecrets.answers.fsTokenSecret).toHaveLength(48);

            await api.submitAnswers(session.id, {
                basicAuthBootstrapEmail: 'owner@example.com',
                basicAuthBootstrapPassword: 'GeneratedPassword123',
            });
            const updated = await api.getSession(session.id, {
                includeSecrets: true,
            });
            expect(updated.answers.adminUsername).toBe('owner@example.com');
            expect(updated.answers.adminPassword).toBe(
                'GeneratedPassword123'
            );
        } finally {
            if (previousWizardHome === undefined) {
                delete process.env.OR3_CLOUD_WIZARD_HOME;
            } else {
                process.env.OR3_CLOUD_WIZARD_HOME = previousWizardHome;
            }
            await rm(wizardHome, { recursive: true, force: true });
        }
    });

    it('regenerates required self-hosted secrets after a process restart', async () => {
        const wizardHome = await mkdtemp(
            resolve(tmpdir(), 'or3-wizard-resume-secrets-')
        );
        const previousWizardHome = process.env.OR3_CLOUD_WIZARD_HOME;
        process.env.OR3_CLOUD_WIZARD_HOME = wizardHome;
        try {
            const api = new Or3CloudWizardApi();
            const session = await api.createSession({
                presetName: 'recommended',
                instanceDir: '/tmp/or3',
                deploymentTarget: 'docker',
                includeSecrets: false,
                prefillFromEnv: false,
            });
            await api.submitAnswers(session.id, {
                basicAuthBootstrapEmail: 'owner@example.com',
            });

            const secretStore = (
                globalThis as typeof globalThis & {
                    [key: symbol]: Map<string, unknown>;
                }
            )[Symbol.for('or3.cloud.wizard.transientSessionSecrets')];
            secretStore.delete(session.id);

            const resumed = await api.resumeSession(session.id, {
                existingEnvMap: {},
            });
            expect(resumed.answers.basicAuthJwtSecret).toHaveLength(48);
            expect(resumed.answers.basicAuthRefreshSecret).toHaveLength(48);
            expect(resumed.answers.fsTokenSecret).toHaveLength(48);
            expect(resumed.answers.basicAuthBootstrapPassword).toHaveLength(24);
            expect(resumed.answers.adminPassword).toBe(
                resumed.answers.basicAuthBootstrapPassword
            );
            expect(resumed.answers.adminUsername).toBe('owner@example.com');
        } finally {
            if (previousWizardHome === undefined) {
                delete process.env.OR3_CLOUD_WIZARD_HOME;
            } else {
                process.env.OR3_CLOUD_WIZARD_HOME = previousWizardHome;
            }
            await rm(wizardHome, { recursive: true, force: true });
        }
    });

    it('validates and optionally creates missing directories', async () => {
        const api = new Or3CloudWizardApi();
        const sandbox = await mkdtemp(resolve(tmpdir(), 'or3-wizard-path-'));
        const missingDbPath = resolve(sandbox, 'nested', 'or3-sync.sqlite');

        const existsBefore = await api.validatePath(missingDbPath, false);
        expect(existsBefore).toBe(false);

        const created = await api.validatePath(missingDbPath, true);
        expect(created).toBe(true);

        const existsAfter = await api.validatePath(missingDbPath, false);
        expect(existsAfter).toBe(true);
    });

    it('runs provider connection tests', async () => {
        const api = new Or3CloudWizardApi();

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 200 }))
        );

        const clerk = await api.testProviderConnection('clerk', {
            clerkSecretKey: 'sk_test_123',
        });
        expect(clerk.success).toBe(true);

        const convex = await api.testProviderConnection('convex', {
            convexUrl: 'https://demo.convex.cloud',
            convexSelfHostedAdminKey: 'prod:deployment-key',
        });
        expect(convex.success).toBe(true);

        const s3Failure = await api.testProviderConnection('s3', {
            s3Bucket: '',
            s3AccessKeyId: '',
            s3SecretAccessKey: '',
        });
        expect(s3Failure.success).toBe(false);
    });

    it('proves Cloudflare tunnel and DNS edit permissions with a cleaned-up canary', async () => {
        const requests: Array<{ url: string; method: string }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                const url = String(input);
                const method = init?.method ?? 'GET';
                requests.push({ url, method });
                if (url.endsWith('/user/tokens/verify')) {
                    return Response.json({ success: true, result: { status: 'active' } });
                }
                if (url.includes('/zones?name=')) {
                    return Response.json({
                        success: true,
                        result: url.includes('name=connect.example.com')
                            ? [
                                  {
                                      id: 'zone-1',
                                      name: 'connect.example.com',
                                      account: { id: 'account-1' },
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
                        result: { id: 'tunnel-1', account_tag: 'account-1' },
                    });
                }
                if (url.endsWith('/dns_records') && method === 'POST') {
                    return Response.json({
                        success: true,
                        result: { id: 'dns-1' },
                    });
                }
                if (
                    url.includes('/dns_records?') &&
                    method === 'GET'
                ) {
                    return Response.json({ success: true, result: [] });
                }
                return Response.json({ success: true, result: {} });
            })
        );

        const result = await new Or3CloudWizardApi().testProviderConnection(
            'cloudflare-connect',
            {
                apiToken: 'cloudflare-token',
                hostnameSuffix: 'connect.example.com',
            }
        );

        expect(result.success).toBe(true);
        expect(
            requests.some(
                ({ url, method }) =>
                    method === 'POST' && url.endsWith('/cfd_tunnel')
            )
        ).toBe(true);
        expect(
            requests.some(
                ({ url, method }) =>
                    method === 'POST' && url.endsWith('/dns_records')
            )
        ).toBe(true);
        expect(requests.filter(({ method }) => method === 'DELETE')).toHaveLength(2);
    });
});
