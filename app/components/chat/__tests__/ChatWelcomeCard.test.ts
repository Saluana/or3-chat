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
            'local-first'
        );

        wrapper.unmount();
    });

    it('labels the paste key field and dismiss control', async () => {
        const wrapper = mountCard();
        await flushPromises();

        expect(wrapper.get('input').attributes('aria-label')).toBe(
            'OpenRouter API key'
        );
        expect(
            wrapper
                .findAll('button')
                .some((btn) => btn.attributes('aria-label') === 'Dismiss welcome')
        ).toBe(true);

        wrapper.unmount();
    });

    it('describes the self-hosted workspace in cloud mode', async () => {
        runtimeConfig.value = {
            public: {
                branding: { appName: 'OR3' },
                ssrAuthEnabled: true,
            },
        };

        const wrapper = mountCard();
        await flushPromises();

        expect(wrapper.get('#chat-welcome-description').text()).toContain(
            'connected to this self-hosted workspace'
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
        const input = wrapper.get('input');
        const lastFocusable = [...buttons, input].at(-1)!;
        lastFocusable.element.focus();

        await root.trigger('keydown', { key: 'Tab' });

        const active = document.activeElement as HTMLElement | null;
        expect(root.element.contains(active)).toBe(true);
        expect(active).toBe(buttons[0]!.element);

        wrapper.unmount();
    });
});
