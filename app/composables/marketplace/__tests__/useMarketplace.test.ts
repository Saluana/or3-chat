import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionStatusView } from '~~/shared/plugins/acquisition/contracts';
const { reconcileMock } = vi.hoisted(() => ({ reconcileMock: vi.fn() }));

// The signal itself is guarded by `import.meta.client`, which is not set in the
// test runtime; the contract under test is that every successful mutation asks
// for a reconcile, so the request function is the seam.
vi.mock('~/composables/plugins/bundled-v1-manager-runtime', () => ({
    requestWorkspacePluginReconcile: reconcileMock,
    WORKSPACE_PLUGIN_RECONCILE_EVENT: 'or3:workspace-plugin-reconcile',
}));

import {
    marketplacePluginDeepLink,
    sameMarketplaceTarget,
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
});

describe('marketplace mutations reconcile the plugin runtime', () => {
    it('signals after enablement, removal and rollback', async () => {
        const installed = useMarketplaceInstalled();
        await installed.setEnabled('sample.plugin', false);
        await installed.uninstall('sample.plugin');
        await installed.rollback('sample.plugin');

        expect(reconcileReasons()).toEqual([
            'local-admin-change',
            'manifest-revision-change',
            'manifest-revision-change',
        ]);
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
        const result = await install.adopt('sample.plugin', 'op-paused');

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
        const result = await install.adopt('sample.plugin', 'op-running');

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
        expect(updateCheck.error.value).toContain('Registry unreachable');
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
});
