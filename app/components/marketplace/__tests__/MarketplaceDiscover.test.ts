import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MarketplaceDiscover from '../MarketplaceDiscover.vue';

const fetchMock = vi.fn();
// `$fetch` is a Nuxt auto-import: the composables call the global, so the test
// replaces the global rather than mocking a module.
vi.stubGlobal('$fetch', fetchMock);

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

function preflightResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
        },
        release: {
            releaseId: 'rel_1',
            version: '1.0.0',
            archiveSha256: `sha256-${'a'.repeat(64)}`,
            packageTreeSha256: `sha256-${'b'.repeat(64)}`,
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

describe('MarketplaceDiscover', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((url: string) => Promise.resolve(responseFor(url)));
    });

    afterEach(() => {
        window.history.replaceState({}, '', '/');
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
        // must be asked about an exact version or every plugin is refused.
        const preflightCall = fetchMock.mock.calls.find((call) =>
            String(call[0]).startsWith('/api/plugins/marketplace/preflight')
        );
        expect(preflightCall?.[1]).toMatchObject({
            body: { pluginId: 'or3.sample-utility', version: '1.0.0' },
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
});
