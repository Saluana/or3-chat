import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionStatusView } from '~~/shared/plugins/acquisition/contracts';
const { reconcileMock } = vi.hoisted(() => ({ reconcileMock: vi.fn() }));
const { portableActivationMock } = vi.hoisted(() => ({
    portableActivationMock: { current: null as null | Record<string, unknown> },
}));
const { marketplaceSession } = vi.hoisted(() => ({
    marketplaceSession: { current: null as null | Record<string, unknown> },
}));
vi.mock('~/composables/auth/useSessionContext', () => ({
    getCachedSessionContext: () => marketplaceSession.current,
}));

// The signal itself is guarded by `import.meta.client`, which is not set in the
// test runtime; the contract under test is that every successful mutation asks
// for a reconcile, so the request function is the seam.
vi.mock('~/composables/plugins/bundled-v1-manager-runtime', () => ({
    requestWorkspacePluginReconcile: reconcileMock,
    WORKSPACE_PLUGIN_RECONCILE_EVENT: 'or3:workspace-plugin-reconcile',
}));

// The confirmation observer reads the live activation registry; the mock is
// the registry, switched per test between matching, stale and absent states.
vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    getPortableActivation: (pluginId: string) => {
        const current = portableActivationMock.current;
        return current && (current as { pluginId?: string }).pluginId === pluginId
            ? current
            : null;
    },
    isPortableActivationReady: (activation: { status?: string }) =>
        activation.status === 'active',
}));

import {
    marketplacePluginDeepLink,
    sameMarketplaceTarget,
    useMarketplaceCatalog,
    useMarketplaceConsent,
    useMarketplaceDetail,
    useMarketplaceInstall,
    useMarketplaceInstalled,
    useMarketplacePreflight,
    useMarketplaceUpdateCheck,
} from '../useMarketplace';

/**
 * The marketplace is a *management* surface: every successful mutation must
 * reconcile the running plugin runtime (disabled code stops, enabled code
 * starts, an update replaces the sandbox), and a durable acquisition operation
 * must survive leaving the page.
 */
const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

function statusView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        operationId: 'op-1',
        pluginId: 'sample.plugin',
        workspaceId: 'ws-1',
        version: '1.0.0',
        stage: 'receipt-recorded',
        status: 'completed',
        percentComplete: 100,
        needsSetup: false,
        resumable: false,
        retryable: false,
        canceled: false,
        failure: null,
        updatedAt: 0,
        ...overrides,
    };
}

const pageResponse = {
    plugins: [],
    role: 'owner',
    canManageSitePlugins: true,
    workspaceId: 'ws-1',
    enabledPlugins: [],
    packagePlugins: [],
};

function reconcileReasons(): string[] {
    return reconcileMock.mock.calls.map((call) => String(call[0]));
}

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(pageResponse);
    reconcileMock.mockReset();
    localStorage.clear();
    marketplaceSession.current = null;
});

describe('marketplace mutations reconcile the plugin runtime', () => {
    it.each([
        [{ statusCode: 401, message: '[GET] /api/plugins/marketplace/catalog: 401 Unauthorized' }, 'Sign in again'],
        [{ statusCode: 403, message: '[GET] /api/plugins/marketplace/catalog: 403 Forbidden' }, 'Switch accounts or workspaces'],
        [new TypeError('Failed to fetch'), 'Your account access was not checked'],
    ])('explains catalog request failures without exposing the API error', async (failure, expected) => {
        fetchMock.mockRejectedValue(failure);
        const catalog = useMarketplaceCatalog();
        await catalog.load();
        expect(catalog.error.value).toContain(expected);
        expect(catalog.error.value).not.toContain('/api/plugins/marketplace/catalog');
    });

    it('keeps a registry failure notice free of server exception text', async () => {
        fetchMock.mockResolvedValue({ configured: true, catalog: null, notice: 'connect ECONNREFUSED registry.internal:443' });
        const catalog = useMarketplaceCatalog();
        await catalog.load();
        expect(catalog.notice.value).toContain('temporarily unavailable');
        expect(catalog.notice.value).not.toContain('registry.internal');
    });

    it('shows workspace installed plugins to a member without requesting admin data', async () => {
        marketplaceSession.current = { authenticated: true, role: 'viewer', deploymentAdmin: false, workspace: { id: 'ws-1' } };
        const digest = `sha256-${'a'.repeat(64)}`;
        fetchMock.mockImplementation((url: string) => {
            if (url === '/api/admin/plugins-page') return Promise.reject({ statusCode: 403 });
            if (url !== '/api/plugins/runtime-manifest') throw new Error(`Unexpected request: ${url}`);
            return Promise.resolve({
                workspaceId: 'ws-1',
                enabledPluginIds: ['or3sal.tasks'],
                installedPluginIds: ['or3sal.tasks'],
                runtime: {
                    'or3sal.tasks': {
                        lifecycleCoverage: 'managed-v2',
                        descriptorStatus: 'ready',
                        loadAllowed: true,
                        descriptor: { manifestVersion: 2, version: '0.2.0', artifact: { kind: 'package-v2', packageDigest: digest } },
                    },
                },
            });
        });
        const installed = useMarketplaceInstalled();
        expect(await installed.load('ws-1')).toBe(true);
        expect(installed.error.value).toBeNull();
        expect(installed.packages.value[0]?.display).toMatchObject({ version: '0.2.0', selectedDigest: digest, canOpen: true });
        expect(installed.canManageWorkspacePlugins.value).toBe(false);
        await expect(installed.setEnabled('or3sal.tasks', false)).rejects.toThrow('administrator');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses the workspace view when an old admin grant is refused', async () => {
        marketplaceSession.current = { authenticated: true, role: 'owner', deploymentAdmin: true, workspace: { id: 'ws-1' } };
        fetchMock.mockImplementation((url: string) => {
            if (url === '/api/admin/plugins-page') return Promise.reject({ statusCode: 401 });
            if (url === '/api/plugins/runtime-manifest') return Promise.resolve({
                workspaceId: 'ws-1',
                enabledPluginIds: ['or3sal.tasks'],
                installedPluginIds: ['or3sal.tasks'],
                runtime: { 'or3sal.tasks': { lifecycleCoverage: 'managed-v2', descriptorStatus: 'blocked', blockCode: 'package-disabled', loadAllowed: false } },
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const installed = useMarketplaceInstalled();
        expect(await installed.load('ws-1')).toBe(true);
        expect(installed.error.value).toBeNull();
        expect(installed.packages.value.map((entry) => entry.pluginId)).toEqual(['or3sal.tasks']);
        expect(installed.canManageWorkspacePlugins.value).toBe(false);
    });

    it('loads management when the separate admin session is valid', async () => {
        marketplaceSession.current = { authenticated: true, role: 'owner', deploymentAdmin: false, workspace: { id: 'ws-1' } };
        fetchMock.mockResolvedValue({ ...pageResponse, packagePlugins: [{ pluginId: 'sample.plugin' }] });
        const installed = useMarketplaceInstalled();
        expect(await installed.load('ws-1')).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/plugins-page');
        expect(installed.canManageSitePlugins.value).toBe(true);
        expect(installed.canManageWorkspacePlugins.value).toBe(true);
    });

    it('signals after enablement, removal and rollback', async () => {
        const installed = useMarketplaceInstalled();
        await installed.load();
        await installed.setEnabled('sample.plugin', false);
        await installed.uninstall('sample.plugin', 'sha256-test');
        await installed.rollback('sample.plugin');

        expect(reconcileReasons()).toEqual([
            'local-admin-change',
            'manifest-revision-change',
            'manifest-revision-change',
        ]);
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/plugins/workspace-enable', expect.objectContaining({
            body: expect.objectContaining({ expectedWorkspaceId: 'ws-1' }),
        }));
    });

    it('signals when an install operation completes', async () => {
        const operation = statusView();
        fetchMock.mockImplementation((url: string) => {
            if (String(url).includes('/status')) {
                return Promise.resolve({ ok: true, operation });
            }
            return Promise.resolve({ ok: true, operation });
        });

        const install = useMarketplaceInstall();
        const result = await install.start({ pluginId: 'sample.plugin', version: '1.0.0' });

        expect(result?.status).toBe('completed');
        expect(reconcileReasons()).toEqual(['manifest-revision-change']);
    });
});

describe('durable operations are recovered', () => {
    it('targets the recorded workspace when a resumed operation needs a browser canary', async () => {
        const operation = statusView({
            workspaceId: 'approved-workspace',
            stage: 'candidate-recorded',
            status: 'failed',
            retryable: true,
            failure: { code: 'client-canary-pending', retryable: true },
        });
        fetchMock.mockImplementation(async (url: string) =>
            url.endsWith('/canary') ? { ok: false } : { ok: true, operation }
        );

        const install = useMarketplaceInstall();
        await install.adopt('sample.plugin', 'op-1');

        expect(fetchMock).toHaveBeenCalledWith('/api/admin/plugins/packages/sample.plugin/canary', {
            method: 'POST',
            headers: { 'x-or3-admin-intent': 'admin' },
            body: { workspaceId: 'approved-workspace' },
        });
    });

    it('restores the unfinished operation that staged the requested version', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (String(url).startsWith('/api/admin/plugins/acquisitions?')) {
                return Promise.resolve({
                    ok: true,
                    operations: [
                        statusView({ operationId: 'op-newest', version: '3.0.0', status: 'failed' }),
                        statusView({
                            operationId: 'op-match',
                            version: '2.0.0',
                            status: 'paused',
                            needsSetup: true,
                            resumable: true,
                            retryable: true,
                            failure: { code: 'setup-required', message: 'Setup required', retryable: true },
                        }),
                    ],
                });
            }
            return Promise.resolve({});
        });

        const install = useMarketplaceInstall();
        const restored = await install.restore('sample.plugin', { version: '2.0.0' });

        expect(restored?.operationId).toBe('op-match');
        expect(install.operationId.value).toBe('op-match');
        expect(install.status.value?.needsSetup).toBe(true);
    });

    it('restores only an operation recorded for the requested workspace', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (String(url).startsWith('/api/admin/plugins/acquisitions?')) {
                return Promise.resolve({
                    ok: true,
                    operations: [
                        statusView({ operationId: 'op-other-ws', workspaceId: 'ws-2', status: 'failed' }),
                        statusView({ operationId: 'op-this-ws', workspaceId: 'ws-1', status: 'failed' }),
                    ],
                });
            }
            return Promise.resolve({});
        });

        const install = useMarketplaceInstall();
        const restored = await install.restore('sample.plugin', { workspaceId: 'ws-1' });
        expect(restored?.operationId).toBe('op-this-ws');
    });

    it('falls back to the newest unfinished operation when no version matches', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (String(url).startsWith('/api/admin/plugins/acquisitions?')) {
                return Promise.resolve({
                    ok: true,
                    operations: [
                        statusView({ operationId: 'op-newest', version: '3.0.0', status: 'failed' }),
                        statusView({ operationId: 'op-done', status: 'completed' }),
                    ],
                });
            }
            return Promise.resolve({});
        });

        const install = useMarketplaceInstall();
        const restored = await install.restore('sample.plugin', { version: '9.9.9' });
        expect(restored?.operationId).toBe('op-newest');
    });

    it('resumes a paused adopted operation instead of only watching it', async () => {
        let statusCalls = 0;
        fetchMock.mockImplementation((url: string) => {
            const target = String(url);
            if (target.endsWith('/retry')) {
                return Promise.resolve({
                    ok: true,
                    operation: statusView({ status: 'running', resumable: false, retryable: false }),
                });
            }
            if (target.includes('/status')) {
                statusCalls += 1;
                return Promise.resolve({
                    ok: true,
                    operation:
                        statusCalls === 1
                            ? statusView({
                                  status: 'paused',
                                  needsSetup: true,
                                  resumable: true,
                                  retryable: true,
                                  failure: {
                                      code: 'setup-required',
                                      message: 'Setup required',
                                      retryable: true,
                                  },
                              })
                            : statusView(),
                });
            }
            return Promise.resolve({});
        });

        const install = useMarketplaceInstall();
        const result = await install.adopt('sample.plugin', 'op-1');

        expect(result?.status).toBe('completed');
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/retry'))).toBe(true);
    });

    it('watches a running adopted operation without retrying it', async () => {
        let statusCalls = 0;
        fetchMock.mockImplementation((url: string) => {
            const target = String(url);
            if (target.includes('/status')) {
                statusCalls += 1;
                return Promise.resolve({
                    ok: true,
                    operation: statusCalls === 1 ? statusView({ status: 'running' }) : statusView(),
                });
            }
            return Promise.resolve({});
        });

        const install = useMarketplaceInstall();
        const result = await install.adopt('sample.plugin', 'op-1');

        expect(result?.status).toBe('completed');
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/retry'))).toBe(false);
    });
});

describe('grant consent', () => {
    it('records the reviewed authority for the workspace', async () => {
        fetchMock.mockResolvedValue({ ok: true, workspaceId: 'ws-1' });
        const consent = useMarketplaceConsent();

        await expect(
            consent.approve({
                pluginId: 'sample.plugin',
                approvedGrants: ['settings.read', 'settings.write'],
                expectedPackageDigest: `sha256-${'a'.repeat(64)}`,
                expectedAuthoritySha256: `sha256-${'b'.repeat(64)}`,
                version: '1.0.0',
            })
        ).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/admin/plugins/packages/sample.plugin/grants',
            expect.objectContaining({
                method: 'POST',
                body: {
                    approvedGrants: ['settings.read', 'settings.write'],
                    expectedPackageDigest: `sha256-${'a'.repeat(64)}`,
                    expectedAuthoritySha256: `sha256-${'b'.repeat(64)}`,
                    version: '1.0.0',
                },
            })
        );
    });

    it('surfaces a refusal instead of pretending consent was recorded', async () => {
        fetchMock.mockRejectedValue(new Error('The approved grants must be among the authority the release requests.'));
        const consent = useMarketplaceConsent();

        await expect(
            consent.approve({
                pluginId: 'sample.plugin',
                approvedGrants: ['settings.write'],
                expectedPackageDigest: null,
                expectedAuthoritySha256: `sha256-${'b'.repeat(64)}`,
            })
        ).resolves.toBe(false);
        expect(consent.error.value).toContain('among the authority');
    });
});

describe('update checks', () => {
    it('loads bounded registry update results without staging anything', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            configured: true,
            checkedAt: 1,
            plugins: [
                {
                    pluginId: 'sample.plugin',
                    installedVersion: '1.0.0',
                    latestVersion: '1.1.0',
                    status: 'update-available',
                },
            ],
        });

        const updateCheck = useMarketplaceUpdateCheck();
        const result = await updateCheck.check();

        expect(result?.plugins[0]).toMatchObject({
            pluginId: 'sample.plugin',
            status: 'update-available',
        });
        expect(
            fetchMock.mock.calls.map(([url]) => String(url))
        ).toEqual(['/api/admin/plugins/updates']);
    });

    it('surfaces a failed update check instead of reporting no updates', async () => {
        fetchMock.mockRejectedValue(new Error('Registry unreachable'));
        const updateCheck = useMarketplaceUpdateCheck();

        await expect(updateCheck.check()).resolves.toBeNull();
        expect(updateCheck.error.value).toContain('Could not connect');
    });

    it.each([401, 403])('explains administrator access after a %i update refusal', async (statusCode) => {
        fetchMock.mockRejectedValue(Object.assign(new Error('[GET] /api/admin/plugins/updates: Unauthorized'), { statusCode }));
        const updateCheck = useMarketplaceUpdateCheck();
        await expect(updateCheck.check()).resolves.toBeNull();
        expect(updateCheck.error.value).toContain('Sign in as a system administrator');
        expect(updateCheck.error.value).not.toContain('/api/');
    });
});

describe('selection-bound detail and preflight', () => {
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((settle) => {
            resolve = settle;
        });
        return { promise, resolve };
    }

    function preflightAnswer(pluginId: string): Record<string, unknown> {
        return {
            pluginId,
            requestedVersion: '1.0.0',
            status: 'installable',
            blocks: [],
            registry: { configured: true, installEnabled: true, origin: 'https://r', keys: 1 },
            host: {
                or3Version: '0.3.0',
                pluginApiVersion: '2.0.0',
                trustModes: [],
                grants: [],
                features: [],
            },
            release: {
                releaseId: 'rel_1',
                version: '1.0.0',
                archiveSha256: `sha256-${'a'.repeat(64)}`,
                packageTreeSha256: `sha256-${'b'.repeat(64)}`,
                authoritySha256: `sha256-${'c'.repeat(64)}`,
                requestedGrants: [],
                profile: 'or3-portable-client-v1',
                publishedAt: '2026-01-01T00:00:00.000Z',
                license: 'MIT',
            },
            advisories: { latestSequence: 0, acceptedSequence: 0, quarantined: false },
            storage: { freeBytes: 1, ok: true },
        };
    }

    it('ignores a detail answer that a newer request superseded', async () => {
        const alpha = deferred<{ entry: Record<string, unknown> }>();
        const beta = deferred<{ entry: Record<string, unknown> }>();
        fetchMock.mockImplementation((url: string) =>
            String(url).endsWith('/or3.alpha') ? alpha.promise : beta.promise
        );

        const detail = useMarketplaceDetail();
        const first = detail.load('or3.alpha');
        const second = detail.load('or3.beta');
        beta.resolve({ entry: { name: 'Beta' } });
        await second;
        alpha.resolve({ entry: { name: 'Alpha' } });
        const firstResult = await first;

        expect(firstResult.superseded).toBe(true);
        expect(detail.entry.value).toMatchObject({ name: 'Beta' });
    });

    it('drops the previous preflight answer as soon as a new check starts', async () => {
        const pending = deferred<Record<string, unknown>>();
        let calls = 0;
        fetchMock.mockImplementation(() => {
            calls += 1;
            return calls === 1 ? Promise.resolve(preflightAnswer('or3.alpha')) : pending.promise;
        });

        const preflight = useMarketplacePreflight();
        await preflight.run('or3.alpha');
        expect(preflight.result.value).not.toBeNull();

        const running = preflight.run('or3.alpha', '2.0.0');
        // The old answer must not survive as evidence for the new check.
        expect(preflight.result.value).toBeNull();
        expect(preflight.loading.value).toBe(true);
        pending.resolve(preflightAnswer('or3.alpha'));
        await running;
        expect(preflight.result.value).not.toBeNull();
    });

    it('refuses an answer that names a different plugin', async () => {
        fetchMock.mockResolvedValue(preflightAnswer('or3.other'));
        const preflight = useMarketplacePreflight();

        await expect(preflight.run('or3.alpha')).resolves.toBeNull();
        expect(preflight.result.value).toBeNull();
        expect(preflight.error.value).toContain('different plugin');
    });

    it('binds approval to the exact target tuple', () => {
        const target = {
            pluginId: 'p',
            releaseId: 'rel',
            version: '1.0.0',
            archiveSha256: 'a',
            packageTreeSha256: 'tree-a',
            authoritySha256: 'b',
            requestedGrants: ['settings.read'],
        };
        expect(sameMarketplaceTarget({ ...target }, target)).toBe(true);
        expect(sameMarketplaceTarget({ ...target, archiveSha256: 'c' }, target)).toBe(false);
        expect(sameMarketplaceTarget(null, target)).toBe(false);
    });
});

describe('deep links', () => {
    it('builds a link the app shell consumes', () => {
        expect(marketplacePluginDeepLink('https://or3.test', 'sample.plugin')).toBe(
            'https://or3.test/?dashboard=marketplace&plugin=sample.plugin'
        );
        expect(marketplacePluginDeepLink('https://or3.test', 'sample.plugin', '1.2.3')).toBe(
            'https://or3.test/?dashboard=marketplace&plugin=sample.plugin&version=1.2.3'
        );
    });
});


describe('install cancellation and recorded results', () => {
    it('does not cancel a terminal failure', async () => {
        const install = useMarketplaceInstall();
        install.operationId.value = 'op-1';
        install.status.value = statusView({ status: 'failed' }) as unknown as AcquisitionStatusView;
        expect(install.canCancel.value).toBe(false);
        await install.cancel();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a rejected cancel and leaves the operation available', async () => {
        const install = useMarketplaceInstall();
        install.operationId.value = 'op-1';
        install.status.value = statusView({ status: 'paused' }) as unknown as AcquisitionStatusView;
        fetchMock.mockRejectedValue({ statusCode: 403 });
        await install.cancel();
        expect(install.error.value).toContain('administrator access');
        expect(install.status.value?.status).toBe('paused');
        expect(install.canceling.value).toBe(false);
    });

    it('updates the displayed operation after cancellation', async () => {
        const install = useMarketplaceInstall();
        install.operationId.value = 'op-1';
        install.status.value = statusView({ status: 'paused' }) as unknown as AcquisitionStatusView;
        fetchMock.mockResolvedValue({ operation: statusView({ status: 'canceled', canceled: true }) });
        await install.cancel();
        expect(install.status.value?.status).toBe('canceled');
        expect(install.canCancel.value).toBe(false);
    });

    it('does not restore an old failure after a newer successful installation', async () => {
        fetchMock.mockResolvedValue({ operations: [
            statusView({ updatedAt: 20 }),
            statusView({ operationId: 'old', status: 'failed', updatedAt: 10 }),
        ] });
        const install = useMarketplaceInstall();
        expect(await install.restore('sample.plugin')).toBeNull();
    });

    it('keeps a dismissed outcome dismissed across refreshes', async () => {
        fetchMock.mockResolvedValue({ operations: [
            statusView({ operationId: 'dead', status: 'failed', updatedAt: 10 }),
        ] });
        const install = useMarketplaceInstall();

        expect((await install.restore('sample.plugin'))?.operationId).toBe('dead');
        install.dismiss();
        expect(install.operationId.value).toBeNull();
        expect(await install.restore('sample.plugin')).toBeNull();

        // A reload constructs a fresh composable against the same browser store.
        const reloaded = useMarketplaceInstall();
        expect(await reloaded.restore('sample.plugin')).toBeNull();
        expect(reloaded.status.value).toBeNull();
    });
});

describe('activation confirmation', () => {
    const TARGET = {
        pluginId: 'sample.plugin',
        packageTreeSha256: 'sha256-exact',
        workspaceId: 'ws-1',
    };

    beforeEach(() => {
        portableActivationMock.current = null;
    });

    it('confirms the exact package once it is running', async () => {
        portableActivationMock.current = {
            pluginId: 'sample.plugin',
            packageDigest: 'sha256-exact',
            workspaceId: 'ws-1',
            generation: 3,
            status: 'active',
            degradedContributions: [],
        };
        const install = useMarketplaceInstall();
        const outcome = await install.confirmActivation(TARGET);
        expect(outcome?.confirmed).toBe(true);
        expect(install.activationTimedOut.value).toBe(false);
    });

    it('rejects a matching version running other bytes, then times out honestly', async () => {
        portableActivationMock.current = {
            pluginId: 'sample.plugin',
            packageDigest: 'sha256-stale',
            workspaceId: 'ws-1',
            generation: 2,
            status: 'active',
            degradedContributions: [],
        };
        const install = useMarketplaceInstall();
        const outcome = await install.confirmActivation({ ...TARGET, timeoutMs: 10 });
        expect(outcome).toEqual({ confirmed: false, reason: 'timeout' });
        // The server outcome stands; only the displayed state changes.
        expect(install.activationTimedOut.value).toBe(true);
    });

    it('rejects another workspace activation', async () => {
        portableActivationMock.current = {
            pluginId: 'sample.plugin',
            packageDigest: 'sha256-exact',
            workspaceId: 'ws-2',
            generation: 3,
            status: 'active',
            degradedContributions: [],
        };
        const install = useMarketplaceInstall();
        const outcome = await install.confirmActivation({ ...TARGET, timeoutMs: 10 });
        expect(outcome?.confirmed).toBe(false);
        expect(install.activationTimedOut.value).toBe(true);
    });

    it('detaches on navigation without touching the operation', async () => {
        const install = useMarketplaceInstall();
        const pending = install.confirmActivation({ ...TARGET, timeoutMs: 5_000 });
        install.detachActivationConfirmation();
        await expect(pending).resolves.toBeNull();
        expect(install.activationTimedOut.value).toBe(false);
    });

    it('accepts a late matching observation without a new acquisition', async () => {
        const install = useMarketplaceInstall();
        await install.confirmActivation({ ...TARGET, timeoutMs: 10 });
        expect(install.activationTimedOut.value).toBe(true);
        portableActivationMock.current = {
            pluginId: 'sample.plugin',
            packageDigest: 'sha256-exact',
            workspaceId: 'ws-1',
            generation: 4,
            status: 'active',
            degradedContributions: [],
        };
        const late = await install.observeActivationNow(TARGET);
        expect(late?.confirmed).toBe(true);
        expect(install.activationTimedOut.value).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('late response ownership and refresh failures', () => {
    it('does not let a late start replace the restored selection', async () => {
        let resolveStart!: (value: unknown) => void;
        fetchMock.mockImplementation((url: string) => url.includes('?pluginId=')
            ? Promise.resolve({ok: true, operations: [statusView({operationId: 'b', pluginId: 'other.plugin', status: 'paused'})]})
            : new Promise((resolve) => { resolveStart = resolve; }));
        const install = useMarketplaceInstall();
        const pending = install.start({pluginId: 'sample.plugin'});
        install.reset();
        await install.restore('other.plugin');
        resolveStart({ok: true, operation: statusView()});
        expect(await pending).toBeNull();
        expect(install.operationId.value).toBe('b');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('only publishes the newest catalog request', async () => {
        const pending: ((value: unknown) => void)[] = [];
        fetchMock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
        const catalog = useMarketplaceCatalog();
        catalog.search.value = 'old'; const old = catalog.load();
        catalog.search.value = 'new'; const fresh = catalog.load();
        pending[1]!({configured: true, catalog: {items: [{name: 'new'}], total: 1}}); await fresh;
        pending[0]!({configured: true, catalog: {items: [{name: 'old'}], total: 2}}); await old;
        expect(catalog.cards.value).toEqual([{name: 'new'}]);
        expect(catalog.total.value).toBe(1);
    });
    it('reports committed changes with failed refresh and blocks further mutations', async () => {
        const installed = useMarketplaceInstalled();
        await installed.load();
        fetchMock.mockResolvedValueOnce({ok: true}).mockRejectedValueOnce(new Error('offline'));
        await expect(installed.setEnabled('sample.plugin', true)).rejects.toThrow('change was saved');
        expect(installed.stale.value).toBe(true);
        await expect(installed.rollback('sample.plugin')).rejects.toThrow('Refresh');
        fetchMock.mockResolvedValue(pageResponse);
        expect(await installed.load()).toBe(true);
        expect(installed.stale.value).toBe(false);
    });
});

it('clears protected installed data when refresh loses authorization', async () => {
    fetchMock.mockResolvedValue({...pageResponse, packagePlugins: [{pluginId: 'private'}], enabledPlugins: ['private']});
    const installed = useMarketplaceInstalled(); await installed.load();
    fetchMock.mockRejectedValue({statusCode: 403}); await installed.load();
    expect(installed.packages.value).toEqual([]);
    expect(installed.enabled.value).toEqual([]);
    expect(installed.workspaceId.value).toBeNull();
    expect(installed.stale.value).toBe(true);
});
it('blocks duplicate retries and ignores a retry response after selection changes', async () => {
    const install = useMarketplaceInstall();
    fetchMock.mockResolvedValue({ok: true, operations: [statusView({status: 'paused', retryable: true})]});
    await install.restore('sample.plugin');
    let resolveRetry!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => {resolveRetry = resolve;}));
    const pending = install.retry('sample.plugin');
    expect(await install.retry('sample.plugin')).toBeNull();
    install.reset();
    resolveRetry({ok: true, operation: statusView()});
    expect(await pending).toBeNull();
    expect(install.operationId.value).toBeNull();
    expect(reconcileMock).not.toHaveBeenCalled();
});
