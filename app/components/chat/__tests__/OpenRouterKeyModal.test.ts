import { beforeEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

// Failure inventory: a dismissed form retains a credential, or an account switch
// lets a previously entered credential be submitted under the new account.
const session = ref({ session: { provider: 'basic-auth', user: { id: 'account-a' } } });
const persist = vi.fn();
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ public: { ssrAuthEnabled: true } }), useToast: () => ({ add: vi.fn() }) }));
vi.mock('~/core/auth/useUserApiKey', () => ({ persistUserApiKey: (...args: unknown[]) => persist(...args) }));
vi.mock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => ({ data: session }) }));
vi.mock('~/composables/useIcon', () => ({ useIcon: () => ref('key') }));
import OpenRouterKeyModal from '../OpenRouterKeyModal.vue';

beforeEach(() => { session.value.session.user.id = 'account-a'; persist.mockReset(); });
it.each(['close', 'account'])('clears entered key bytes on %s before another save', async change => {
    const wrapper = mount(OpenRouterKeyModal, { props: { open: true }, global: { stubs: {
        AppModal: { template: '<div><slot/><slot name="footer"/></div>' },
        UFormField: { template: '<div><slot/></div>' },
        UButton: { template: '<button><slot/></button>' },
        UInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
    } } });
    try {
        await wrapper.get('input').setValue('sk-or-account-a-form-canary');
        if (change === 'close') { await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); }
        else { session.value.session.user.id = 'account-b'; await nextTick(); }
        expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
        const save = wrapper.findAll('button').find(button => button.text() === 'Save key')!;
        expect(save.attributes('disabled')).toBeDefined();
        expect(persist).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
});
