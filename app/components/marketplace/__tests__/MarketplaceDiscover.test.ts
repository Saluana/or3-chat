import { describe, expect, it, vi, beforeEach } from 'vitest';
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
        template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
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
    return {};
}

describe('MarketplaceDiscover', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation((url: string) => Promise.resolve(responseFor(url)));
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
