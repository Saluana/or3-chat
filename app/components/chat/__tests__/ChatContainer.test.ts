import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ChatContainer from '../ChatContainer.vue';

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
    setupPanePromptCleanup: vi.fn(),
    usePanePendingPrompt: vi.fn(() => ({
        __v_isRef: true,
        value: undefined,
    })),
}));

vi.mock('~/state/global', () => ({
    state: { value: { openrouterKey: '' } },
    isMobile: { value: false },
}));

vi.mock('~/utils/chat/uiMessages', () => ({
    ensureUiMessage: (m: any) => m,
}));

const chatInstances: Array<{
    ensureHistorySynced: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    switchThread: ReturnType<typeof vi.fn>;
    setPendingPrompt: ReturnType<typeof vi.fn>;
}> = [];

const makeChatInstance = vi.hoisted(
    () => (overrides: Record<string, unknown> = {}) => {
        const threadId = { value: 'thread-1' as string | undefined };
        const instance = {
            messages: { value: [] },
            loading: { value: false },
            threadId,
            streamId: { value: undefined },
            streamState: { finalized: true },
            tailAssistant: { value: null },
            backgroundJobId: { value: null },
            backgroundJobMode: { value: 'none' },
            sendMessage: vi.fn().mockResolvedValue(undefined),
            retryMessage: vi.fn(),
            continueMessage: vi.fn(),
            applyLocalEdit: vi.fn().mockReturnValue(false),
            ensureHistorySynced: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn(),
            setPendingPrompt: vi.fn(),
            switchThread: vi.fn(async (nextThreadId: string | undefined) => {
                threadId.value = nextThreadId;
            }),
        };
        return { ...instance, ...overrides };
    }
);

const useChatMock = vi.hoisted(() =>
    vi.fn(() => {
        const instance = makeChatInstance();
        chatInstances.push({
            ensureHistorySynced: instance.ensureHistorySynced,
            clear: instance.clear,
            switchThread: instance.switchThread,
            setPendingPrompt: instance.setPendingPrompt,
        });
        return instance;
    })
);

useChatMock.mockImplementation(() => {
    const instance = makeChatInstance();
    chatInstances.push({
        ensureHistorySynced: instance.ensureHistorySynced,
        clear: instance.clear,
        switchThread: instance.switchThread,
        setPendingPrompt: instance.setPendingPrompt,
    });
    return instance;
});

vi.mock('@vueuse/core', () => ({
    useElementSize: () => ({ width: { value: 1000 }, height: { value: 800 } }),
}));

// Mock child components
const LazyChatMessage = { template: '<div>Message</div>' };
const LazyChatInputDropper = { template: '<div>Input</div>' };

const createThemeMock = () => ({
    activeComponents: {
        value: {
            'chat-message': LazyChatMessage,
            'chat-input': LazyChatInputDropper,
        },
    },
});

describe('ChatContainer', () => {
    const defaultProps = {
        threadId: 'thread-1',
        messageHistory: [],
        paneId: 'pane-1',
    };

    beforeEach(() => {
        chatInstances.length = 0;
        useChatMock.mockClear();
        (globalThis as Record<string, unknown>).useChat = useChatMock;
    });

    it('renders scroll to bottom button when scrolled up', async () => {
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
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

    it('does not throw when background job refs are null', async () => {
        useChatMock.mockImplementationOnce(() =>
            makeChatInstance({
                backgroundJobId: null,
                backgroundJobMode: null,
            })
        );

        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
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

        await nextTick();
        expect(wrapper.exists()).toBe(true);
    });

    it('initializes workflow state before immediate streaming effects run', () => {
        useChatMock.mockImplementationOnce(() =>
            makeChatInstance({
                messages: {
                    value: [
                        {
                            id: 'workflow-message',
                            role: 'assistant',
                            text: 'Running workflow',
                            workflowState: {
                                workflowId: 'workflow-1',
                                workflowName: 'Example workflow',
                                executionState: 'running',
                                executionOrder: [],
                                currentNodeId: null,
                                nodeStates: {},
                            },
                        },
                    ],
                },
            })
        );

        expect(() =>
            mount(ChatContainer, {
                props: defaultProps,
                global: {
                    mocks: { $theme: createThemeMock() },
                    stubs: {
                        LazyChatMessage,
                        LazyChatInputDropper,
                        ClientOnly: { template: '<div><slot /></div>' },
                        UButton: true,
                    },
                },
            })
        ).not.toThrow();
    });

    it('calls scrollToBottom when button is clicked', async () => {
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
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

    it('ensures history is synced on mount and thread switch', async () => {
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
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

        expect(chatInstances[0]?.ensureHistorySynced).toHaveBeenCalledTimes(1);

        await wrapper.setProps({ threadId: 'thread-2' });
        await nextTick();

        // Thread switches rebind in place — do not recreate useChat outside setup.
        expect(useChatMock).toHaveBeenCalledTimes(1);
        expect(chatInstances[0]?.switchThread).toHaveBeenCalledWith('thread-2', {
            pendingPromptId: undefined,
        });
    });
});
