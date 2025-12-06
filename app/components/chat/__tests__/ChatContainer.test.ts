import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ChatContainer from '../ChatContainer.vue';
import { ref, nextTick } from 'vue';

// Mocks
vi.mock('or3-scroll', () => ({
    Or3Scroll: {
        name: 'Or3Scroll',
        template:
            '<div class="or3-scroll"><slot :item="{}" :index="0" /></div>',
        methods: {
            scrollToBottom: vi.fn(),
            refreshMeasurements: vi.fn(),
        },
    },
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: () => ({ value: 'icon-name' }),
}));

vi.mock('~/composables/core/usePanePrompt', () => ({
    getPanePendingPrompt: vi.fn(),
    clearPanePendingPrompt: vi.fn(),
    setPanePendingPrompt: vi.fn(),
}));

vi.mock('~/state/global', () => ({
    isMobile: { value: false },
}));

vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (m: any) => m,
}));

vi.mock('#imports', () => ({
    useToast: () => ({ add: vi.fn() }),
    useChat: () => ({
        messages: { value: [] },
        loading: { value: false },
        threadId: { value: 'thread-1' },
        sendMessage: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn(),
    }),
    useHooks: () => ({
        on: vi.fn().mockReturnValue(() => {}),
        off: vi.fn(),
        doAction: vi.fn(),
    }),
}));

vi.mock('@vueuse/core', () => ({
    useElementSize: () => ({ width: { value: 1000 }, height: { value: 800 } }),
}));

// Mock child components
const LazyChatMessage = { template: '<div>Message</div>' };
const LazyChatInputDropper = { template: '<div>Input</div>' };

describe('ChatContainer', () => {
    const defaultProps = {
        threadId: 'thread-1',
        messageHistory: [],
        paneId: 'pane-1',
    };

    it('renders scroll to bottom button when scrolled up', async () => {
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                stubs: {
                    LazyChatMessage,
                    LazyChatInputDropper,
                    ClientOnly: { template: '<div><slot /></div>' },
                    UButton: {
                        template:
                            '<button class="u-button" @click="$emit(\'click\')"></button>',
                    },
                },
            },
        });

        // Simulate scroll event
        const scroller = wrapper.findComponent({ name: 'Or3Scroll' });

        // Initial state: at bottom
        scroller.vm.$emit('scroll', {
            scrollTop: 1000,
            scrollHeight: 1800,
            clientHeight: 800,
            isAtBottom: true,
        });
        await nextTick();

        // Button should be hidden (distanceFromBottom = 0)
        let buttonContainer = wrapper.find('.absolute.bottom-full');
        expect(buttonContainer.isVisible()).toBe(false);

        // Case: Not scrollable (scrollHeight <= clientHeight)
        scroller.vm.$emit('scroll', {
            scrollTop: 0,
            scrollHeight: 800,
            clientHeight: 800,
            isAtBottom: true,
        });
        await nextTick();
        expect(buttonContainer.isVisible()).toBe(false);

        // Scroll up
        scroller.vm.$emit('scroll', {
            scrollTop: 500,
            scrollHeight: 1800,
            clientHeight: 800,
            isAtBottom: false,
        });
        await nextTick();

        // Debug
        // console.log(wrapper.html());

        // distanceFromBottom = 1800 - 500 - 800 = 500
        buttonContainer = wrapper.find('.absolute.bottom-full');

        // Check if v-show is working by checking style display
        expect(buttonContainer.attributes('style')).not.toContain(
            'display: none'
        );

        // Check opacity calculation: Math.min(1, 500 / 150) = 1
        expect(buttonContainer.attributes('style')).toContain('opacity: 1');

        // Scroll up just a little bit (partial opacity)
        // distanceFromBottom = 75
        scroller.vm.$emit('scroll', {
            scrollTop: 925,
            scrollHeight: 1800,
            clientHeight: 800,
            isAtBottom: false,
        });
        await nextTick();

        // Opacity: 75 / 150 = 0.5
        expect(buttonContainer.attributes('style')).toContain('opacity: 0.5');
    });

    it('calls scrollToBottom when button is clicked', async () => {
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                stubs: {
                    LazyChatMessage,
                    LazyChatInputDropper,
                    ClientOnly: { template: '<div><slot /></div>' },
                    UButton: {
                        name: 'UButton',
                        template:
                            '<button class="u-button" @click="$emit(\'click\')"></button>',
                    },
                },
            },
        });

        // Simulate scroll up to show button
        const scroller = wrapper.findComponent({ name: 'Or3Scroll' });

        // Replace the method with a fresh spy to ensure we can track it
        scroller.vm.scrollToBottom = vi.fn();

        scroller.vm.$emit('scroll', {
            scrollTop: 500,
            scrollHeight: 1800,
            clientHeight: 800,
            isAtBottom: false,
        });
        await nextTick();

        const button = wrapper.findComponent({ name: 'UButton' });
        await button.trigger('click');

        expect(scroller.vm.scrollToBottom).toHaveBeenCalledWith({
            smooth: true,
        });
    });
});
