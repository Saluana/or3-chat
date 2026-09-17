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

function responseFor(url: string): unknown {
    if (url.startsWith('/api/admin/auth/session')) return { authenticated: true, role: 'admin' };
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
        return {
            pluginId: 'or3.sample-utility',
            requestedVersion: null,
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
        };
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

    it('shows the actionable block list instead of a bare refusal', async () => {
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('registry-install-disabled');
        expect(wrapper.text()).toContain('Open instance settings');
    });

    it('offers a copyable admin request when the account cannot install', async () => {
        fetchMock.mockImplementation((url: string) =>
            Promise.resolve(
                url.startsWith('/api/admin/auth/session')
                    ? { authenticated: true, role: 'member' }
                    : responseFor(url)
            )
        );
        const wrapper = mount(MarketplaceDiscover, { global: { stubs } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await wrapper.get('[data-testid="marketplace-card"]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(wrapper.text()).toContain('Copy request for an administrator');
        // The install action itself must not be offered to a member.
        expect(wrapper.find('[data-testid="marketplace-install"]').exists()).toBe(false);
    });
});
