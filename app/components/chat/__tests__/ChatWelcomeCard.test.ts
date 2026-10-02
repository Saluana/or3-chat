import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import ChatWelcomeCard from '../ChatWelcomeCard.vue';

const startLogin = vi.fn();
const persistUserApiKey = vi.fn();
const toastAdd = vi.fn();
const runtimeConfig = ref({
    public: {
        branding: { appName: 'OR3' },
        ssrAuthEnabled: false,
    },
});

vi.mock('#imports', () => ({
    useToast: () => ({ add: toastAdd }),
    useRuntimeConfig: () => runtimeConfig.value,
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name),
}));

vi.mock('~/core/auth/useOpenrouter', () => ({
    useOpenRouterAuth: () => ({
        startLogin,
        isLoggingIn: ref(false),
    }),
}));

vi.mock('~/core/auth/useUserApiKey', () => ({
    persistUserApiKey: (...args: unknown[]) => persistUserApiKey(...args),
}));

const UButtonStub = {
    name: 'UButton',
    props: ['disabled', 'loading', 'icon'],
    inheritAttrs: false,
    template:
        '<button type="button" v-bind="$attrs" :disabled="disabled"><slot /></button>',
};

const UInputStub = {
    name: 'UInput',
    props: ['modelValue'],
    inheritAttrs: false,
    emits: ['update:modelValue'],
    template:
        '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

describe('ChatWelcomeCard a11y', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeConfig.value = {
            public: {
                branding: { appName: 'OR3' },
                ssrAuthEnabled: false,
            },
        };
    });

    function mountCard() {
        return mount(ChatWelcomeCard, {
            global: {
                stubs: {
                    UButton: UButtonStub,
                    UInput: UInputStub,
                },
            },
            attachTo: document.body,
        });
    }

    it('exposes dialog semantics with labelled title and description', async () => {
        const wrapper = mountCard();
        await flushPromises();
        await nextTick();

        const root = wrapper.get('[data-welcome-card]');
        expect(root.attributes('role')).toBe('dialog');
        expect(root.attributes('aria-modal')).toBe('true');
        expect(root.attributes('aria-labelledby')).toBe('chat-welcome-title');
        expect(root.attributes('aria-describedby')).toBe(
            'chat-welcome-description'
        );
        expect(wrapper.get('#chat-welcome-title').text()).toContain('Welcome to OR3');
        expect(wrapper.get('#chat-welcome-description').text()).toContain(
            'Connect OpenRouter to start chatting.'
        );

        wrapper.unmount();
    });

    it('reveals labelled key controls and key-use details on request', async () => {
        const wrapper = mountCard();
        await flushPromises();

        const disclosure = wrapper.get('[aria-controls="chat-welcome-existing-key"]');
        expect(disclosure.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('input').exists()).toBe(false);
        await disclosure.trigger('click');
        expect(disclosure.attributes('aria-expanded')).toBe('true');
        expect(wrapper.get('input').attributes('aria-label')).toBe(
            'OpenRouter API key'
        );
        expect(
            wrapper
                .findAll('button')
                .some((btn) => btn.attributes('aria-label') === 'Dismiss welcome')
        ).toBe(true);

        await disclosure.trigger('click');
        expect(wrapper.find('input').exists()).toBe(false);

        const keyDetails = wrapper.get('[aria-controls="chat-welcome-key-details"]');
        expect(keyDetails.attributes('aria-expanded')).toBe('false');
        expect(wrapper.find('a[href]').exists()).toBe(false);
        await keyDetails.trigger('click');
        expect(keyDetails.attributes('aria-expanded')).toBe('true');
        expect(wrapper.get('a[href]').attributes('href')).toBe('https://openrouter.ai/keys');
        await keyDetails.trigger('click');
        expect(wrapper.find('a[href]').exists()).toBe(false);

        wrapper.unmount();
    });

    it('offers OpenRouter connection in cloud mode', async () => {
        runtimeConfig.value = {
            public: {
                branding: { appName: 'OR3' },
                ssrAuthEnabled: true,
            },
        };

        const wrapper = mountCard();
        await flushPromises();

        expect(wrapper.get('#chat-welcome-description').text()).toContain(
            'Connect OpenRouter to start chatting.'
        );
        wrapper.unmount();
    });

    it('emits dismiss on Escape', async () => {
        const wrapper = mountCard();
        await flushPromises();

        await wrapper.get('[data-welcome-card]').trigger('keydown', {
            key: 'Escape',
        });

        expect(wrapper.emitted('dismiss')).toHaveLength(1);
        wrapper.unmount();
    });

    it('traps Tab focus within the card', async () => {
        const wrapper = mountCard();
        await flushPromises();
        await nextTick();

        const root = wrapper.get('[data-welcome-card]');
        const buttons = wrapper.findAll('button');
        const lastFocusable = wrapper.get<HTMLButtonElement>('[aria-controls="chat-welcome-key-details"]');
        lastFocusable.element.focus();

        await root.trigger('keydown', { key: 'Tab' });

        const active = document.activeElement as HTMLElement | null;
        expect(root.element.contains(active)).toBe(true);
        expect(active).toBe(buttons[0]!.element);

        wrapper.unmount();
    });
});
