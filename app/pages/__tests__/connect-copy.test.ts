import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, onBeforeUnmount } from 'vue';
import ConnectPage from '../connect.vue';

type ConnectPageSetup = { state: string };

function mountConnect(options: { enabled: boolean; code?: string }) {
    vi.stubGlobal('useRoute', () => ({ query: { code: options.code ?? '' } }));
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { connect: { enabled: options.enabled } } }));
    vi.stubGlobal('useIcon', (name: string) => ({ value: name }));
    vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
    vi.stubGlobal('nextTick', nextTick);

    return mount(ConnectPage, {
        global: {
            stubs: { NuxtLink: { template: '<a><slot /></a>' } },
        },
    });
}

describe('Connect approval recovery', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('renders the unavailable state when managed Connect is disabled', () => {
        const wrapper = mountConnect({ enabled: false });
        expect(wrapper.text()).toContain('Remote Connect unavailable');
        expect(wrapper.text()).toContain('administrator must configure and prove');
        expect(wrapper.find('form').exists()).toBe(false);
        wrapper.unmount();
    });

    it('renders expiry recovery after a code has expired', async () => {
        vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
            code: 'EXPIRED',
            computer: { name: 'Mac', platform: 'darwin', architecture: 'arm64' },
            expiresAt: Date.now() - 1_000,
        }));
        const wrapper = mountConnect({ enabled: true, code: 'EXPIRED' });
        await flushPromises();

        expect(wrapper.text()).toContain('This connection code expired');
        expect(wrapper.text()).toContain('npx @or3/connect');
        expect(wrapper.text()).toContain('Enter a new code');
        expect(wrapper.find('section[aria-busy="false"]').exists()).toBe(true);
        expect(wrapper.find('[aria-live="polite"]').text()).toContain('expired');
        wrapper.unmount();
    });

    it('shows terminal repair commands while waiting has timed out', async () => {
        const wrapper = mountConnect({ enabled: true });
        (wrapper.vm.$ as unknown as { setupState: ConnectPageSetup }).setupState.state = 'timed_out';
        await nextTick();

        expect(wrapper.text()).toContain('or3-intern connect status');
        expect(wrapper.text()).toContain('or3-intern connect doctor');
        expect(wrapper.text()).toContain('Still waiting for your computer');
        wrapper.unmount();
    });
});
