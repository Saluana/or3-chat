import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { testRuntimeConfig } from '../../../../tests/setup';
import MarketplaceDiscover from '../MarketplaceDiscover.vue';

const fetchMock = vi.fn();
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

function acquisitionOperation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
        failure: { code: 'setup-required', message: 'Finish setup', retryable: true },
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
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((url: string) => Promise.resolve(responseFor(url)));
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
            expect.stringContaining('/api/plugins/marketplace/catalog')
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

        await wrapper.get('[data-testid="marketplace-install"]').trigger('click');
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
