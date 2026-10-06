import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount as mountComponent } from '@vue/test-utils';
import * as nuxtImports from '#imports';
import { kv } from '~/db';
import { getWorkspaceGeneration } from '~/db/client';
import { defineComponent, nextTick, reactive, ref, toRaw } from 'vue';
import ChatContainer from '../ChatContainer.vue';

// ChatContainer rendering coverage uses the real scroller so the revision
// contract is exercised end to end. `tests/setup.ts` mocks `or3-scroll` for
// the rest of the suite; this file opts back into the installed package.
vi.unmock('or3-scroll');

// Keep the real scroller's async ref updates inside the test DOM lifetime.
// Every mount is tracked, including tests that mount directly or throw.
const mountedWrappers = new Set<ReturnType<typeof mountComponent>>();
const mount = ((...args: Parameters<typeof mountComponent>) => {
    const wrapper = mountComponent(...args);
    mountedWrappers.add(wrapper);
    return wrapper;
}) as typeof mountComponent;

afterEach(async () => {
    await flushPromises();
    for (const wrapper of mountedWrappers) {
        if (!wrapper.vm.$.isUnmounted) wrapper.unmount();
        expect(wrapper.vm.$.isUnmounted).toBe(true);
    }
    mountedWrappers.clear();
    await flushPromises();
});

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

vi.mock('@vueuse/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@vueuse/core')>(),
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
    // A reload can seed a pending row before background admission has a job ID.
    // Synced completion must replace it; active generation must retain its
    // in-memory text, then accept the latest saved projection after settling.
    it('accepts synced completion for a pending turn without replacing a stream with stale parent history', async () => {
        const replace = vi.fn();
        const instance = makeChatInstance({ replaceCanonicalHistory: replace });
        instance.messages.value = [{ id: 'reply', role: 'assistant', text: '', pending: true }];
        const wrapper = mountChatInstance(instance);
        const completed = [{ id: 'reply', role: 'assistant' as const, content: 'Saved reply', pending: false }];
        await wrapper.setProps({ messageHistory: completed });
        expect(replace).toHaveBeenCalledWith(completed);
        replace.mockClear();
        instance.loading.value = true;
        await wrapper.setProps({ messageHistory: [{ ...completed[0]!, content: 'Latest saved reply' }] });
        expect(replace).not.toHaveBeenCalled();
        instance.loading.value = false;
        await nextTick();
        expect(replace).not.toHaveBeenCalled();
        await wrapper.setProps({ messageHistory: [{ ...completed[0]!, content: 'Latest saved reply' }] });
        expect(replace).toHaveBeenCalledWith([{ ...completed[0]!, content: 'Latest saved reply' }]);
        replace.mockClear();
        instance.loading.value = true;
        await nextTick();
        instance.loading.value = false;
        await nextTick();
        expect(replace).not.toHaveBeenCalled();
    });
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
                    Teleport: true,
                    ChatWelcomeCard: {
                        name: 'ChatWelcomeCard',
                        template: '<button data-test="welcome-preview" @click="$emit(\'dismiss\')">Welcome</button>',
                    },
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

    it('routes a compaction link through its originating container and scrolls the exact anchor only after history is loaded', async () => {
        const instance = makeChatInstance(); instance.threadId.value = 'child';
        instance.messages.value = [{ id: 'summary', role: 'system', text: 'Historical reference', compaction: {
            compaction_id: 'operation', source_thread_id: 'source', anchor_message_id: 'anchor', landmarks: [],
        } }];
        const wrapper = mountChatInstance(instance, { threadId: 'child' });
        try {
            await nextTick(); await flushPromises();
            const row = wrapper.findComponent(LazyChatMessage);
            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            const exposed = scroller.vm.$.exposed as { scrollToItemKey: (key: string, options?: unknown) => void };
            expect(typeof exposed.scrollToItemKey).toBe('function');
            const scroll = vi.spyOn(exposed, 'scrollToItemKey');
            row.vm.$emit('view-compaction-source', { threadId: 'unrelated', messageId: 'anchor', originThreadId: 'child' });
            expect(wrapper.emitted('thread-selected')).toBeUndefined();
            row.vm.$emit('view-compaction-source', { threadId: 'source', messageId: 'anchor', originThreadId: 'child' });
            expect(wrapper.emitted('thread-selected')).toBeUndefined();
            expect(wrapper.emitted('view-compaction-source')).toMatchObject([[{ threadId: 'source', messageId: 'anchor', originThreadId: 'child' }]]);
            await wrapper.setProps({ threadId: 'source' }); await flushPromises();
            const destination = wrapper.vm.$.exposed as { scrollToMessage: (target: { threadId: string; messageId: string; generation: number }) => void };
            destination.scrollToMessage({ threadId: 'source', messageId: 'anchor', generation: getWorkspaceGeneration() });
            expect(scroll).not.toHaveBeenCalled();
            instance.messages.value = [{ id: 'earlier', role: 'user', text: 'Earlier' }, { id: 'anchor', role: 'assistant', text: 'Exact original' }];
            await vi.waitFor(() => expect(scroll).toHaveBeenCalledWith('anchor', { align: 'center', smooth: false }));
            scroll.mockRestore();
        } finally { wrapper.unmount(); }
    });

    it('rejects a late source-link event while the new thread still shows the previous summary', async () => {
        const instance = makeChatInstance(); instance.threadId.value = 'child';
        instance.messages.value = [{ id: 'summary', role: 'system', text: 'Historical reference', compaction: {
            compaction_id: 'operation', source_thread_id: 'source', anchor_message_id: 'anchor', landmarks: [],
        } }];
        const wrapper = mountChatInstance(instance, { threadId: 'child' });
        try {
            await nextTick(); await flushPromises();
            await wrapper.setProps({ threadId: 'new-child' }); await flushPromises();
            expect(instance.threadId.value).toBe('new-child');
            wrapper.findComponent(LazyChatMessage).vm.$emit('view-compaction-source', { threadId: 'source', messageId: 'anchor', originThreadId: 'child' });
            expect(wrapper.emitted('thread-selected')).toBeUndefined();
            expect(wrapper.emitted('view-compaction-source')).toBeUndefined();
        } finally { wrapper.unmount(); }
    });

    it('keeps internally created blank-chat threads on the existing creation event', async () => {
        const instance = makeChatInstance(); instance.threadId.value = undefined;
        const wrapper = mountChatInstance(instance);
        try {
            await flushPromises();
            instance.threadId.value = 'newly-created'; await nextTick();
            expect(wrapper.emitted('thread-selected')).toEqual([['newly-created']]);
            expect(wrapper.emitted('view-compaction-source')).toBeUndefined();
        } finally { wrapper.unmount(); }
    });

    it('reopens welcome for an explicit preview and dismisses without saving preferences', async () => {
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig,
            public: { ...runtimeConfig.public, ssrAuthEnabled: false },
        });
        const route = vi.spyOn(nuxtImports, 'useRoute').mockReturnValue({ ...nuxtImports.useRoute(), query: { welcome: '1' } });
        const save = vi.spyOn(kv, 'set').mockResolvedValue(undefined as never);
        const wrapper = mountChatInstance(makeChatInstance({
            messages: ref([{ id: 'existing', role: 'user', text: 'Existing chat' }]),
        }));
        try {
            await flushPromises();
            await vi.waitFor(() => expect(wrapper.find('[data-test="welcome-preview"]').exists()).toBe(true));
            await wrapper.get('[data-test="welcome-preview"]').trigger('click');
            expect(wrapper.find('[data-test="welcome-preview"]').exists()).toBe(false);
            expect(save).not.toHaveBeenCalledWith('or3_welcome_card_dismissed', 'true');
        } finally {
            wrapper.unmount();
            route.mockRestore();
            save.mockRestore();
            config.mockRestore();
        }
    });

    it('keeps the sign-in gate when a welcome preview is requested', async () => {
        const route = vi.spyOn(nuxtImports, 'useRoute').mockReturnValue({ ...nuxtImports.useRoute(), query: { welcome: '1' } });
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig,
            public: { ...runtimeConfig.public, ssrAuthEnabled: true },
        });
        const wrapper = mountChatInstance(makeChatInstance());
        try {
            await flushPromises();
            expect(wrapper.find('[data-test="welcome-preview"]').exists()).toBe(false);
        } finally {
            wrapper.unmount();
            route.mockRestore();
            config.mockRestore();
        }
    });

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
            // Stream handlers clear the empty-response flag on first content;
            // the rendered generation must remain active until finalization.
            instance.tailAssistant.value!.pending = false;
            await nextTick();
            await nextTick();
            expect(
                rowFor(wrapper, 'tail-1').find('.test-reasoning').text()
            ).toBe('Considering options');
            expect(
                rowFor(wrapper, 'tail-1').find('.test-pending').text()
            ).toBe('pending');

            instance.streamState.text = 'abcd';
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe(
                'abcd'
            );
            expect(
                rowFor(wrapper, 'tail-1').find('.test-pending').text()
            ).toBe('pending');

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
