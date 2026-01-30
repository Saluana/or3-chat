import 'fake-indexeddb/auto';
// Global test setup: mock heavy virtualization lib to avoid jsdom/Bun hangs.
import { vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

// Polyfill ResizeObserver for jsdom
class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserver;

// Mock errors utility globally for all tests
vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn(
        (code: string, message: string, meta?: Record<string, unknown>) => {
            const e = new Error(message) as Error & { code: string; tags?: unknown };
            e.code = code;
            if (meta?.tags) e.tags = meta.tags;
            return e;
        }
    ),
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
(globalThis as Record<string, unknown>).useChat = () => ({
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
vi.mock('#app', async () => {
    const { ref } = await import('vue');
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
        defineNuxtPlugin: (plugin: unknown) => plugin,
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

// Global test-configurable runtime config
const defaultTestConfig = {
    auth: { enabled: true, provider: 'clerk' },
    sync: { enabled: true, provider: 'convex', convexUrl: 'https://convex.test' },
    storage: { enabled: true, provider: 'convex' },
    backgroundJobs: { enabled: false, storageProvider: 'memory', maxConcurrentJobs: 20, jobTimeoutMs: 300000, completedJobRetentionMs: 300000 },
    admin: { 
        allowedHosts: [],
        allowRestart: false,
        allowRebuild: false,
        rebuildCommand: 'bun run build',
        basePath: '/admin',
        auth: {
            username: '',
            password: '',
            jwtSecret: '',
            jwtExpiry: '24h',
            deletedWorkspaceRetentionDays: '',
        },
    },
    branding: { appName: 'Test', logoUrl: '', defaultTheme: 'dark' },
    legal: { termsUrl: '', privacyUrl: '' },
    security: { allowedOrigins: [], forceHttps: false },
    limits: { enabled: false, requestsPerMinute: 20, maxConversations: 0, maxMessagesPerDay: 0, storageProvider: 'memory' },
    public: { 
        ssrAuthEnabled: true,
        branding: { appName: 'Test', logoUrl: '', defaultTheme: 'dark' },
        legal: { termsUrl: '', privacyUrl: '' },
    },
    clerkSecretKey: 'secret',
    openrouterApiKey: '',
    openrouterAllowUserOverride: true,
    openrouterRequireUserKey: false,
} as any;

export const testRuntimeConfig = {
    value: defaultTestConfig,
};

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
    useChat: (...args: unknown[]) => {
        const g = globalThis as Record<string, unknown>;
        const fn = g.useChat as ((...a: unknown[]) => unknown) | undefined;
        return fn ? fn(...args) : undefined;
    },
    useToast: () => ({ add: vi.fn() }),
    useHooks: () => ({
        on: vi.fn().mockReturnValue(() => {}),
        off: vi.fn(),
        doAction: vi.fn(),
    }),
    useRuntimeConfig: vi.fn(() => testRuntimeConfig.value),
    useState: (key: string, init?: () => unknown) => {
        const state = new Map();
        if (!state.has(key) && init) {
            state.set(key, init());
        }
        return { value: state.get(key) };
    },
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
                    (props.data as unknown[]).map(
                        (item: unknown, index: number) =>
                            slots.default
                                ? slots.default({ item, index })
                                : null
                    )
                );
        },
    });
    return {
        VList: Base,
        Virtualizer: Base,
    };
});

vi.mock('or3-scroll', () => {
    const Base = defineComponent({
        name: 'MockOr3Scroll',
        props: {
            items: { type: Array, default: () => [] },
            itemKey: { type: Function },
        },
        setup(props, { slots }) {
            return () =>
                h(
                    'div',
                    { class: 'mock-or3-scroll' },
                    [
                        slots.header ? slots.header() : null,
                        ...(props.items as unknown[]).map(
                            (item: unknown, index: number) =>
                                slots.default
                                    ? slots.default({ item, index })
                                    : null
                        ),
                        slots.footer ? slots.footer() : null,
                    ]
                );
        },
    });
    return {
        Or3Scroll: Base,
    };
});
