// Global test setup: mock heavy virtualization lib to avoid jsdom/Bun hangs.
import { vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

// Mock errors utility globally for all tests
vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn((_code: string, _message: string, meta: any) => meta),
}));

// Mock useChat globally for tests (can be overridden in individual test files)
vi.mock('~/composables/chat/useAi', () => {
    return {
        useChat: () => ({
            messages: ref([]),
            loading: ref(false),
            streamId: ref(null),
            streamState: ref({ text: '', reasoningText: '', finalized: true }),
            tailAssistant: ref(null),
            threadId: ref(null),
            sendMessage: vi.fn(),
            retryMessage: vi.fn(),
            abort: vi.fn(),
            clear: vi.fn(),
        }),
    };
});

// Make useChat available globally for components that use it without imports (Nuxt auto-import)
(globalThis as any).useChat = () => ({
    messages: ref([]),
    loading: ref(false),
    streamId: ref(null),
    streamState: ref({ text: '', reasoningText: '', finalized: true }),
    tailAssistant: ref(null),
    threadId: ref(null),
    sendMessage: vi.fn(),
    retryMessage: vi.fn(),
    abort: vi.fn(),
    clear: vi.fn(),
});

vi.mock('virtua/vue', () => {
    const Base = defineComponent({
        name: 'MockVirtualListBase',
        props: {
            data: { type: Array, default: () => [] },
            itemSize: { type: [Number, Function], default: 0 },
            itemSizeEstimation: { type: [Number, Function], default: 0 },
            overscan: { type: Number, default: 0 },
        },
        setup(props, { slots }) {
            return () =>
                h(
                    'div',
                    { class: 'mock-virtualizer' },
                    (props.data as any[]).map((item: any, index: number) =>
                        slots.default ? slots.default({ item, index }) : null
                    )
                );
        },
    });
    return {
        VList: Base,
        Virtualizer: Base,
    };
});
