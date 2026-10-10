
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

const cloudIntake = vi.hoisted(() => ({ enabled: false, session: null as null | { authenticated: boolean; user: { id: string }; workspace: { id: string }; role: string; authorizationRevision: string; expiresAt: string }, refresh: vi.fn() }));
// Mock other dependencies
vi.mock('#imports', () => ({
    useToast: () => ({ add: vi.fn() }),
    useRuntimeConfig: () => ({
        public: {
            ssrAuthEnabled: cloudIntake.enabled,
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

// SSR auth is off in these tests, so the sign-in gate never needs a session.
// Keep the module's other exports: workspace file access reads the cached session.
vi.mock('~/composables/auth/useSessionContext', async (importOriginal) => ({
    ...(await importOriginal<typeof import('~/composables/auth/useSessionContext')>()),
    useSessionContext: () => ({ data: ref(null) }),
    getCachedSessionContext: () => cloudIntake.session,
    getCachedSessionPayload: () => cloudIntake.session ? { session: cloudIntake.session, appAccessAllowed: true, workspaceItemCapability: 'v1' } : null,
    refreshCachedSessionContext: () => cloudIntake.refresh(),
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
const beforeSendAction = vi.hoisted(() => ({ apply: undefined as undefined | (() => Promise<void>) }));
vi.mock('~/core/hooks/useHooks', () => ({
    useHooks: () => ({
        doAction: vi.fn(async (name: string) => { if (name === 'ui.chat.editor:action:before_send') await beforeSendAction.apply?.(); }),
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
    // A file picker can outlive the access token. Renew cached authorization,
    // but never admit bytes after sign-out, a viewer downgrade or a workspace move.
    it.each(['renew', 'sign-out', 'viewer', 'workspace'] as const)('handles expired cloud attachment authorization after %s recovery', async transition => {
        const workspace = `expired-intake-${crypto.randomUUID()}`;
        const other = `expired-destination-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(workspace); await db.open();
        cloudIntake.enabled = true;
        cloudIntake.session = { authenticated: true, user: { id: 'qa-owner' }, workspace: { id: workspace },
            role: 'owner', authorizationRevision: 'qa-1', expiresAt: new Date(Date.now() - 1000).toISOString() };
        cloudIntake.refresh.mockImplementation(async () => {
            if (transition === 'sign-out') cloudIntake.session = null;
            else {
                cloudIntake.session = { ...cloudIntake.session!, expiresAt: new Date(Date.now() + 60000).toISOString(),
                    role: transition === 'viewer' ? 'viewer' : 'owner' };
                if (transition === 'workspace') setActiveWorkspaceDb(other);
            }
        });
        const actual = await vi.importActual<typeof import('../file-upload-utils')>('../file-upload-utils');
        const att = { file: new NativeFile(['%PDF-1.4 disposable'], 'expired.pdf', { type: 'application/pdf' }) as unknown as File,
            name: 'expired.pdf', status: 'pending' as 'pending' | 'ready' | 'error', kind: 'pdf' };
        try {
            await actual.persistAttachment(att);
            expect(att.status).toBe(transition === 'renew' ? 'ready' : 'error');
            expect(await db.file_meta.count()).toBe(transition === 'renew' ? 1 : 0);
            expect(await db.posts.count()).toBe(transition === 'renew' ? 1 : 0);
            if (transition === 'workspace') expect(await getDb().file_meta.count()).toBe(0);
        } finally {
            cloudIntake.enabled = false; cloudIntake.session = null;
            setActiveWorkspaceDb(null);
            for (const id of [workspace, other]) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); }
        }
    });
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
        cloudIntake.enabled = false;
        cloudIntake.session = null;
        attachmentFilter.apply = undefined;
        beforeSendAction.apply = undefined;
        vi.mocked(persistAttachment).mockResolvedValue(undefined);
        mockFiles.value = null;
        mockIsOverDropZone.value = false;
        mockEnsureAiSettingsLoaded.mockResolvedValue(undefined);
        useWorkspaceTabDrafts().clear();
    });

    it.each(['tab', 'workspace'] as const)('does not submit into another owner after a held before-send hook and %s transition', async transition => {
        const client = process.client; process.client = true;
        const entered = deferred<void>(); const gate = deferred<void>();
        beforeSendAction.apply = async () => { entered.resolve(); await gate.promise; };
        const wrapper = mount(ChatInputDropper, { props: { loading: false, tabId: 'source-tab', threadId: 'source' },
            attrs: { onSend: (payload: { registerResult: (result: Promise<SendResult>) => void }) => payload.registerResult(Promise.resolve({ status: 'rejected', reason: 'busy' })) },
            global: { mocks: { $theme: createThemeMock() } } });
        try {
            await flushPromises();
            const vm = wrapper.vm as unknown as { setText: (text: string) => void; triggerSend: () => Promise<SendResult> };
            vm.setText('Source-only draft');
            const send = vm.triggerSend(); await entered.promise;
            if (transition === 'tab') await wrapper.setProps({ tabId: 'destination-tab', threadId: 'destination' });
            else if (transition === 'workspace') setActiveWorkspaceDb(`composer-destination-${crypto.randomUUID()}`);
            gate.resolve(); await send;
            expect(wrapper.emitted('send')).toBeUndefined();
        } finally { gate.resolve(); wrapper.unmount(); setActiveWorkspaceDb(null); process.client = client; }
    });
    it('submits the clicked draft while preserving edits made during a held before-send hook', async () => {
        const client = process.client; process.client = true;
        const entered = deferred<void>(); const gate = deferred<void>();
        beforeSendAction.apply = async () => { entered.resolve(); await gate.promise; };
        const wrapper = mount(ChatInputDropper, { props: { loading: false, threadId: 'source' },
            attrs: { onSend: (payload: { registerResult: (result: Promise<SendResult>) => void }) => payload.registerResult(Promise.resolve({ status: 'accepted', requestId: 'clicked', userMessageId: 'clicked' })) },
            global: { mocks: { $theme: createThemeMock() } } });
        try {
            await flushPromises();
            const vm = wrapper.vm as unknown as { setText: (text: string) => void; triggerSend: () => Promise<SendResult> };
            vm.setText('Clicked draft'); const send = vm.triggerSend(); await entered.promise;
            vm.setText('Next unsent draft'); gate.resolve(); await send;
            expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ text: 'Clicked draft' });
            beforeSendAction.apply = undefined;
            await vm.triggerSend();
            expect(wrapper.emitted('send')?.[1]?.[0]).toMatchObject({ text: 'Next unsent draft' });
        } finally { gate.resolve(); wrapper.unmount(); process.client = client; }
    });

    // Real composer restoration must not turn a cached inherited choice into
    // durable user intent or replace a choice already saved for this chat.
    it.each(['inherited', 'explicit'] as const)('restores text without replacing the %s chat model from a stale tab draft', async (choice) => {
        vi.stubGlobal('process', { ...process, client: true });
        localStorage.clear();
        const workspace = `model-draft-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(workspace); await db.open();
        const { createThreadInDb } = await import('~/db/threads');
        const { saveProjectSettings } = await import('~/db/project-workspace');
        const { captureProjectOperation } = await import('~/utils/projects/context');
        const { defaultProjectSettings } = await import('~~/shared/projects/workspace');
        const { setKvByName } = await import('~/db/kv');
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0, created_at: 1, updated_at: 1, deleted: false });
        await saveProjectSettings(captureProjectOperation(), 'project',
            { ...defaultProjectSettings(), default_model: 'fixture/current-default' }, null);
        const thread = await createThreadInDb(db, { title: 'Draft', project_id: 'project' });
        if (choice === 'explicit') await setKvByName('chat-model:' + thread.id,
            JSON.stringify({ model: 'fixture/explicit', variant: 'nitro' }), db);
        useWorkspaceTabDrafts().write('model-tab', { version: 1, text: 'Keep this draft', attachments: [], largeTextBlocks: [],
            composer: { model: 'fixture/stale-default', modelVariant: 'online', thinkingEnabled: false,
                imageSettings: { quality: 'medium', numResults: 1, size: '1024x1024' } }, updatedAt: Date.now() });
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, tabId: 'model-tab', threadId: thread.id },
            attrs: { onSend: (payload: { registerResult: (result: Promise<SendResult>) => void }) => {
                payload.registerResult(Promise.resolve({ status: 'rejected', reason: 'unavailable' }));
            } },
            global: { mocks: { $theme: createThemeMock() } },
        });
        try {
            await vi.waitFor(() => expect(wrapper.emitted('model-change')?.at(-1)?.[0])
                .toBe(choice === 'explicit' ? 'fixture/explicit:nitro' : 'fixture/current-default'));
            await (wrapper.vm as unknown as { triggerSend: () => Promise<SendResult> }).triggerSend();
            expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ text: 'Keep this draft',
                model: choice === 'explicit' ? 'fixture/explicit' : 'fixture/current-default',
                modelVariant: choice === 'explicit' ? 'nitro' : 'off' });
            const preference = await db.kv.where('name').equals('chat-model:' + thread.id).first();
            expect(preference?.value).toBe(choice === 'explicit' ? JSON.stringify({ model: 'fixture/explicit', variant: 'nitro' }) : undefined);
        } finally {
            wrapper.unmount(); await flushPromises(); vi.unstubAllGlobals();
            setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name);
        }
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

    it('keeps the destination unsent tab variant when an earlier settings restoration finishes', async () => {
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
            await wrapper.setProps({ tabId: 'child-tab', threadId: undefined });
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

    it('keeps text typed while an older send was being prepared, even if it is retyped to the submitted text', async () => {
        const accepted = deferred<SendResult>();
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, threadId: 'test-thread', tabId: 'revision-tab' },
            attrs: { onSend: (payload: { registerResult: (terminal: Promise<SendResult>, acceptance: Promise<SendResult>) => void }) => {
                payload.registerResult(Promise.resolve({ status: 'accepted', requestId: 'old', userMessageId: 'old' }), accepted.promise);
            } },
            global: { mocks: { $theme: createThemeMock() } },
        });
        const vm = wrapper.vm as unknown as { setText: (text: string) => void; triggerSend: () => Promise<SendResult> };
        try {
            await flushPromises();
            vm.setText('Same words');
            const send = vm.triggerSend();
            await vi.waitFor(() => expect(wrapper.emitted('send')).toHaveLength(1));
            // The user keeps writing while the first request is still being admitted,
            // and ends up with text identical to what was submitted.
            vm.setText('Same words, and more');
            vm.setText('Same words');
            accepted.resolve({ status: 'accepted', requestId: 'old', userMessageId: 'old' });
            await send;
            await flushPromises();

            await vm.triggerSend();
            expect(wrapper.emitted('send')).toHaveLength(2);
            expect(wrapper.emitted('send')?.[1]?.[0]).toMatchObject({ text: 'Same words' });
        } finally {
            accepted.resolve({ status: 'accepted', requestId: 'old', userMessageId: 'old' });
            wrapper.unmount();
        }
    });

    it('keeps text typed while a saved draft is still loading instead of replacing it', async () => {
        const client = process.client; process.client = true;
        const blobRead = deferred<undefined>();
        const reading = vi.spyOn(getDb().file_blobs, 'get').mockImplementation(() => blobRead.promise as never);
        // A saved attachment forces the asynchronous load path, which we hold open.
        useWorkspaceTabDrafts().write('loading-tab', {
            version: 1, text: 'saved text', attachments: [], largeTextBlocks: [], updatedAt: Date.now(),
            attachmentRefs: [{ hash: 'held-blob', name: 'held.png', mime: 'image/png', kind: 'image' }],
        });
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, threadId: 'test-thread', tabId: 'loading-tab' },
            attrs: { onSend: (payload: { registerResult: (result: Promise<SendResult>) => void }) => payload.registerResult(Promise.resolve({ status: 'rejected', reason: 'unavailable' })) },
            global: { mocks: { $theme: createThemeMock() } },
        });
        const vm = wrapper.vm as unknown as { setText: (text: string) => void; triggerSend: () => Promise<SendResult> };
        try {
            await vi.waitFor(() => expect(reading).toHaveBeenCalled());
            vm.setText('typed while loading');
            blobRead.resolve(undefined);
            await flushPromises();

            await vm.triggerSend();
            expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ text: 'typed while loading' });
            // What the user typed, not the older saved text, is what gets saved.
            await vi.waitFor(() => expect(useWorkspaceTabDrafts().read('loading-tab')?.text).toBe('typed while loading'));
        } finally {
            blobRead.resolve(undefined);
            reading.mockRestore();
            wrapper.unmount();
            useWorkspaceTabDrafts().discard('loading-tab');
            process.client = client;
        }
    });

    it('saves the composer immediately when the page is hidden, without waiting for the capture debounce', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, threadId: 'test-thread', tabId: 'hide-tab' },
            global: { mocks: { $theme: createThemeMock() } },
        });
        const vm = wrapper.vm as unknown as { setText: (text: string) => void };
        try {
            await flushPromises();
            vm.setText('typed just before reload');
            // No debounce has fired yet, exactly as when a reload follows a keystroke.
            window.dispatchEvent(new Event('pagehide'));
            expect(useWorkspaceTabDrafts().read('hide-tab')?.text).toBe('typed just before reload');
            await vi.waitFor(async () => expect((await getDb().workspace_tab_drafts.toArray())
                .some((row) => row.tab_id === 'hide-tab' && row.draft.text === 'typed just before reload')).toBe(true));
        } finally {
            wrapper.unmount();
            useWorkspaceTabDrafts().discard('hide-tab');
        }
    });

    it('tells the user when a draft cannot be saved, keeps retrying, and clears the notice once it is', async () => {
        const client = process.client; process.client = true;
        const imports = await import('#imports');
        const add = vi.fn(); const remove = vi.fn();
        vi.spyOn(imports, 'useToast').mockReturnValue({ add, remove } as never);
        const failing = vi.spyOn(getDb().workspace_tab_drafts, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false, threadId: 'test-thread', tabId: 'quota-tab' },
            global: { mocks: { $theme: createThemeMock() } },
        });
        const vm = wrapper.vm as unknown as { setText: (text: string) => void };
        const drafts = useWorkspaceTabDrafts();
        try {
            await flushPromises();
            vm.setText('cannot be stored yet');
            await vi.waitFor(() => expect(drafts.read('quota-tab')?.text).toBe('cannot be stored yet'));
            await drafts.flush();
            await vi.waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-save-failed' })));

            failing.mockRestore();
            await drafts.flush();
            await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('draft-save-failed'));
            expect((await getDb().workspace_tab_drafts.toArray()).some((row) => row.tab_id === 'quota-tab')).toBe(true);
        } finally {
            failing.mockRestore();
            wrapper.unmount();
            drafts.discard('quota-tab');
            await drafts.flush();
            vi.restoreAllMocks();
            process.client = client;
        }
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
