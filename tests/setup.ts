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

// Mock useNuxtApp globally
vi.mock('#app', () => {
    const { ref } = require('vue');
    return {
        useNuxtApp: () => ({
            $iconRegistry: {
                resolve: (token: string) => {
                    if (token === 'sidebar.page.home')
                        return 'pixelarticons:home';
                    return token;
                },
            },
            $theme: {
                activeTheme: ref('light'),
                getResolver: () => ({ resolve: () => ({ props: {} }) }),
                setActiveTheme: vi.fn(),
            },
        }),
    };
});

// Mock useThemeOverrides globally
vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ({ value: {} }),
    useThemeResolver: () => ({
        activeTheme: { value: 'light' },
        resolveOverrides: () => ({}),
        setActiveTheme: vi.fn(),
    }),
}));

// Mock #imports
vi.mock('#imports', () => ({
    useNuxtApp: () => ({
        $iconRegistry: {
            resolve: (token: string) => {
                if (token === 'sidebar.page.home') return 'pixelarticons:home';
                return token;
            },
        },
        $theme: {
            activeTheme: { value: 'light' },
            getResolver: () => ({ resolve: () => ({ props: {} }) }),
            setActiveTheme: vi.fn(),
        },
    }),
    useRuntimeConfig: () => ({
        public: {},
    }),
    useHead: vi.fn(),
    useColorMode: () => ({ value: 'light' }),
    useIcon: (token: string) => ({ value: token }),
}));

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
