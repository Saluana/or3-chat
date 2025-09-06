import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import ChatContainer from '../ChatContainer.vue';

// Stubs for heavy children
const globalStubs = {
    VirtualMessageList: {
        template:
            '<div><slot name="item" v-for="(m,i) in messages" :message="m" :index="i" /><slot name="tail" /></div>',
        props: [
            'messages',
            'itemSizeEstimation',
            'overscan',
            'scrollParent',
            'wrapperClass',
        ],
    },
    ChatMessage: { template: '<div class="chat-msg" />' },
    'chat-input-dropper': { template: '<div />' },
};

// Mock useChat with factory function (hoisted by vitest)
vi.mock('~/composables/useAi', () => ({
    useChat: vi.fn(() => ({
        messages: ref([]),
        loading: ref(false),
        streamId: ref(null),
        streamState: ref({
            text: '',
            reasoningText: '',
            isActive: false,
            finalized: false,
            version: 0,
            isLoading: false,
            isError: false,
        }),
        threadId: ref('test-thread'),
        sendMessage: vi.fn(),
        retryMessage: vi.fn(),
        abort: vi.fn(),
        clear: vi.fn(),
    })),
}));

// Utility to fake scroll metrics (jsdom no layout)
function setScrollMetrics(
    el: HTMLElement,
    {
        scrollTop,
        scrollHeight,
        clientHeight,
    }: { scrollTop: number; scrollHeight: number; clientHeight: number }
) {
    Object.defineProperty(el, 'scrollTop', {
        value: scrollTop,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(el, 'scrollHeight', {
        value: scrollHeight,
        configurable: true,
    });
    Object.defineProperty(el, 'clientHeight', {
        value: clientHeight,
        configurable: true,
    });
}

describe('ChatContainer streaming jank (large markdown finalization)', () => {
    let mockUseChat: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // no console spying; assertions use DOM metrics

        // Get mocked useChat and configure return value
        const { useChat } = await import('~/composables/useAi');
        mockUseChat = vi.mocked(useChat);
        mockUseChat.mockReturnValue({
            messages: ref([]),
            loading: ref(false),
            streamId: ref(null),
            streamState: ref({
                text: '',
                reasoningText: '',
                isActive: false,
                finalized: false,
                version: 0,
                isLoading: false,
                isError: false,
            }),
            threadId: ref('test-thread'),
            sendMessage: vi.fn(),
            retryMessage: vi.fn(),
            abort: vi.fn(),
            clear: vi.fn(),
        });
    });

    it('maintains relative bottom position after large stream finalizes (no teleport)', async () => {
        // Setup base messages
        const baseMsgs = Array.from({ length: 10 }, (_, i) => ({
            id: 'm' + i,
            role: i % 2 ? 'assistant' : 'user',
            text: 'msg ' + i,
        }));

        // Configure mock to return specific instance
        const testChatInstance = {
            messages: ref(baseMsgs),
            loading: ref(false),
            streamId: ref('stream-1'),
            streamState: ref({
                text: 'Large streamed markdown: '.repeat(100),
                reasoningText: '',
                isActive: true,
                finalized: false,
                version: 0,
                isLoading: false,
                isError: false,
            }),
            threadId: ref('t1'),
            sendMessage: vi.fn(),
            retryMessage: vi.fn(),
            abort: vi.fn(),
            clear: vi.fn(),
        };
        mockUseChat.mockReturnValue(testChatInstance);

        const wrapper = mount(ChatContainer as any, {
            props: { messageHistory: baseMsgs, threadId: 't1' },
            global: { stubs: globalStubs },
        });
        await nextTick();

        // Access the chat instance via mock results (since useChat is shallowRef in component)
        const componentChat = mockUseChat.mock.results[0].value as any;

        // Debug: verify refs exist
        if (!componentChat.messages) {
            console.error(
                'Mock chat instance missing messages ref:',
                componentChat
            );
            throw new Error('Mock chat instance not properly configured');
        }

        // Locate scroll element
        const el = wrapper.element.querySelector(
            '.scrollbars'
        ) as HTMLElement | null;
        if (!el) throw new Error('No scroll element found');

        // Simulate viewport and user position not at bottom
        setScrollMetrics(el, {
            scrollTop: 2000,
            scrollHeight: 5000,
            clientHeight: 800,
        });
        await nextTick();

        // Pre-finalization distance
        const preDist = el.scrollHeight - el.scrollTop - el.clientHeight;

        // Trigger finalization by updating the mock's refs (triggers computed watchers in component)
        componentChat.streamState.value.text += ' Final large chunk: '.repeat(
            50
        );
        componentChat.streamState.value.finalized = true;
        componentChat.streamState.value.isActive = false;
        componentChat.streamId.value = null;

        // Wait for multiple ticks to ensure watchEffect and watcher process changes
        await nextTick();
        await nextTick();
        // Allow microtask queue and rAF simulation
        await new Promise((resolve) => setTimeout(resolve, 10));
        await nextTick();
        await nextTick();

        // Simulate post-growth scrollHeight increase (mimic DOM height after content growth)
        setScrollMetrics(el, {
            scrollTop: el.scrollTop,
            scrollHeight: 7500,
            clientHeight: 800,
        });
        await nextTick();

        // Allow DOM to settle and then verify the preserved distance from bottom
        await nextTick();
        await nextTick();
        await new Promise((r) => setTimeout(r, 10));
        const postDist = el.scrollHeight - el.scrollTop - el.clientHeight;
        expect(postDist).toBeCloseTo(preDist, 0);
    });
});
