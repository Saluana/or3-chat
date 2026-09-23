import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { testRuntimeConfig } from '../../../../tests/setup';
import MarketplaceDiscover from '../MarketplaceDiscover.vue';
import { acquisitionFailureHelp, acquisitionRequestError } from '~~/shared/plugins/acquisition/failure-presentation';
import type { AcquisitionStatusView } from '~~/shared/plugins/acquisition/contracts';
import { setMarketplaceSetupPlugin } from '~/composables/marketplace/useMarketplaceSetup';

const fetchMock = vi.fn();
const openPageMock = vi.fn();
const { confirmationState } = vi.hoisted(() => ({
    confirmationState: {
        activation: null as null | Record<string, unknown>,
    },
}));
vi.mock('~/composables/dashboard/useDashboardPlugins', () => ({
    useDashboardNavigation: () => ({ openPage: openPageMock }),
}));
// Activation confirmation reads the live registry; the mock answers instantly
// so completed installs do not wait out the 30s window in tests.
vi.mock('~/composables/plugins/portable-client-runtime', () => ({
    getPortableActivation: (pluginId: string) =>
        confirmationState.activation &&
        (confirmationState.activation as { pluginId?: string }).pluginId === pluginId
            ? confirmationState.activation
            : null,
    isPortableActivationReady: (activation: { status?: string }) =>
        activation.status === 'active',
}));
// `$fetch` is a Nuxt auto-import: the composables call the global, so the test
// replaces the global rather than mocking a module.
vi.stubGlobal('$fetch', fetchMock);

const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
let userAgentSpy: ReturnType<typeof vi.spyOn>;

const stubs = {
    UInput: { props: ['modelValue'], template: '<input />' },
    UButton: {
        props: ['disabled', 'loading', 'to'],
        emits: ['click'],
        template:
            '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
    UAlert: {
        props: ['title', 'description'],
        template: '<div role="alert">{{ title }} {{ description }}</div>',
    },
    UBadge: { template: '<span><slot /></span>' },
};

function preflightResponse(overrides: Record<string, unknown> = {}) {
    return {
        pluginId: 'or3.sample-utility',
        requestedVersion: '1.0.0',
        status: 'blocked',
        blocks: [
            {
                code: 'registry-install-disabled',
                message: 'Registry installation is turned off on this instance.',
                action: 'enable-install',
            },
        ],
        registry: { configured: true, installEnabled: false, origin: 'https://r', keys: 1 },
        host: {
            or3Version: '0.3.0',
            pluginApiVersion: '2.0.0',
            trustModes: ['isolated-client'],
            grants: [],
            features: [],
            client: {
                profile: 'or3-portable-client-v1',
                qualifiedBrowsers: ['chromium'],
                staticHost: false,
            },
        },
        release: {
            releaseId: 'rel_1',
            version: '1.0.0',
            archiveSha256: `sha256-${'a'.repeat(64)}`,
            packageTreeSha256: `sha256-${'b'.repeat(64)}`,
            authoritySha256: `sha256-${'c'.repeat(64)}`,
            clientRuntime: 'required',
            requestedGrants: [],
            profile: 'or3-portable-client-v1',
            publishedAt: '2026-01-01T00:00:00.000Z',
            license: 'MIT',
        },
        advisories: { latestSequence: 3, acceptedSequence: 3, quarantined: false },
        storage: { freeBytes: 1, ok: true },
        ...overrides,
    };
}

function responseFor(url: string): unknown {
    if (url.startsWith('/api/admin/plugins-page')) return {workspaceId: 'ws-1', role: 'owner', canManageSitePlugins: true, plugins: [], packagePlugins: [], enabledPlugins: []};
    // The real admin session contract: a principal kind, not a role.
    if (url.startsWith('/api/admin/auth/session')) {
        return { authenticated: true, kind: 'super_admin' };
    }
    if (url.startsWith('/api/plugins/marketplace/catalog')) {
        return {
            configured: true,
            catalog: {
                total: 1,
                items: [
                    {
                        pluginId: 'or3.sample-utility',
                        name: 'Sample Utility',
                        summary: 'Summarise a document.',
                        publisher: { displayName: 'OR3' },
                    },
                ],
            },
        };
    }
    if (url.startsWith('/api/plugins/marketplace/preflight')) {
        return preflightResponse();
    }
    if (url.startsWith('/api/plugins/marketplace/or3.sample-utility')) {
        return {
            entry: {
                pluginId: 'or3.sample-utility',
                name: 'Sample Utility',
                summary: 'Summarise a document.',
                releases: [{ version: '1.0.0' }],
            },
        };
    }
    if (url.startsWith('/api/admin/plugins/acquisitions')) {
        return { ok: true, operations: [] };
    }
    return {};
}

function acquisitionOperation(overrides: Partial<AcquisitionStatusView> = {}): AcquisitionStatusView {
    return {
        operationId: 'op-1',
        pluginId: 'or3.sample-utility',
        workspaceId: 'ws-1',
        version: '1.0.0',
        stage: 'candidate-recorded',
        status: 'paused',
        percentComplete: 60,
        needsSetup: true,
        resumable: true,
        retryable: true,
        canceled: false,
        release: {
            releaseId: 'rel-1',
            archiveSha256: 'sha256-archive',
            packageTreeSha256: 'sha256-package',
            manifestSha256: 'sha256-manifest',
            authoritySha256: 'sha256-authority',
        },
        failure: { code: 'setup-required', stage: 'candidate-recorded', message: 'Finish setup', retryable: true },
        updatedAt: 0,
        ...overrides,
    };
}

/** A promise a test resolves by hand, to control response ordering exactly. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface MockInit {
    readonly method?: string;
    readonly body?: unknown;
}

/**
 * Two published plugins with controllable detail/preflight answers, so A and B
 * responses can be delivered in any order.
 */
function twoPluginFetch(options: {
    detail: Record<string, Promise<unknown>>;
    preflight: Record<string, Promise<unknown>>;
    grants?: Promise<unknown>;
    onAcquisitionPost?: () => void;
}): void {
    fetchMock.mockImplementation((url: string, init?: MockInit) => {
        const target = String(url);
        if (target.startsWith('/api/admin/auth/session')) {
            return Promise.resolve({ authenticated: true, kind: 'super_admin' });
        }
        if (target.startsWith('/api/plugins/marketplace/catalog')) {
            return Promise.resolve({
                configured: true,
                catalog: {
                    total: 2,
                    items: [
                        { pluginId: 'or3.alpha', name: 'Alpha', summary: 'First.' },
                        { pluginId: 'or3.beta', name: 'Beta', summary: 'Second.' },
                    ],
                },
            });
        }
        if (target.startsWith('/api/plugins/marketplace/preflight')) {
            const body = (init?.body ?? {}) as { pluginId?: string };
            return options.preflight[body.pluginId ?? ''] ?? Promise.resolve({});
        }
        if (target === '/api/plugins/marketplace/or3.alpha') {
            return options.detail['or3.alpha'] ?? Promise.resolve({ entry: null });
        }
        if (target === '/api/plugins/marketplace/or3.beta') {
            return options.detail['or3.beta'] ?? Promise.resolve({ entry: null });
        }
        if (target.startsWith('/api/admin/plugins/packages/') && target.endsWith('/grants')) {
            return options.grants ?? Promise.resolve({ ok: true });
        }
        if (target.startsWith('/api/admin/plugins/acquisitions')) {
            if (init?.method === 'POST') options.onAcquisitionPost?.();
            return Promise.resolve({ ok: true, operations: [] });
        }
        return Promise.resolve({});
    });
}

function entryFor(pluginId: string, name: string, summary: string, version: string) {
    return {
        entry: {
            pluginId,
            name,
            summary,
            releases: [{ version }],
        },
    };
}

describe('MarketplaceDiscover', () => {
    it('shows one retryable connection error and no empty-results message when requests have no response', async () => {
        fetchMock.mockImplementation((url: string) =>
            url.startsWith('/api/plugins/marketplace/catalog') ||
            url === '/api/admin/plugins-page' ||
            url === '/api/plugins/runtime-manifest'
                ? Promise.reject(new TypeError('Failed to fetch'))
                : Promise.resolve(responseFor(url))
        );
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();

        const error = wrapper.get('[data-testid="marketplace-catalog-error"]');
        expect(error.attributes('role')).toBe('alert');
        expect(error.classes()).toContain('p-4');
        expect(error.text()).toContain('account access was not checked');
        expect(error.text()).toContain('Try again');
        expect(wrapper.find('[data-testid="marketplace-installed-error"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('No published plugins matched');
        expect(wrapper.text()).not.toContain('/api/plugins/marketplace/catalog');
        const catalogRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/plugins/marketplace/catalog')).length;
        const beforeRetry = catalogRequests();
        await error.get('button').trigger('click');
        await flush();
        expect(catalogRequests()).toBe(beforeRetry + 1);
        wrapper.unmount();
    });

    it('keeps an installed-state error inside the padded marketplace page', async () => {
        fetchMock.mockImplementation((url: string) =>
            url === '/api/admin/plugins-page' || url === '/api/plugins/runtime-manifest'
                ? Promise.reject({ statusCode: 401, message: '[GET] /api/admin/plugins-page: 401 Unauthorized' })
                : Promise.resolve(responseFor(url))
        );
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();

        const frame = wrapper.get('[data-testid="marketplace-discover"]');
        const error = frame.get('[data-testid="marketplace-installed-error"]');
        expect(error.attributes('role')).toBe('alert');
        expect(error.classes()).toContain('p-4');
        expect(error.text()).toContain('Sign in again');
        expect(error.text()).not.toContain('/api/admin/plugins-page');
        expect(error.text()).toContain('Try again');
    });

    it.each([
        ['grant-review-required', 'Permission approval is needed'],
        ['setup-required', 'Finish plugin setup'],
        ['client-canary-pending', 'Browser verification is pending'],
        ['download-failed', 'The download could not finish'],
        ['package-verification-failed', 'Package safety checks did not pass'],
        ['internal-error', 'Installation needs attention'],
    ] as const)('explains %s without exposing arbitrary error text', (code, title) => {
        const view = acquisitionOperation({ failure: { code, stage: 'candidate-recorded', retryable: false, message: 'secret-token' } });
        const help = acquisitionFailureHelp(view);
        expect(help.title).toBe(title);
        expect(help.message).not.toContain('secret-token');
    });

    it.each([
        [401, 'Sign in again'], [403, 'administrator access'], [429, 'Wait a moment'], [500, 'server logs'],
    ])('explains HTTP %s failures before an operation exists', (statusCode, guidance) => {
        expect(acquisitionRequestError({ statusCode, message: 'secret-token' })).toContain(guidance);
        expect(acquisitionRequestError({ statusCode, message: 'secret-token' })).not.toContain('secret-token');
    });

    it('explains a failure, opens Installed, and copies only safe diagnostic fields', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', Object.assign(Object.create(window.navigator), { clipboard: { writeText } }));
        fetchMock.mockImplementation((url: string) => Promise.resolve(
            url.startsWith('/api/admin/plugins/acquisitions?')
                ? { ok: true, operations: [acquisitionOperation({
                    status: 'failed', needsSetup: false, retryable: false,
                    failure: { code: 'already-installed', stage: 'candidate-recorded', message: 'secret-token private-document', retryable: false },
                })] }
                : responseFor(url)
        ));
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await flush();
        expect(wrapper.text()).toContain('This version is already installed');
        expect(wrapper.text()).toContain('Refreshing does not retry it');
        expect(wrapper.findAll('button').some((button) => button.text() === 'Cancel')).toBe(false);
        expect(wrapper.text()).not.toContain('secret-token');
        expect(wrapper.find('[data-testid="marketplace-continue"]').exists()).toBe(false);
        await wrapper.get('[data-testid="marketplace-copy-diagnostics"]').trigger('click');
        expect(writeText).toHaveBeenCalledOnce();
        const report = JSON.parse(writeText.mock.calls[0]![0]);
        expect(report).toMatchObject({ failureCode: 'already-installed', version: '1.0.0' });
        expect(report).not.toHaveProperty('message');
        writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
        await wrapper.get('[data-testid="marketplace-copy-diagnostics"]').trigger('click');
        await flush();
        expect(wrapper.text()).toContain('copy it manually');
        expect(wrapper.get('[data-testid="marketplace-diagnostic-report"]').text()).toContain('op-1');
        const manage = wrapper.findAll('button').find((button) => button.text() === 'Manage installed plugins')!;
        await manage.trigger('click');
        expect(openPageMock).toHaveBeenCalledWith('marketplace', 'installed');
        // A recorded failure the operator can neither retry nor cancel must be
        // clearable, or the detail panel is a dead end on every visit.
        await wrapper.get('[data-testid="marketplace-dismiss-operation"]').trigger('click');
        await flush();
        expect(wrapper.find('[data-testid="marketplace-install-status"]').exists()).toBe(false);
        vi.unstubAllGlobals();
        vi.stubGlobal('$fetch', fetchMock);
    });

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((url: string) => Promise.resolve(responseFor(url)));
        // Dismissed outcomes are remembered per browser, so each test starts
        // from a store the previous test cannot have written to.
        localStorage.clear();
        confirmationState.activation = null;
        setMarketplaceSetupPlugin(null);
        // The contained profile is qualified on Chromium; tests decide when a
        // different engine is under test.
        userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(CHROME_UA);
    });

    afterEach(() => {
        window.history.replaceState({}, '', '/');
        userAgentSpy.mockRestore();
        testRuntimeConfig.value.public.ssrAuthEnabled = true;
    });

    it('lists published plugins from the local server', async () => {
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Sample Utility');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/plugins/marketplace/catalog'), expect.objectContaining({signal: expect.any(AbortSignal)})
        );
    });

    it('asks preflight for the resolved version of the listing', async () => {
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        // The registry addresses releases by plugin id and version, so preflight
        // must be asked about an exact version or every plugin is refused. The
        // engine reported is what the profile qualification is judged against.
        const preflightCall = fetchMock.mock.calls.find((call) =>
            String(call[0]).startsWith('/api/plugins/marketplace/preflight')
        );
        expect(preflightCall?.[1]).toMatchObject({
            body: {
                pluginId: 'or3.sample-utility',
                version: '1.0.0',
                clientEngine: 'chromium',
            },
        });
    });

    it('shows the actionable block list instead of a bare refusal', async () => {
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('registry-install-disabled');
        expect(wrapper.text()).toContain('Open instance settings');
    });

    it('offers a super admin the install action when nothing blocks it', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.startsWith('/api/plugins/marketplace/preflight')) {
                return Promise.resolve(
                    preflightResponse({
                        status: 'installable',
                        blocks: [],
                        registry: {
                            configured: true,
                            installEnabled: true,
                            origin: 'https://r',
                            keys: 1,
                        },
                    })
                );
            }
            return Promise.resolve(responseFor(url));
        });
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));

        const installButton = wrapper.get('[data-testid="marketplace-install"]');
        expect(installButton.attributes('disabled')).toBeUndefined();
        expect(installButton.text()).toContain('Install');
    });

    it('renders the detail identity and asks preflight for its resolved version', async () => {
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        // `detail.entry` is a ref; a script computation that reads it without
        // `.value` silently loses the name and summary.
        expect(wrapper.text()).toContain('Sample Utility');
        expect(wrapper.text()).toContain('Summarise a document.');
        expect(wrapper.text()).toContain('1.0.0');
    });

    it('replaces the install warning with actions for an installed plugin', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.startsWith('/api/admin/plugins-page')) {
                return Promise.resolve({
                    plugins: [],
                    role: 'owner',
                    canManageSitePlugins: true,
                    workspaceId: 'ws-1',
                    enabledPlugins: ['or3.sample-utility'],
                    packagePlugins: [
                        {
                            pluginId: 'or3.sample-utility',
                            workspaceEnabled: true,
                            pointer: {
                                current: { packageDigest: `sha256-${'a'.repeat(64)}` },
                                candidate: null,
                                previous: null,
                            },
                            startup: {
                                status: 'ready',
                                selectedSlot: 'current',
                                selectedDigest: `sha256-${'a'.repeat(64)}`,
                                issueCodes: [],
                            },
                            display: {
                                version: '1.0.0',
                                selectedDigest: `sha256-${'a'.repeat(64)}`,
                                candidateVersion: null,
                                candidateDigest: null,
                                canOpen: true,
                            },
                        },
                    ],
                });
            }
            if (url.startsWith('/api/plugins/marketplace/preflight')) {
                return Promise.resolve(
                    preflightResponse({
                        blocks: [
                            {
                                code: 'already-installed',
                                message: 'This plugin is already installed.',
                                action: 'use-installed',
                            },
                        ],
                    })
                );
            }
            return Promise.resolve(responseFor(url));
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await flush();

        expect(wrapper.get('[data-testid="marketplace-installed-actions"]').text()).toContain(
            'Configure'
        );
        expect(wrapper.get('[data-testid="marketplace-installed-actions"]').text()).toContain(
            'Uninstall'
        );
        expect(wrapper.find('[data-testid="marketplace-install"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="marketplace-block"]').exists()).toBe(false);
        await wrapper.get('[data-testid="marketplace-installed-configure"]').trigger('click');
        expect(openPageMock).toHaveBeenCalledWith('marketplace', 'configure');
    });

    it('uses the preflight installed signal when the admin package projection is unavailable', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.startsWith('/api/admin/plugins-page')) {
                return Promise.reject(new Error('Forbidden'));
            }
            if (url.startsWith('/api/plugins/marketplace/preflight')) {
                return Promise.resolve(
                    preflightResponse({
                        blocks: [
                            {
                                code: 'already-installed',
                                message: 'This plugin is already installed.',
                                action: 'use-installed',
                            },
                        ],
                    })
                );
            }
            return Promise.resolve(responseFor(url));
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await flush();

        expect(wrapper.get('[data-testid="marketplace-installed-actions"]').text()).toContain(
            'Configure'
        );
        expect(wrapper.find('[data-testid="marketplace-install"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="marketplace-installed-uninstall"]').exists()).toBe(false);
    });

    it('keeps recovery status visible for a candidate-only package pointer', async () => {
        const candidateDigest = `sha256-${'d'.repeat(64)}`;
        fetchMock.mockImplementation((url: string) => {
            if (url.startsWith('/api/admin/plugins-page')) {
                return Promise.resolve({
                    plugins: [],
                    role: 'owner',
                    workspaceId: 'ws-1',
                    enabledPlugins: [],
                    packagePlugins: [
                        {
                            pluginId: 'or3.sample-utility',
                            workspaceEnabled: false,
                            pointer: {
                                current: null,
                                candidate: { packageDigest: candidateDigest },
                                previous: null,
                            },
                            startup: {
                                status: 'inactive',
                                selectedSlot: null,
                                selectedDigest: null,
                                issueCodes: [],
                            },
                            display: {
                                version: null,
                                selectedDigest: null,
                                candidateVersion: '1.0.0',
                                candidateDigest,
                                canOpen: false,
                            },
                        },
                    ],
                });
            }
            if (url.startsWith('/api/plugins/marketplace/preflight')) {
                return Promise.resolve(
                    preflightResponse({
                        blocks: [
                            {
                                code: 'already-installed',
                                message: 'This plugin is already installed.',
                                action: 'use-installed',
                            },
                        ],
                    })
                );
            }
            return Promise.resolve(responseFor(url));
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await flush();

        expect(wrapper.find('[data-testid="marketplace-installed-actions"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="marketplace-block"]').exists()).toBe(true);
    });

    it('selects the plugin named by a request deep link', async () => {
        window.history.replaceState(
            {},
            '',
            '/?dashboard=marketplace&plugin=or3.sample-utility'
        );
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        const preflightCall = fetchMock.mock.calls.find((call) =>
            String(call[0]).startsWith('/api/plugins/marketplace/preflight')
        );
        expect(preflightCall?.[1]).toMatchObject({ body: { pluginId: 'or3.sample-utility' } });
        // The deep link selected the plugin: its detail action is on screen.
        expect(
            wrapper.find('[data-testid="marketplace-install"], [data-testid="marketplace-copy-request"]').exists()
        ).toBe(true);
    });

    it('restores a durable operation and offers Continue for a setup pause', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (String(url).startsWith('/api/admin/plugins/acquisitions?')) {
                return Promise.resolve({ ok: true, operations: [acquisitionOperation()] });
            }
            return Promise.resolve(responseFor(url));
        });
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.text()).toContain('setup-required');
        expect(wrapper.get('[data-testid="marketplace-continue"]').text()).toContain('Continue');
    });

    it('requires explicit consent before installing a release that asks for grants', async () => {
        fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
            if (url.startsWith('/api/plugins/marketplace/preflight')) {
                return Promise.resolve(
                    preflightResponse({
                        status: 'installable',
                        blocks: [],
                        registry: {
                            configured: true,
                            installEnabled: true,
                            origin: 'https://r',
                            keys: 1,
                        },
                        release: {
                            ...(preflightResponse().release as Record<string, unknown>),
                            requestedGrants: ['settings.read', 'settings.write'],
                        },
                    })
                );
            }
            if (url.startsWith('/api/admin/plugins/packages/or3.sample-utility/grants')) {
                return Promise.resolve({ ok: true });
            }
            if (url.startsWith('/api/admin/plugins/acquisitions') && init?.method === 'POST') {
                return Promise.resolve({ ok: true, operation: acquisitionOperation({ status: 'completed', failure: null }) });
            }
            if (url.startsWith('/api/admin/plugins/acquisitions/') && url.endsWith('/status')) {
                return Promise.resolve({ ok: true, operation: acquisitionOperation({ status: 'completed', failure: null }) });
            }
            return Promise.resolve(responseFor(url));
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(wrapper.get('[data-testid="marketplace-grant-consent"]').text()).toContain(
            'settings.read'
        );
        expect(wrapper.get('[data-testid="marketplace-install"]').attributes('disabled')).toBeDefined();

        await wrapper.get('[data-testid="marketplace-grant-approve"]').setValue(true);
        expect(wrapper.get('[data-testid="marketplace-install"]').attributes('disabled')).toBeUndefined();

        // The installed bytes run here, so activation confirmation resolves
        // without waiting out the 30s window.
        confirmationState.activation = {
            pluginId: 'or3.sample-utility',
            packageDigest: `sha256-${'b'.repeat(64)}`,
            workspaceId: 'ws-1',
            generation: 1,
            status: 'active',
            degradedContributions: [],
        };
        await wrapper.get('[data-testid="marketplace-install"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        const grantsAt = fetchMock.mock.calls.findIndex((call) =>
            String(call[0]).startsWith('/api/admin/plugins/packages/or3.sample-utility/grants')
        );
        const installAt = fetchMock.mock.calls.findIndex(
            (call) =>
                String(call[0]).startsWith('/api/admin/plugins/acquisitions') &&
                (call[1] as { method?: string } | undefined)?.method === 'POST'
        );
        expect(grantsAt).toBeGreaterThan(-1);
        expect(installAt).toBeGreaterThan(grantsAt);
        // Installation alone is not the success claim: the exact installed
        // package was observed running here.
        expect(
            wrapper.get('[data-testid="marketplace-activation-confirmation"]').text()
        ).toContain('Running here');
    });

    it('offers a copyable admin request when the account cannot install', async () => {
        fetchMock.mockImplementation((url: string) => {
            // A plain member is refused by the admin session route (403).
            if (url.startsWith('/api/admin/auth/session')) {
                return Promise.reject(
                    Object.assign(new Error('Forbidden'), { statusCode: 403 })
                );
            }
            return Promise.resolve(responseFor(url));
        });
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Copy request for an administrator');
        // The install action itself must not be offered to a member.
        expect(wrapper.find('[data-testid="marketplace-install"]').exists()).toBe(false);
    });

    it('ignores an older detail answer that arrives after a newer selection', async () => {
        const alphaDetail = deferred<unknown>();
        const betaDetail = deferred<unknown>();
        twoPluginFetch({
            detail: { 'or3.alpha': alphaDetail.promise, 'or3.beta': betaDetail.promise },
            preflight: {
                'or3.beta': Promise.resolve(
                    preflightResponse({
                        pluginId: 'or3.beta',
                        requestedVersion: '2.0.0',
                        release: { ...preflightResponse().release, version: '2.0.0' },
                    })
                ),
            },
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        const cards = wrapper.findAll('[data-testid="marketplace-card"]');
        await cards[0]?.trigger('click');
        await flush();
        await cards[1]?.trigger('click');
        await flush();

        betaDetail.resolve(entryFor('or3.beta', 'Beta', 'Second.', '2.0.0'));
        await flush();
        await flush();
        expect(wrapper.text()).toContain('Beta');
        expect(wrapper.text()).toContain('2.0.0');

        // The older request for Alpha settles last; it must not describe Beta.
        alphaDetail.resolve(entryFor('or3.alpha', 'Alpha', 'First.', '9.9.9'));
        await flush();
        await flush();
        expect(wrapper.text()).toContain('Beta');
        // Only the detail panel is selection-bound; the cards keep listing both.
        expect(wrapper.get('[data-testid="marketplace-detail"]').text()).not.toContain('First.');
        expect(wrapper.text()).not.toContain('9.9.9');
        expect(wrapper.get('[data-testid="marketplace-install"]').attributes('disabled')).toBeDefined();
    });

    it('refuses a late preflight answer as evidence for another selection', async () => {
        const alphaDetail = deferred<unknown>();
        const betaDetail = deferred<unknown>();
        const alphaPreflight = deferred<unknown>();
        const betaPreflight = deferred<unknown>();
        twoPluginFetch({
            detail: { 'or3.alpha': alphaDetail.promise, 'or3.beta': betaDetail.promise },
            preflight: {
                'or3.alpha': alphaPreflight.promise,
                'or3.beta': betaPreflight.promise.then(() => {
                    throw new Error('beta check failed');
                }),
            },
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        const cards = wrapper.findAll('[data-testid="marketplace-card"]');
        await cards[0]?.trigger('click');
        await flush();
        alphaDetail.resolve(entryFor('or3.alpha', 'Alpha', 'First.', '9.9.9'));
        await flush();
        await flush();

        await cards[1]?.trigger('click');
        await flush();
        betaDetail.resolve(entryFor('or3.beta', 'Beta', 'Second.', '2.0.0'));
        await flush();
        await flush();
        betaPreflight.resolve(undefined);
        await flush();
        await flush();
        expect(wrapper.get('[data-testid="marketplace-preflight-error"]').text()).toContain(
            'beta check failed'
        );

        // Alpha's installable answer arrives after Beta failed and must not be
        // shown, offered or consented to under Beta's selection.
        alphaPreflight.resolve(
            preflightResponse({
                pluginId: 'or3.alpha',
                requestedVersion: '9.9.9',
                status: 'installable',
                blocks: [],
                registry: { configured: true, installEnabled: true, origin: 'https://r', keys: 1 },
                release: {
                    ...preflightResponse().release,
                    version: '9.9.9',
                    requestedGrants: ['settings.read'],
                },
            })
        );
        await flush();
        await flush();
        expect(wrapper.text()).not.toContain('9.9.9');
        expect(wrapper.find('[data-testid="marketplace-grant-consent"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="marketplace-install"]').attributes('disabled')).toBeDefined();
    });

    it('abandons a confirmation when the selection changes while approval is in flight', async () => {        const approval = deferred<unknown>();
        let acquisitionPosts = 0;
        twoPluginFetch({
            detail: {
                'or3.alpha': Promise.resolve(entryFor('or3.alpha', 'Alpha', 'First.', '1.0.0')),
                'or3.beta': Promise.resolve(entryFor('or3.beta', 'Beta', 'Second.', '2.0.0')),
            },
            preflight: {
                'or3.alpha': Promise.resolve(
                    preflightResponse({
                        pluginId: 'or3.alpha',
                        requestedVersion: '1.0.0',
                        status: 'installable',
                        blocks: [],
                        registry: { configured: true, installEnabled: true, origin: 'https://r', keys: 1 },
                        release: {
                            ...preflightResponse().release,
                            requestedGrants: ['settings.read'],
                        },
                    })
                ),
                'or3.beta': Promise.resolve(
                    preflightResponse({
                        pluginId: 'or3.beta',
                        requestedVersion: '2.0.0',
                        status: 'installable',
                        blocks: [],
                        registry: { configured: true, installEnabled: true, origin: 'https://r', keys: 1 },
                        release: { ...preflightResponse().release, version: '2.0.0' },
                    })
                ),
            },
            grants: approval.promise,
            onAcquisitionPost: () => {
                acquisitionPosts += 1;
            },
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        const cards = wrapper.findAll('[data-testid="marketplace-card"]');
        await cards[0]?.trigger('click');
        await flush();
        await flush();

        await wrapper.get('[data-testid="marketplace-grant-approve"]').setValue(true);
        await wrapper.get('[data-testid="marketplace-install"]').trigger('click');
        await flush();

        // The operator switches selection while the approval POST is pending.
        await cards[1]?.trigger('click');
        await flush();
        approval.resolve({ ok: true });
        await flush();
        await flush();

        expect(acquisitionPosts).toBe(0);
    });

    it('keeps an unsupported browser read-only and offers a copy-link alternative', async () => {
        userAgentSpy.mockReturnValue(SAFARI_UA);
        fetchMock.mockImplementation((url: string, init?: MockInit) => {
            if (url.startsWith('/api/plugins/marketplace/preflight')) {
                return Promise.resolve(
                    preflightResponse({
                        status: 'installable',
                        blocks: [],
                        registry: {
                            configured: true,
                            installEnabled: true,
                            origin: 'https://r',
                            keys: 1,
                        },
                        release: {
                            ...preflightResponse().release,
                            requestedGrants: ['settings.read'],
                        },
                    })
                );
            }
            return Promise.resolve(responseFor(url));
        });

        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await flush();
        await flush();

        const preflightCall = fetchMock.mock.calls.find((call) =>
            String(call[0]).startsWith('/api/plugins/marketplace/preflight')
        );
        expect(preflightCall?.[1]).toMatchObject({ body: { clientEngine: 'webkit' } });
        expect(wrapper.find('[data-testid="marketplace-browser-unsupported"]').exists()).toBe(true);
        // No install action, no consent, and no download request may exist.
        expect(wrapper.find('[data-testid="marketplace-install"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="marketplace-grant-consent"]').exists()).toBe(false);
        expect(
            wrapper.find('[data-testid="marketplace-copy-plugin-link"]').exists()
        ).toBe(true);
        expect(
            fetchMock.mock.calls.some(
                ([url, init]) =>
                    String(url).startsWith('/api/admin/plugins/acquisitions') &&
                    (init as MockInit | undefined)?.method === 'POST'
            )
        ).toBe(false);
    });

    it('blocks installation before any request in a static build', async () => {
        testRuntimeConfig.value.public.ssrAuthEnabled = false;
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await flush();
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await flush();

        expect(
            wrapper.find('[data-testid="marketplace-install-unsupported"]').exists()
        ).toBe(true);
        expect(wrapper.find('[data-testid="marketplace-install"]').exists()).toBe(false);
    });
});
