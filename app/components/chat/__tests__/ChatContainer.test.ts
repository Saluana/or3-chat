import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, reactive, ref, toRaw } from 'vue';
import ChatContainer from '../ChatContainer.vue';

// ChatContainer rendering coverage uses the real scroller so the revision
// contract is exercised end to end. `tests/setup.ts` mocks `or3-scroll` for
// the rest of the suite; this file opts back into the installed package.
vi.unmock('or3-scroll');

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

const chatInstances: Array<ReturnType<typeof makeChatInstance>> = [];

const makeChatInstance = vi.hoisted(
    () => (overrides: Record<string, unknown> = {}) => {
        const threadId = ref<string | undefined>('thread-1');
        const messages = ref<Record<string, unknown>[]>([]);
        const streamId = ref<string | undefined>(undefined);
        const streamState = reactive({
            text: '',
            reasoningText: '',
            finalized: true,
            active: false,
            error: null as string | null,
            aborted: false,
            version: 0,
        });
        const tailAssistant = ref<Record<string, unknown> | null>(null);
        const instance = {
            messages,
            rawMessages: ref<Record<string, unknown>[]>([]),
            loading: ref(false),
            threadId,
            streamId,
            streamState,
            tailAssistant,
            backgroundJobId: ref<string | null>(null),
            backgroundJobMode: ref('none'),
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
        chatInstances.push(instance);
        return instance;
    })
);

useChatMock.mockImplementation(() => {
    const instance = makeChatInstance();
    chatInstances.push(instance);
    return instance;
});

vi.mock('@vueuse/core', () => ({
    useElementSize: () => ({ width: { value: 1000 }, height: { value: 800 } }),
}));

// Mock child components
const LazyChatMessage = defineComponent({
    name: 'LazyChatMessage',
    props: {
        message: { type: Object, required: true },
        threadId: { type: String, default: '' },
    },
    template: `
        <div class="test-message" :data-message-id="message.id">
            <span class="test-text">{{ message.text }}</span>
            <span class="test-reasoning">{{ message.reasoning_text || '' }}</span>
            <span class="test-pending">{{ message.pending ? 'pending' : 'settled' }}</span>
            <span class="test-tools">{{ (message.toolCalls || []).map((call) => call.name + ':' + call.status).join('|') }}</span>
            <span class="test-hashes">{{ (message.file_hashes || []).join('|') }}</span>
            <span class="test-error">{{ message.error || '' }}</span>
        </div>
    `,
});
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

    type MockChatInstance = ReturnType<typeof makeChatInstance>;

    function mountChatInstance(
        instance: MockChatInstance,
        props: Record<string, unknown> = {}
    ) {
        useChatMock.mockImplementationOnce(() => instance);
        return mount(ChatContainer, {
            props: { ...defaultProps, ...props },
            global: {
                mocks: { $theme: createThemeMock() },
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
    }

    function makeStreamingInstance(): MockChatInstance {
        const instance = makeChatInstance();
        instance.messages.value = [
            { id: 'stable-1', role: 'user', text: 'First question' },
            { id: 'stable-2', role: 'assistant', text: 'First answer' },
        ];
        instance.tailAssistant.value = {
            id: 'tail-1',
            role: 'assistant',
            text: '',
            stream_id: 'stream-1',
            pending: true,
        };
        instance.streamId.value = 'stream-1';
        instance.streamState.finalized = false;
        return instance;
    }

    const rowFor = (
        wrapper: ReturnType<typeof mountChatInstance>,
        id: string
    ) => wrapper.find(`.or3-scroll-item [data-msg-id="${id}"]`);

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
                messages: ref([
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
                ]),
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
        const scrollToMock = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true,
            writable: true,
            value: scrollToMock,
        });
        try {
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
            scroller.vm.$emit('scroll', {
                scrollTop: 500,
                scrollHeight: 1800,
                clientHeight: 800,
                isAtBottom: false,
            });
            await nextTick();

            const button = wrapper.findComponent({ name: 'UButton' });
            await button.trigger('click');

            expect(scrollToMock).toHaveBeenCalledWith(
                expect.objectContaining({ behavior: 'smooth' })
            );
        } finally {
            delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
        }
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

    describe('streaming rows through the real scroller', () => {
        it('renders repeated text updates through the same array and row', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance);
            await nextTick();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            const itemsBefore = toRaw(scroller.props('items') as unknown[]);
            const rowElement = rowFor(wrapper, 'tail-1').element;
            const revisionBefore = scroller.props('rowContentRevision') as number;

            for (const text of ['Hel', 'Hello', 'Hello world']) {
                instance.streamState.text = text;
                await nextTick();
                await nextTick();
                expect(
                    rowFor(wrapper, 'tail-1').find('.test-text').text()
                ).toBe(text);
            }

            expect(toRaw(scroller.props('items') as unknown[])).toBe(
                itemsBefore
            );
            expect(rowFor(wrapper, 'tail-1').element).toBe(rowElement);
            expect(
                scroller.props('rowContentRevision') as number
            ).toBe(revisionBefore + 3);
        });

        it('renders reasoning, pending, and same-length text transitions in place', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance);
            await nextTick();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            const itemsBefore = toRaw(scroller.props('items') as unknown[]);
            const rowElement = rowFor(wrapper, 'tail-1').element;
            expect(
                rowFor(wrapper, 'tail-1').find('.test-pending').text()
            ).toBe('pending');

            instance.streamState.reasoningText = 'Considering options';
            await nextTick();
            await nextTick();
            expect(
                rowFor(wrapper, 'tail-1').find('.test-reasoning').text()
            ).toBe('Considering options');
            expect(
                rowFor(wrapper, 'tail-1').find('.test-pending').text()
            ).toBe('settled');

            instance.streamState.text = 'abcd';
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe(
                'abcd'
            );
            expect(
                rowFor(wrapper, 'tail-1').find('.test-pending').text()
            ).toBe('settled');

            // Same-length replacement must still refresh the mounted row.
            instance.streamState.text = 'wxyz';
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe(
                'wxyz'
            );
            expect(toRaw(scroller.props('items') as unknown[])).toBe(
                itemsBefore
            );
            expect(rowFor(wrapper, 'tail-1').element).toBe(rowElement);
        });

        it('renders tool and attachment updates in the mounted tail row', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance);
            await nextTick();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            const itemsBefore = toRaw(scroller.props('items') as unknown[]);
            const rowElement = rowFor(wrapper, 'tail-1').element;

            instance.tailAssistant.value!.toolCalls = [
                { name: 'search', status: 'loading' },
            ];
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-tools').text()).toBe(
                'search:loading'
            );

            instance.tailAssistant.value!.file_hashes = ['hash-a'];
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-hashes').text()).toBe(
                'hash-a'
            );

            expect(toRaw(scroller.props('items') as unknown[])).toBe(
                itemsBefore
            );
            expect(rowFor(wrapper, 'tail-1').element).toBe(rowElement);
        });

        it('keeps projection rules across insertion, removal, dedup, and key changes', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance);
            await nextTick();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            const initialArray = toRaw(scroller.props('items') as unknown[]);
            expect(initialArray).toHaveLength(3);

            // Insertion below the tail keeps the tail last.
            instance.messages.value = [
                ...instance.messages.value,
                { id: 'stable-3', role: 'user', text: 'Another question' },
            ];
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'stable-3').exists()).toBe(true);
            expect(toRaw(scroller.props('items') as unknown[])).not.toBe(
                initialArray
            );
            expect(
                wrapper.findAll('.or3-scroll-item [data-msg-id]')
            ).toHaveLength(4);

            // Removal drops the row without stale content.
            instance.messages.value = instance.messages.value.filter(
                (message) => message.id !== 'stable-3'
            );
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'stable-3').exists()).toBe(false);
            expect(
                wrapper.findAll('.or3-scroll-item [data-msg-id]')
            ).toHaveLength(3);

            // Completing the tail and starting a new one swaps rows by key.
            instance.messages.value = [
                ...instance.messages.value,
                { id: 'tail-1', role: 'assistant', text: 'Final answer' },
            ];
            instance.tailAssistant.value = {
                id: 'tail-2',
                role: 'assistant',
                text: 'Next answer',
                stream_id: 'stream-2',
                pending: true,
            };
            instance.streamId.value = 'stream-2';
            await nextTick();
            await nextTick();
            expect(
                wrapper.findAll('.or3-scroll-item [data-msg-id="tail-1"]')
            ).toHaveLength(1);
            expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe(
                'Final answer'
            );
            expect(rowFor(wrapper, 'tail-2').find('.test-text').text()).toBe(
                'Next answer'
            );

            // id dedup: the tail is already in stable history.
            instance.messages.value = [
                ...instance.messages.value,
                { id: 'tail-2', role: 'assistant', text: 'Duplicate tail' },
            ];
            await nextTick();
            await nextTick();
            expect(
                wrapper.findAll('.or3-scroll-item [data-msg-id="tail-2"]')
            ).toHaveLength(1);

            // stream_id dedup: stable history already owns the stream.
            instance.tailAssistant.value = {
                id: 'tail-3',
                role: 'assistant',
                text: 'Streaming duplicate',
                stream_id: 'shared-stream',
                pending: true,
            };
            instance.streamId.value = 'shared-stream';
            instance.messages.value = [
                ...instance.messages.value,
                {
                    id: 'stable-4',
                    role: 'assistant',
                    text: 'Persisted stream',
                    stream_id: 'shared-stream',
                },
            ];
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-3').exists()).toBe(false);
            expect(rowFor(wrapper, 'stable-4').find('.test-text').text()).toBe(
                'Persisted stream'
            );
        });

        it('shows completed and aborted tails without dropping content', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance);
            await nextTick();

            instance.tailAssistant.value = {
                ...instance.tailAssistant.value!,
                text: 'Finished text',
                pending: false,
            };
            instance.streamState.finalized = true;
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe(
                'Finished text'
            );
            expect(
                rowFor(wrapper, 'tail-1').find('.test-pending').text()
            ).toBe('settled');

            instance.tailAssistant.value = {
                ...instance.tailAssistant.value!,
                error: 'stopped',
            };
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-error').text()).toBe(
                'stopped'
            );
        });

        it('rebuilds rows for history prepends and edits', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance);
            await nextTick();

            instance.messages.value = [
                { id: 'prepend-1', role: 'user', text: 'Older question' },
                ...instance.messages.value,
            ];
            await nextTick();
            await nextTick();
            const ids = wrapper
                .findAll('.or3-scroll-item [data-msg-id]')
                .map((row) => row.attributes('data-msg-id'));
            expect(ids[0]).toBe('prepend-1');
            expect(ids[ids.length - 1]).toBe('tail-1');

            instance.messages.value = instance.messages.value.map((message) =>
                message.id === 'stable-2'
                    ? { ...message, text: 'Edited answer' }
                    : message
            );
            await nextTick();
            await nextTick();
            expect(
                rowFor(wrapper, 'stable-2').find('.test-text').text()
            ).toBe('Edited answer');
        });

        it('projects workflow state changes into rendered rows', async () => {
            const instance = makeChatInstance({
                messages: ref([
                    {
                        id: 'wf-1',
                        role: 'assistant',
                        text: 'Running workflow',
                        workflowState: {
                            workflowId: 'workflow-1',
                            workflowName: 'Example workflow',
                            executionState: 'running',
                            executionOrder: [],
                            currentNodeId: null,
                            nodeStates: {},
                            version: 0,
                        },
                    },
                ]),
            });
            const wrapper = mountChatInstance(instance);
            await nextTick();

            expect(
                rowFor(wrapper, 'wf-1').find('.test-pending').text()
            ).toBe('pending');

            instance.messages.value = [
                {
                    ...instance.messages.value[0]!,
                    workflowState: {
                        ...(instance.messages.value[0]!
                            .workflowState as Record<string, unknown>),
                        executionState: 'complete',
                        finalOutput: 'Workflow done',
                        version: 1,
                    },
                },
            ];
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'wf-1').find('.test-text').text()).toBe(
                'Workflow done'
            );
            expect(
                rowFor(wrapper, 'wf-1').find('.test-pending').text()
            ).toBe('settled');
        });

        it('resets rendered rows when the tab changes', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance, { tabId: 'tab-a' });
            await nextTick();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            expect(scroller.props('contentKey')).toBe('tab-a');

            instance.messages.value = [
                { id: 'thread2-1', role: 'user', text: 'Second thread' },
            ];
            instance.tailAssistant.value = null;
            await wrapper.setProps({ tabId: 'tab-b' });
            await nextTick();
            await nextTick();

            expect(scroller.props('contentKey')).toBe('tab-b');
            expect(rowFor(wrapper, 'thread2-1').find('.test-text').text()).toBe(
                'Second thread'
            );
            expect(rowFor(wrapper, 'tail-1').exists()).toBe(false);
        });
    });
});
