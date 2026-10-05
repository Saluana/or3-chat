
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Dexie from 'dexie';
import { File as NativeFile } from 'node:buffer';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { persistAttachment } from '../file-upload-utils';
import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
enableAutoUnmount(afterEach);
import ChatInputDropper from '../ChatInputDropper.vue';
import { ref } from 'vue';
import type { SendResult } from '~/utils/chat/types';
import { useWorkspaceTabDrafts } from '~/composables/core/useWorkspaceTabDrafts';

const mockEnsureAiSettingsLoaded = vi.fn().mockResolvedValue(undefined);
vi.mock('~/composables/chat/useAiSettings', () => ({
    useAiSettings: () => ({ settings: ref({ defaultModelVariant: 'off' }), ensureLoaded: mockEnsureAiSettingsLoaded }),
}));

// Mock VueUse core
const mockOpen = vi.fn();
const mockReset = vi.fn();
const mockFiles = ref<FileList | null>(null);

const mockIsOverDropZone = ref(false);
const mockDropZoneCallbacks = {
    onDrop: (files: File[] | null) => {},
    onEnter: () => {},
    onLeave: () => {}
};

vi.mock('@vueuse/core', async () => {
    const actual = await vi.importActual('@vueuse/core');
    return {
        ...actual,
        useFileDialog: () => ({
            open: mockOpen,
            reset: mockReset,
            files: mockFiles,
        }),
        useDropZone: (_target: unknown, options?: typeof mockDropZoneCallbacks) => {
            if (options) {
                mockDropZoneCallbacks.onDrop = options.onDrop;
                mockDropZoneCallbacks.onEnter = options.onEnter;
                mockDropZoneCallbacks.onLeave = options.onLeave;
            }
            return {
                isOverDropZone: mockIsOverDropZone
            };
        },
        useDebounceFn: (fn: Function) => fn, // Mock debounce for other parts if needed
    };
});

// Mock other dependencies
vi.mock('#imports', () => ({
    useToast: () => ({ add: vi.fn() }),
    useRuntimeConfig: () => ({
        public: {
            openRouter: {},
            limits: {},
        },
    }),
    useUserApiKey: () => ({ apiKey: ref('test-key') }),
    useOpenRouterAuth: () => ({ startLogin: vi.fn() }),
    useComposerActions: () => ref([]),
    useModelStore: () => ({ 
        catalog: ref([]),
        favoriteModels: ref([]),
        getFavoriteModels: vi.fn().mockResolvedValue([])
    }),
    useAiSettings: () => ({ settings: ref({}) }),
    useIcon: (name: string) => ref(name),
}));

vi.mock('~/composables/useThemeResolver', () => ({
    useThemeOverrides: () => ref({})
}));

vi.mock('~/composables/useIcon', () => ({
    useIcon: (name: string) => ref(name)
}));

vi.mock('#app', () => ({
    useNuxtApp: () => ({
        $iconRegistry: { getIcon: () => 'icon-name' }
    })
}));

vi.mock('~/utils/errors', () => ({
    reportError: vi.fn(),
    err: vi.fn()
}));

const attachmentFilter = vi.hoisted(() => ({ apply: undefined as undefined | ((value: unknown) => Promise<unknown>) }));
vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: vi.fn().mockResolvedValue(undefined),
        applyFilters: vi.fn(async (name: string, value: unknown) => name === 'files.attach:filter:input' && attachmentFilter.apply ? attachmentFilter.apply(value) : value),
    }),
}));

vi.mock('../file-upload-utils', () => ({
    validateFile: () => ({ ok: true, kind: 'image' }),
    persistAttachment: vi.fn().mockResolvedValue({ hash: 'test-hash' })
}));

const ThemedModelCatalogModal = {
    template: '<div class="themed-model-catalog-modal" />',
};
const ThemedSystemPromptsModal = {
    template: '<div class="themed-system-prompts-modal" />',
};
const ThemedModelSelect = {
    template: '<div class="themed-model-select" />',
};

const createThemeMock = () => ({
    activeComponents: {
        value: {
            'model-catalog-modal': ThemedModelCatalogModal,
            'system-prompts-modal': ThemedSystemPromptsModal,
            'model-selector': ThemedModelSelect,
        },
    },
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('ChatInputDropper', () => {
    it.each(['workspace', 'unmount', 'draft-discard', 'tab'] as const)('stops selected-file intake on %s while the first filter is pending', async (transition) => {
        const workspace = `attachment-source-${crypto.randomUUID()}`;
        const other = `attachment-destination-${crypto.randomUUID()}`;
        const source = setActiveWorkspaceDb(workspace); await source.open();
        const actual = await vi.importActual<typeof import('../file-upload-utils')>('../file-upload-utils');
        const persisted = deferred<void>();
        vi.mocked(persistAttachment).mockImplementation(async (...args) => {
            await actual.persistAttachment(...args); persisted.resolve();
        });
        const entered = deferred<void>(); const gate = deferred<void>();
        attachmentFilter.apply = async value => { entered.resolve(); await gate.promise; return value; };
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned-preview');
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, ...(transition === 'draft-discard' || transition === 'tab' ? { tabId: 'source-tab' } : {}) },
            global: { mocks: { $theme: createThemeMock() } },
        });
        try {
            await wrapper.vm.$nextTick();
            const files = [new NativeFile(['%PDF-1.4 first'], 'first.pdf', { type: 'application/pdf' }),
                new NativeFile(['%PDF-1.4 second'], 'second.pdf', { type: 'application/pdf' })];
            mockFiles.value = files as unknown as FileList;
            await entered.promise;
            expect(create).toHaveBeenCalledTimes(1);
            expect(wrapper.emitted('image-add')).toHaveLength(1);
            if (transition === 'workspace') setActiveWorkspaceDb(other);
            else if (transition === 'tab') await wrapper.setProps({ tabId: 'destination-tab' });
            else {
                wrapper.unmount();
                if (transition === 'draft-discard') {
                    expect(useWorkspaceTabDrafts().read('source-tab')?.attachments).toHaveLength(1);
                    useWorkspaceTabDrafts().discard('source-tab');
                }
            }
            gate.resolve(); await persisted.promise; await flushPromises();
            expect(create).toHaveBeenCalledTimes(1);
            expect(persistAttachment).toHaveBeenCalledTimes(1);
            expect(await getDb().file_meta.count()).toBe(0);
            expect(await getDb().posts.count()).toBe(0);
            if (transition === 'unmount' || transition === 'draft-discard') expect(revoke).toHaveBeenCalledWith('blob:owned-preview');
        } finally {
            gate.resolve(); wrapper.unmount(); await flushPromises();
            create.mockRestore(); revoke.mockRestore();
            setActiveWorkspaceDb(null);
            for (const id of [workspace, other]) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
        }
    });
    beforeEach(() => {
        vi.clearAllMocks();
        attachmentFilter.apply = undefined;
        vi.mocked(persistAttachment).mockResolvedValue(undefined);
        mockFiles.value = null;
        mockIsOverDropZone.value = false;
        mockEnsureAiSettingsLoaded.mockResolvedValue(undefined);
        useWorkspaceTabDrafts().clear();
    });

    it('captures a fresh source draft when tab navigation overlaps asynchronous composer settings restoration', async () => {
        const settings = deferred<void>();
        mockEnsureAiSettingsLoaded.mockReturnValue(settings.promise);
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, threadId: 'source' },
            attrs: { onSend: (payload: { registerResult: (result: Promise<SendResult>) => void }) => {
                payload.registerResult(Promise.resolve({ status: 'rejected', reason: 'unavailable' }));
            } },
            global: { mocks: { $theme: createThemeMock() } },
        });
        try {
            await wrapper.setProps({ tabId: 'source-tab' });
            expect(mockEnsureAiSettingsLoaded).toHaveBeenCalled();
            (wrapper.vm as unknown as { setText: (text: string) => void }).setText('Fresh source draft');
            await wrapper.setProps({ tabId: 'child-tab', threadId: 'child' });
            expect(useWorkspaceTabDrafts().read('source-tab')?.text).toBe('Fresh source draft');
            settings.resolve();
            await wrapper.setProps({ tabId: 'source-tab', threadId: 'source' });
            await wrapper.vm.$nextTick();
            await (wrapper.vm as unknown as { triggerSend: () => Promise<SendResult> }).triggerSend();
            expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ text: 'Fresh source draft' });
        } finally {
            settings.resolve();
            wrapper.unmount();
        }
    });

    it('keeps the destination tab variant when an earlier settings restoration finishes', async () => {
        const settings = deferred<void>();
        mockEnsureAiSettingsLoaded.mockReturnValue(settings.promise);
        useWorkspaceTabDrafts().write('child-tab', {
            version: 1,
            text: 'Child draft',
            attachments: [],
            largeTextBlocks: [],
            composer: {
                model: 'scripted',
                modelVariant: 'nitro',
                thinkingEnabled: false,
                imageSettings: { quality: 'medium', numResults: 1, size: '1024x1024' },
            },
            updatedAt: Date.now(),
        });
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, threadId: 'source' },
            attrs: { onSend: (payload: { registerResult: (result: Promise<SendResult>) => void }) => {
                payload.registerResult(Promise.resolve({ status: 'rejected', reason: 'unavailable' }));
            } },
            global: { mocks: { $theme: createThemeMock() } },
        });
        try {
            await wrapper.setProps({ tabId: 'source-tab' });
            expect(mockEnsureAiSettingsLoaded).toHaveBeenCalled();
            await wrapper.setProps({ tabId: 'child-tab', threadId: 'child' });
            settings.resolve();
            await settings.promise;
            await wrapper.vm.$nextTick();
            await (wrapper.vm as unknown as { triggerSend: () => Promise<SendResult> }).triggerSend();
            expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({
                text: 'Child draft',
                modelVariant: 'nitro',
            });
        } finally {
            settings.resolve();
            wrapper.unmount();
        }
    });

    it('triggers file dialog on button click', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: {
                loading: false,
                threadId: 'test-thread',
            },
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
                stubs: {
                    EditorContent: true,
                    UIcon: true,
                    UButton: {
                        template: '<button @click="$emit(\'click\')"><slot/></button>',
                        props: ['disabled', 'loading']
                    },
                    UPopover: true,
                    UTooltip: {
                        template: '<div><slot/></div>'
                    },
                    LazyChatModelSelect: true,
                    LazyModalModelCatalog: true,
                    LazyChatSystemPromptsModal: true,
                }
            }
        });

        // Find the attachment button (it calls triggerFileInput)
        // Usually the first button in the left controls
        const buttons = wrapper.findAllComponents({ name: 'UButton' });
        // The attachment button is typically one of the first ones. 
        // Based on template, it has iconAttach. 
        // We can call the method directly to test the composable integration logic first.
        
        await (wrapper.vm as unknown as { triggerFileInput: () => void }).triggerFileInput();
        expect(mockOpen).toHaveBeenCalled();
    });

    it('processes files when file dialog selection changes', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false },
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
            },
        });

        const file = new File(['test'], 'test.png', { type: 'image/png' });
        const fileList = {
            0: file,
            length: 1,
            item: (index: number) => file
        } as unknown as FileList;

        mockFiles.value = fileList;
        // Wait for watcher
        await wrapper.vm.$nextTick();

        // Check if file was added to attachments
        // accessible via wrapper.vm.uploadedImages or checking emitted events if any
        // The component emits 'image-add'
        const emitted = wrapper.emitted('image-add');
        expect(emitted).toBeTruthy();
        expect(emitted![0]![0]).toMatchObject({
            name: 'test.png',
            status: 'pending'
        });
        
        expect(mockReset).toHaveBeenCalled();
    });

    it('handles drop events via useDropZone', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false },
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
            },
        });

        const file = new File(['drop'], 'drop.png', { type: 'image/png' });

        // Simulate drop via the mock callback captured from useDropZone
        mockDropZoneCallbacks.onDrop([file]);
        
        await wrapper.vm.$nextTick();
        
        const emitted = wrapper.emitted('image-add');
        expect(emitted).toBeTruthy();
        expect(emitted![0]![0]).toMatchObject({
            name: 'drop.png'
        });
    });

    it('updates isDragging state on enter/leave', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false },
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
            },
        });

        mockIsOverDropZone.value = true;
        // The component watches isOverDropZone
        await wrapper.vm.$nextTick();
        
        // We can check if isDragging ref is true. 
        // Since isDragging isn't exposed directly, we can check the class on root element
        // or check internal state if we exposed it or imply it.
        // The root div has class 'border-blue-500' when isDragging is true
        
        const root = wrapper.find('#chat-input-main');
        expect(root.classes()).toContain('border-blue-500');

        mockIsOverDropZone.value = false;
        await wrapper.vm.$nextTick();
        expect(root.classes()).not.toContain('border-blue-500');
    });

    it('clears the draft after durable acceptance without waiting for the stream', async () => {
        const terminal = deferred<SendResult>();
        const accepted = deferred<SendResult>();
        let sentText = '';
        const wrapper = mount(ChatInputDropper, {
            props: {
                loading: false,
                threadId: 'test-thread',
            },
            attrs: {
                onSend: (payload: {
                    text: string;
                    registerResult: (
                        terminalResult: Promise<SendResult>,
                        durableAcceptance: Promise<SendResult>
                    ) => void;
                }) => {
                    sentText = payload.text;
                    payload.registerResult(terminal.promise, accepted.promise);
                },
            },
            global: {
                mocks: {
                    $theme: createThemeMock(),
                },
            },
        });
        const vm = wrapper.vm as unknown as {
            setText: (text: string) => void;
            triggerSend: () => Promise<SendResult>;
        };
        vm.setText('Bro');

        let terminalSettled = false;
        const send = vm.triggerSend().then((result) => {
            terminalSettled = true;
            return result;
        });
        await vi.waitFor(() => {
            expect(wrapper.emitted('send')).toHaveLength(1);
        });
        expect(sentText).toBe('Bro');

        accepted.resolve({
            status: 'accepted',
            requestId: 'request-1',
            userMessageId: 'user-1',
        });
        await Promise.resolve();
        await wrapper.vm.$nextTick();
        await expect(vm.triggerSend()).resolves.toMatchObject({
            status: 'rejected',
            reason: 'filtered',
        });
        expect(wrapper.emitted('send')).toHaveLength(1);
        expect(terminalSettled).toBe(false);

        terminal.resolve({
            status: 'complete',
            requestId: 'request-1',
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
        });
        await expect(send).resolves.toMatchObject({ status: 'complete' });
        wrapper.unmount();
    });
});
