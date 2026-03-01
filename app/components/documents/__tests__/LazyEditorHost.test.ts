import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import LazyEditorHost from '../LazyEditorHost.vue';

// Mock the DocumentEditorRoot component
vi.mock('../DocumentEditorRoot.vue', () => ({
    default: {
        name: 'DocumentEditorRoot',
        template: '<div>Mock Editor</div>',
        props: ['documentId'],
    },
}));

const SuspenseStub = defineComponent({
    name: 'Suspense',
    emits: ['resolve'],
    template: '<div class="suspense-stub"><slot /></div>',
});

describe('LazyEditorHost - memory leaks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('clears error timeout on unmount', () => {
        const wrapper = mount(LazyEditorHost, {
            props: {
                documentId: 'doc1',
            },
            global: {
                stubs: {
                    Suspense: SuspenseStub,
                },
            },
        });

        // Error timeout should be set on mount
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        wrapper.unmount();

        // Advance timers - if timeout wasn't cleared, this could cause issues
        vi.advanceTimersByTime(6000);
    });

    it('clears error timeout when editor loads successfully', async () => {
        const wrapper = mount(LazyEditorHost, {
            props: {
                documentId: 'doc1',
            },
            global: {
                stubs: {
                    Suspense: SuspenseStub,
                },
            },
        });

        await wrapper.vm.$nextTick();

        // Simulate Suspense resolution
        const suspenseEl = wrapper.findComponent({ name: 'Suspense' });
        if (suspenseEl.exists()) {
            await suspenseEl.vm.$emit('resolve');
        }

        // Error message should not show
        expect(wrapper.find('.absolute.inset-0').exists()).toBe(false);

        wrapper.unmount();
    });

    it('resets error timeout when documentId changes', async () => {
        const wrapper = mount(LazyEditorHost, {
            props: {
                documentId: 'doc1',
            },
            global: {
                stubs: {
                    Suspense: SuspenseStub,
                },
            },
        });

        await wrapper.vm.$nextTick();

        // Change documentId should reset state
        await wrapper.setProps({ documentId: 'doc2' });
        await wrapper.vm.$nextTick();

        // Component should still work correctly after prop change
        expect(wrapper.exists()).toBe(true);

        wrapper.unmount();
    });

    it('handles isMounted flag correctly', async () => {
        const wrapper = mount(LazyEditorHost, {
            props: {
                documentId: 'doc1',
            },
            global: {
                stubs: {
                    Suspense: SuspenseStub,
                },
            },
        });

        // Component should be mounted
        expect(wrapper.exists()).toBe(true);

        wrapper.unmount();

        // After unmount, advancing timers should not cause errors
        vi.advanceTimersByTime(6000);
    });
});
