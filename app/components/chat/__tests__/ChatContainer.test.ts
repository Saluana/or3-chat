import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount as mountComponent } from '@vue/test-utils';
import * as nuxtImports from '#imports';
import * as nuxtApp from '#app';
import { kv } from '~/db';
import { evictWorkspaceDb, getActiveWorkspaceId, getWorkspaceGeneration, setActiveWorkspaceDb } from '~/db/client';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, tryGetHooks } from '~/core/hooks/useHooks';
import { computed, defineAsyncComponent, defineComponent, getCurrentInstance, h, KeepAlive, nextTick, reactive, ref, shallowRef, toRaw, type Component } from 'vue';
import ChatContainer from '../ChatContainer.vue';
import { CORE_APP_COMPONENT_DEFAULTS } from '~/theme/_shared/theme-components-registry';
import type { ChatRequestState, SendResult } from '~/utils/chat/types';
import * as sessionContext from '~/composables/auth/useSessionContext';

// ChatContainer rendering coverage uses the real scroller so streaming row
// updates are exercised end to end. `tests/setup.ts` mocks `or3-scroll` for
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
            requestState: ref<ChatRequestState>({ status: 'idle' }),
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
const messageUpdates = vi.fn<(id: string) => void>();
const LazyChatMessage = defineComponent({
    name: 'LazyChatMessage',
    props: {
        message: { type: Object, required: true },
        threadId: { type: String, default: '' },
        retryDisabled: Boolean,
        compactionAction: Object,
        historyRetrievalAvailable: Boolean,
    },
    // Match the message renderer's event boundary: listeners are not DOM attrs.
    emits: ['retry', 'continue', 'branch', 'view-compaction-source', 'view-related-thread', 'edited', 'begin-edit', 'cancel-edit', 'save-edit'],
    updated() { messageUpdates(this.message.id); },
    template: `
        <div class="test-message" :data-message-id="message.id">
            <span class="test-text">{{ message.text }}</span>
            <span class="test-reasoning">{{ message.reasoning_text || '' }}</span>
            <span class="test-pending">{{ message.pending ? 'pending' : 'settled' }}</span>
            <span class="test-tools">{{ (message.toolCalls || []).map((call) => call.name + ':' + call.status).join('|') }}</span>
            <span class="test-hashes">{{ (message.file_hashes || []).join('|') }}</span>
            <span class="test-error">{{ message.error || '' }}</span>
            <span class="test-compaction">{{ compactionAction?.blockedReason || '' }}</span>
        </div>
    `,
});
const LazyChatInputDropper = { template: '<div>Input</div>' };
const lazyBoundaryUpdates = vi.fn<(id: string) => void>();
const AsyncThemeMessage = Object.assign(defineAsyncComponent(async () => LazyChatMessage), {
    updated(this: { $attrs: { message: { id: string } } }) {
        lazyBoundaryUpdates(this.$attrs.message.id);
    },
});

const createThemeMock = (messageRenderer: Component = LazyChatMessage) => ({
    ...useNuxtApp().$theme,
    activeComponents: shallowRef({
        ...CORE_APP_COMPONENT_DEFAULTS,
        'chat-message': messageRenderer,
        'chat-input': LazyChatInputDropper,
    }),
});

const useNuxtApp = nuxtApp.useNuxtApp;
beforeEach(() => {
    vi.spyOn(nuxtApp, 'useNuxtApp').mockImplementation(() => {
        const app = useNuxtApp();
        const theme = getCurrentInstance()?.appContext.config.globalProperties.$theme;
        return { ...app, $theme: theme ?? createThemeMock() };
    });
});
afterEach(() => { vi.mocked(nuxtApp.useNuxtApp).mockRestore(); });

describe('ChatContainer', () => {
    it('accepts synced completion for a reloaded pending turn without a local request', async () => {
        const replace = vi.fn();
        const instance = makeChatInstance({ replaceCanonicalHistory: replace });
        instance.messages.value = [{ id: 'reply', role: 'assistant', text: '', pending: true }];
        const wrapper = mountChatInstance(instance);
        const completed = [{ id: 'reply', role: 'assistant' as const, content: 'Saved reply', pending: false }];
        await wrapper.setProps({ messageHistory: completed });
        expect(replace).toHaveBeenCalledWith(completed);
    });

    it('accepts messages arriving during a foreground stream after its separate tail settles', async () => {
        const instance = makeStreamingInstance();
        const replace = vi.fn();
        Object.assign(instance, { replaceCanonicalHistory: replace });
        instance.loading.value = true;
        instance.requestState.value = { status: 'streaming', requestId: 'request-1', userMessageId: 'stable-1', assistantMessageId: 'tail-1' };
        // useChat hides the empty loader on the first token; the tail still
        // belongs to the request and is deliberately absent from messages[].
        instance.tailAssistant.value!.pending = false;
        instance.streamState.text = 'Live response';
        const wrapper = mountChatInstance(instance);
        const history = [
            { id: 'stable-1', role: 'user' as const, content: 'First question', pending: false },
            { id: 'tail-1', role: 'assistant' as const, content: 'Saved response', stream_id: 'stream-1', pending: false },
            { id: 'remote-user', role: 'user' as const, content: 'Message from the other browser', pending: false },
        ];
        await wrapper.setProps({ messageHistory: history });
        expect(replace).not.toHaveBeenCalled();
        expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe('Live response');
        instance.loading.value = false;
        await nextTick();
        expect(replace).toHaveBeenCalledExactlyOnceWith(history);
    });

    it.each(['missing reply', 'unfinished reply', 'older generation', 'another thread'] as const)(
        'retains local output when deferred history contains %s', async reason => {
            const instance = makeStreamingInstance();
            const replace = vi.fn();
            Object.assign(instance, { replaceCanonicalHistory: replace });
            instance.loading.value = true;
            instance.requestState.value = { status: 'streaming', requestId: 'request-1', userMessageId: 'stable-1', assistantMessageId: 'tail-1' };
            instance.tailAssistant.value!.pending = false;
            instance.streamState.text = 'Local output';
            const wrapper = mountChatInstance(instance);
            await wrapper.setProps({ messageHistory: reason === 'missing reply' ? [] : [{
                id: 'tail-1', role: 'assistant', content: 'Stale response',
                stream_id: reason === 'older generation' ? 'previous-stream' : 'stream-1',
                pending: reason === 'unfinished reply',
            }] });
            if (reason === 'another thread') await wrapper.setProps({ threadId: 'thread-2' });
            instance.loading.value = false;
            await nextTick();
            expect(replace).not.toHaveBeenCalled();
            if (reason !== 'another thread') {
                expect(rowFor(wrapper, 'tail-1').find('.test-text').text()).toBe('Local output');
            }
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
        props: Record<string, unknown> = {},
        messageRenderer: Component = LazyChatMessage
    ) {
        useChatMock.mockImplementationOnce(() => instance);
        return mount(ChatContainer, chatMountOptions(props, messageRenderer));
    }

    function chatMountOptions(props: Record<string, unknown> = {}, messageRenderer: Component = LazyChatMessage) {
        return {
            props: { ...defaultProps, ...props },
            global: {
                config: { globalProperties: { $theme: createThemeMock(messageRenderer) } },
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
                        emits: ['click'],
                        template:
                            '<button class="u-button" @click="$emit(\'click\')"></button>',
                    },
                },
            },
        };
    }

    it('keeps the loading placeholder until the themed message renderer is ready', async () => {
        const instance = makeChatInstance();
        instance.messages.value = [{ id: 'saved', role: 'user', text: 'Saved message' }];
        let resolveRenderer!: (renderer: typeof LazyChatMessage) => void;
        const renderer = defineAsyncComponent(() => new Promise<typeof LazyChatMessage>(resolve => { resolveRenderer = resolve; }));
        const wrapper = mountChatInstance(instance, {}, renderer);
        await nextTick();

        expect(wrapper.find('.chat-message-list[aria-hidden="true"]').exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'Or3Scroll' }).exists()).toBe(false);
        resolveRenderer(LazyChatMessage);
        await flushPromises();
        expect(wrapper.get('[data-msg-id="saved"]').text()).toContain('Saved message');
    });

    it('waits for the active themed scroller to restore a cold conversation', async () => {
        const instance = makeChatInstance();
        instance.messages.value = [{ id: 'saved', role: 'user', text: 'Saved message' }];
        let resolveA!: (value: typeof LazyChatMessage) => void;
        let resolveB!: (value: typeof LazyChatMessage) => void;
        const a = defineAsyncComponent(() => new Promise<typeof LazyChatMessage>(resolve => { resolveA = resolve; }));
        const b = defineAsyncComponent(() => new Promise<typeof LazyChatMessage>(resolve => { resolveB = resolve; }));
        useChatMock.mockImplementationOnce(() => instance);
        const options = chatMountOptions({}, a);
        const wrapper = mount(ChatContainer, options);
        await nextTick();

        let restored = false;
        const saved = wrapper.vm.captureViewState();
        const restoring = wrapper.vm.restoreViewState(saved).then(() => { restored = true; });
        options.global.config.globalProperties.$theme.activeComponents.value = {
            ...options.global.config.globalProperties.$theme.activeComponents.value,
            'chat-message': b,
        };
        await nextTick();
        resolveA(LazyChatMessage);
        await flushPromises();
        const restoredBeforeMount = restored;
        resolveB(LazyChatMessage);
        await restoring;

        expect(restoredBeforeMount).toBe(false);
        expect(wrapper.findComponent({ name: 'Or3Scroll' }).exists()).toBe(true);
    });

    it('sends the names of both composer selections even when their bytes match', async () => {
        const send = vi.fn().mockResolvedValue({ status: 'complete' });
        const instance = makeChatInstance({ send });
        const wrapper = mountChatInstance(instance);
        await flushPromises();
        const attachments = ['first.pdf', 'second.pdf'].map(name => ({
            file: new File(['shared bytes'], name, { type: 'application/pdf' }),
            hash: 'shared-hash', name, status: 'ready', mime: 'application/pdf', kind: 'pdf',
        }));

        wrapper.findComponent(LazyChatInputDropper).vm.$emit('send', {
            text: 'Send', images: [], attachments, largeTexts: [], model: 'model', settings: {},
            registerResult: vi.fn(),
        });

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            files: [
                { type: 'application/pdf', url: 'shared-hash', name: 'first.pdf' },
                { type: 'application/pdf', url: 'shared-hash', name: 'second.pdf' },
            ],
        }));
    });

    it.each(['persisted', 'streaming'] as const)('accepts the matching turn once it is %s without waiting for the provider', async phase => {
        const instance = makeChatInstance();
        let finish!: (result: SendResult) => void;
        const terminal = new Promise<SendResult>(resolve => { finish = resolve; });
        Object.assign(instance, { send: () => { instance.requestState.value = { status: 'admitted', requestId: 'send' }; return terminal; } });
        const wrapper = mountChatInstance(instance); await flushPromises();
        let accepted = false;
        let acceptance!: Promise<SendResult>;
        wrapper.findComponent(LazyChatInputDropper).vm.$emit('send', {
            text: 'Keep this draft', images: [], attachments: [], largeTexts: [], model: 'model', settings: {},
            modelVariant: 'off', thinkingEnabled: false,
            registerResult: (_terminal: Promise<SendResult>, pending: Promise<SendResult>) => {
                acceptance = pending; void pending.then(() => { accepted = true; });
            },
        });
        try {
            instance.requestState.value = { status: 'persisted', requestId: 'other', userMessageId: 'other-user' };
            await flushPromises(); expect(accepted).toBe(false);
            instance.requestState.value = phase === 'persisted'
                ? { status: 'persisted', requestId: 'send', userMessageId: 'saved' }
                : { status: 'streaming', requestId: 'send', userMessageId: 'saved', assistantMessageId: 'assistant' };
            // A later refusal is recovered by Retry on the saved turn, not by restoring the draft.
            await expect(acceptance).resolves.toEqual({ status: 'accepted', requestId: 'send', userMessageId: 'saved',
                ...(phase === 'streaming' ? { assistantMessageId: 'assistant' } : {}) });
        } finally {
            finish({ status: 'failed', requestId: 'send', userMessageId: 'saved', reason: 'context_full', error: 'Request was refused' });
        }
    });

    it('accepts the matching provider receipt before terminal completion', async () => {
        const instance = makeChatInstance();
        let finish!: (result: SendResult) => void;
        const terminal = new Promise<SendResult>(resolve => { finish = resolve; });
        Object.assign(instance, { send: () => { instance.requestState.value = { status: 'admitted', requestId: 'send' }; return terminal; } });
        const wrapper = mountChatInstance(instance); await flushPromises();
        let accepted = false; let acceptance!: Promise<SendResult>;
        wrapper.findComponent(LazyChatInputDropper).vm.$emit('send', {
            text: 'Send', images: [], attachments: [], largeTexts: [], model: 'model', settings: {},
            modelVariant: 'off', thinkingEnabled: false,
            registerResult: (_terminal: Promise<SendResult>, pending: Promise<SendResult>) => {
                acceptance = pending; void pending.then(() => { accepted = true; });
            },
        });
        try {
            instance.requestState.value = { status: 'streaming', requestId: 'other', userMessageId: 'other-user', assistantMessageId: 'other-assistant', providerAccepted: true };
            await flushPromises(); expect(accepted).toBe(false);
            instance.requestState.value = { status: 'streaming', requestId: 'send', userMessageId: 'saved', assistantMessageId: 'assistant', providerAccepted: true };
            await expect(acceptance).resolves.toMatchObject({ status: 'accepted', userMessageId: 'saved', assistantMessageId: 'assistant' });
        } finally { finish({ status: 'complete', requestId: 'send', userMessageId: 'saved', assistantMessageId: 'assistant' }); }
    });

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
            // Replacing the same row must refresh the navigation authority;
            // stable listeners cannot retain its previous compaction payload.
            instance.messages.value = [{ id: 'summary', role: 'system', text: 'Updated reference', compaction: {
                compaction_id: 'updated-operation', source_thread_id: 'updated-source', anchor_message_id: 'updated-anchor', landmarks: [],
            } }];
            await nextTick(); await flushPromises();
            row.vm.$emit('view-compaction-source', { threadId: 'source', messageId: 'anchor', originThreadId: 'child' });
            expect(wrapper.emitted('view-compaction-source')).toHaveLength(1);
            row.vm.$emit('view-compaction-source', { threadId: 'updated-source', messageId: 'updated-anchor', originThreadId: 'child' });
            expect(wrapper.emitted('view-compaction-source')?.at(-1)).toMatchObject([{ threadId: 'updated-source', messageId: 'updated-anchor', originThreadId: 'child' }]);
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

    it('removes the teleported welcome while its chat view is cached', async () => {
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig, public: { ...runtimeConfig.public, ssrAuthEnabled: false },
        });
        const route = vi.spyOn(nuxtImports, 'useRoute').mockReturnValue({ ...nuxtImports.useRoute(), query: { welcome: '1' } });
        const shown = ref(true);
        const options = chatMountOptions();
        const wrapper = mount(defineComponent({
            setup: () => () => h(KeepAlive, () => shown.value ? h(ChatContainer, defaultProps) : h('div')),
        }), {
            attachTo: document.body,
            global: { ...options.global, stubs: { ...options.global.stubs, Teleport: false } },
        });
        try {
            await flushPromises();
            await vi.waitFor(() => expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(1));
            shown.value = false;
            await nextTick();
            await flushPromises();
            expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(0);
            shown.value = true;
            await nextTick();
            await flushPromises();
            expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(1);
        } finally {
            wrapper.unmount();
            route.mockRestore();
            config.mockRestore();
        }
    });

    it('hydrates welcome for the current workspace when the initial read belongs to an old workspace', async () => {
        const previousHooks = tryGetHooks();
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const previous = getActiveWorkspaceId();
        const ids = [`welcome-old-${crypto.randomUUID()}`, `welcome-new-${crypto.randomUUID()}`];
        const originalDb = setActiveWorkspaceDb(ids[0]!);
        await kv.set('or3_welcome_card_dismissed', 'true');
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig, public: { ...runtimeConfig.public, ssrAuthEnabled: false },
        });
        let release!: () => void;
        const delayed = new Promise<void>(resolve => { release = resolve; });
        const originalGet = kv.get;
        let first = true;
        const get = vi.spyOn(kv, 'get').mockImplementation(async (...args) => {
            const hold = args[0] === 'or3_welcome_card_dismissed' && first;
            if (hold) first = false;
            const row = await originalGet(...args);
            if (hold) await delayed;
            return row;
        });
        const wrapper = mountChatInstance(makeChatInstance());
        const currentDb = setActiveWorkspaceDb(ids[1]!);
        try {
            await nextTick();
            release();
            await flushPromises();
            await vi.waitFor(() => expect(wrapper.find('[data-test="welcome-preview"]').exists()).toBe(true));
        } finally {
            release(); wrapper.unmount(); get.mockRestore(); config.mockRestore();
            setActiveWorkspaceDb(previous);
            ids.forEach(evictWorkspaceDb);
            await Promise.all([originalDb.delete(), currentDb.delete()]);
            setHookEngine(previousHooks);
        }
    });

    it('refreshes persisted welcome dismissal before a cached chat becomes active again', async () => {
        const previousHooks = tryGetHooks();
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const previous = getActiveWorkspaceId();
        const id = `welcome-cached-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(id);
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig, public: { ...runtimeConfig.public, ssrAuthEnabled: false },
        });
        const shown = ref(true);
        const options = chatMountOptions();
        const wrapper = mount(defineComponent({
            setup: () => () => h(KeepAlive, () => shown.value ? h(ChatContainer, defaultProps) : h('div')),
        }), {
            attachTo: document.body,
            global: { ...options.global, stubs: { ...options.global.stubs, Teleport: false } },
        });
        try {
            await flushPromises();
            await vi.waitFor(() => expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(1));
            shown.value = false; await nextTick();
            await kv.set('or3_welcome_card_dismissed', 'true');
            shown.value = true; await nextTick(); await flushPromises();
            expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(0);
        } finally {
            wrapper.unmount(); config.mockRestore(); setActiveWorkspaceDb(previous);
            evictWorkspaceDb(id); await db.delete();
            setHookEngine(previousHooks);
        }
    });

    it('keeps welcome hidden until the authenticated workspace is selected', async () => {
        const previous = getActiveWorkspaceId();
        const ids = [`welcome-bootstrap-${crypto.randomUUID()}`, `welcome-auth-${crypto.randomUUID()}`];
        const bootstrapDb = setActiveWorkspaceDb(ids[0]!);
        await bootstrapDb.open();
        const session = sessionContext.useSessionContext({ autoLoad: false });
        const auth = ref<sessionContext.SessionPayload>({ appAccessAllowed: true,
            session: { authenticated: true, workspace: { id: ids[1]!, name: 'Authenticated target' } } });
        const state = vi.spyOn(sessionContext, 'useSessionContext').mockReturnValue({
            ...session, data: computed(() => auth.value),
        });
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig, public: { ...runtimeConfig.public, ssrAuthEnabled: true, openai: { hasInstanceKey: true } },
        });
        const route = vi.spyOn(nuxtImports, 'useRoute').mockReturnValue({ ...nuxtImports.useRoute(), query: { welcome: '1' } });
        const get = vi.spyOn(kv, 'get').mockResolvedValue(undefined);
        const wrapper = mountChatInstance(makeChatInstance());
        let targetDb: ReturnType<typeof setActiveWorkspaceDb> | undefined;
        try {
            await flushPromises();
            expect(wrapper.find('[data-test="welcome-preview"]').exists()).toBe(false);
            targetDb = setActiveWorkspaceDb(ids[1]!);
            await targetDb.open();
            await nextTick(); await flushPromises();
            await vi.waitFor(() => expect(wrapper.find('[data-test="welcome-preview"]').exists()).toBe(true));
        } finally {
            wrapper.unmount(); state.mockRestore(); route.mockRestore(); get.mockRestore(); config.mockRestore();
            setActiveWorkspaceDb(previous); ids.forEach(evictWorkspaceDb);
            await Promise.all([bootstrapDb.delete(), targetDb?.delete()]);
        }
    });

    it('keeps a dismissed cached welcome closed while its preference write is pending', async () => {
        const previousHooks = tryGetHooks();
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const previous = getActiveWorkspaceId();
        const id = `welcome-pending-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(id);
        const runtimeConfig = nuxtImports.useRuntimeConfig();
        const config = vi.spyOn(nuxtImports, 'useRuntimeConfig').mockReturnValue({
            ...runtimeConfig, public: { ...runtimeConfig.public, ssrAuthEnabled: false },
        });
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        let write: ReturnType<typeof kv.set> | undefined;
        const originalSet = kv.set;
        const save = vi.spyOn(kv, 'set').mockImplementation((...args) => {
            if (args[0] !== 'or3_welcome_card_dismissed') return originalSet(...args);
            write = pending.then(() => originalSet(...args));
            return write;
        });
        const shown = ref(true);
        const options = chatMountOptions();
        const wrapper = mount(defineComponent({
            setup: () => () => h(KeepAlive, () => shown.value ? h(ChatContainer, defaultProps) : h('div')),
        }), {
            attachTo: document.body,
            global: { ...options.global, stubs: { ...options.global.stubs, Teleport: false } },
        });
        try {
            await vi.waitFor(() => expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(1));
            document.querySelector<HTMLButtonElement>('[data-test="welcome-preview"]')!.click();
            await nextTick();
            expect(save).toHaveBeenCalledWith('or3_welcome_card_dismissed', 'true');
            shown.value = false; await nextTick(); shown.value = true;
            await nextTick(); await flushPromises();
            expect(document.querySelectorAll('[data-welcome-backdrop]')).toHaveLength(0);
        } finally {
            release(); await write;
            wrapper.unmount(); save.mockRestore(); config.mockRestore(); setActiveWorkspaceDb(previous);
            evictWorkspaceDb(id); await db.delete(); setHookEngine(previousHooks);
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

    it('renders scroll to bottom button when scrolled up with null background job refs', async () => {
        useChatMock.mockImplementationOnce(() => makeChatInstance({
            backgroundJobId: null, backgroundJobMode: null,
        }));
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            attachTo: document.body,
            global: {
                config: { globalProperties: { $theme: createThemeMock() } },
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

        // Measured DOM height can briefly lead the virtual height during a
        // growing response. Honor the scroller's bottom state instead of flashing.
        scroller.vm.$emit('scroll', {
            scrollTop: 994,
            scrollHeight: 1800,
            clientHeight: 800,
            isAtBottom: true,
        });
        await nextTick();
        buttonContainer = wrapper.find('.absolute.bottom-full');
        expect((buttonContainer.element as HTMLElement).style.display).toBe('none');
        expect((buttonContainer.element as HTMLElement).style.opacity).toBe('0');

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

    it('requests smooth bottom navigation when the button is clicked', async () => {
        const wrapper = mountChatInstance(makeChatInstance());
        await nextTick();
        const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
        const exposed = scroller.vm.$.exposed as {
            scrollToBottom: (options?: { smooth?: boolean }) => void;
        };
        const scroll = vi.spyOn(exposed, 'scrollToBottom');
        try {
            scroller.vm.$emit('scroll', {
                scrollTop: 500,
                scrollHeight: 1800,
                clientHeight: 800,
                isAtBottom: false,
            });
            await nextTick();
            scroll.mockClear();

            await wrapper.findComponent({ name: 'UButton' }).trigger('click');

            expect(scroll).toHaveBeenCalledExactlyOnceWith({ smooth: true });
        } finally {
            scroll.mockRestore();
        }
    });

    it('ensures history is synced on mount and thread switch', async () => {
        const wrapper = mount(ChatContainer, {
            props: defaultProps,
            global: {
                config: { globalProperties: { $theme: createThemeMock() } },
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
            const wrapper = mountChatInstance(instance, {}, AsyncThemeMessage);
            await nextTick();
            await flushPromises();
            messageUpdates.mockClear();
            lazyBoundaryUpdates.mockClear();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            const itemsBefore = toRaw(scroller.props('items') as unknown[]);
            const rowElement = rowFor(wrapper, 'tail-1').element;

            for (const text of ['Hel', 'Hello', 'Hello world']) {
                // Intake updates the persistence snapshot before the display
                // accumulator publishes its batched frame. Render each text once.
                instance.tailAssistant.value!.text = text;
                await nextTick();
                await nextTick();
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
            expect(messageUpdates.mock.calls.map(([id]) => id)).toEqual([
                'tail-1', 'tail-1', 'tail-1',
            ]);
            expect(lazyBoundaryUpdates.mock.calls.map(([id]) => id)).toEqual([
                'tail-1', 'tail-1', 'tail-1',
            ]);

            // Stable rows must still react to edits and action availability.
            instance.messages.value[1]!.text = 'Edited answer';
            await nextTick();
            expect(rowFor(wrapper, 'stable-2').find('.test-text').text()).toBe('Edited answer');
            instance.loading.value = true;
            await nextTick();
            expect(wrapper.findAllComponents(LazyChatMessage).every((row) => row.props('retryDisabled'))).toBe(true);
            expect(rowFor(wrapper, 'stable-2').find('.test-compaction').text()).toBe('Wait for the reply to finish.');
            const rendered = wrapper.findAllComponents(LazyChatMessage).find(row => row.props('message').id === 'stable-2')!;
            rendered.vm.$emit('begin-edit', 'stable-2');
            await nextTick();
            expect(scroller.props('maintainBottom')).toBe(false);
            rendered.vm.$emit('save-edit', 'stable-2');
            await nextTick();
            expect(scroller.props('maintainBottom')).toBe(true);
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

            const toolCalls = reactive([
                { name: 'search', status: 'loading' },
            ]);
            instance.tailAssistant.value!.toolCalls = toolCalls;
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

            // Reusing a projection must preserve its nested reactive metadata,
            // and removing metadata must not retain the prior snapshot's field.
            toolCalls[0]!.status = 'complete';
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-tools').text()).toBe('search:complete');
            delete instance.tailAssistant.value!.toolCalls;
            await nextTick();
            await nextTick();
            expect(rowFor(wrapper, 'tail-1').find('.test-tools').text()).toBe('');

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

        it('resets rendered rows when the tab shows another conversation', async () => {
            const instance = makeStreamingInstance();
            const wrapper = mountChatInstance(instance, { tabId: 'tab-a' });
            await nextTick();

            const scroller = wrapper.findComponent({ name: 'Or3Scroll' });
            expect(scroller.props('contentKey')).toBe('tab-a');

            // Activation rebinds the pane before the incoming history loads;
            // the outgoing rows must not be reset and rendered again meanwhile.
            await wrapper.setProps({ tabId: 'tab-b' });
            expect(scroller.props('contentKey')).toBe('tab-a');
            expect(rowFor(wrapper, 'stable-1').exists()).toBe(true);

            instance.messages.value = [
                { id: 'thread2-1', role: 'user', text: 'Second thread' },
            ];
            instance.tailAssistant.value = null;
            await wrapper.setProps({ threadId: 'thread-2' });
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
