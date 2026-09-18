import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    useMarketplaceConsent,
    useMarketplaceInstall,
    useMarketplaceInstalled,
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
});

describe('grant consent', () => {
    it('records the reviewed authority for the workspace', async () => {
        fetchMock.mockResolvedValue({ ok: true, workspaceId: 'ws-1' });
        const consent = useMarketplaceConsent();

        await expect(
            consent.approve({
                pluginId: 'sample.plugin',
                approvedGrants: ['settings.read', 'settings.write'],
                version: '1.0.0',
            })
        ).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/admin/plugins/packages/sample.plugin/grants',
            expect.objectContaining({
                method: 'POST',
                body: { approvedGrants: ['settings.read', 'settings.write'], version: '1.0.0' },
            })
        );
    });

    it('surfaces a refusal instead of pretending consent was recorded', async () => {
        fetchMock.mockRejectedValue(new Error('The approved grants must be among the authority the release requests.'));
        const consent = useMarketplaceConsent();

        await expect(
            consent.approve({ pluginId: 'sample.plugin', approvedGrants: ['settings.write'] })
        ).resolves.toBe(false);
        expect(consent.error.value).toContain('among the authority');
    });
});

describe('deep links', () => {
    it('builds a link the app shell consumes', () => {
        expect(marketplacePluginDeepLink('https://or3.test', 'sample.plugin')).toBe(
            'https://or3.test/?dashboard=marketplace&plugin=sample.plugin'
        );
    });
});
