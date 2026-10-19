import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import DefaultLockPage from '../DefaultLockPage.vue';
import { registerAuthUiAdapter, unregisterAuthUiAdapter } from '~/core/auth-ui/registry';

vi.mock('#imports', () => ({
    useRoute: () => ({ query: {} }),
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: true, authProvider: 'clerk', lockPage: { enabled: true }, legal: {} } }),
}));

afterEach(() => unregisterAuthUiAdapter('clerk'));

it('keeps account switching available alongside retry after a session registration error', async () => {
    const switchAccount = vi.fn();
    registerAuthUiAdapter({
        id: 'clerk',
        component: defineComponent({
            setup: () => () => h('button', { onClick: switchAccount }, 'Switch account'),
        }),
    });
    const wrapper = mount(DefaultLockPage, {
        props: { accessReason: 'session-error', errorMessage: 'This invitation is for a different email address.' },
        global: { stubs: { UAlert: true } },
    });
    try {
        const accountButton = wrapper.findAll('button').find(button => button.text() === 'Switch account');
        expect(accountButton, 'The provider account control must remain reachable after a 403').toBeDefined();
        await accountButton!.trigger('click');
        expect(switchAccount).toHaveBeenCalledOnce();
        expect(wrapper.findAll('button').some(button => /Retry|Try again/.test(button.text()))).toBe(true);
    } finally {
        wrapper.unmount();
    }
});
