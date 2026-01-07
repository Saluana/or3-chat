
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ChatInputDropper from '../ChatInputDropper.vue';
import { ref } from 'vue';

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
        useDropZone: (target: any, options: any) => {
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
    useUserApiKey: () => ({ apiKey: ref('test-key') }),
    useOpenRouterAuth: () => ({ startLogin: vi.fn() }),
    useComposerActions: () => [],
    useModelStore: () => ({ 
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

vi.mock('../file-upload-utils', () => ({
    validateFile: () => ({ ok: true, kind: 'image' }),
    persistAttachment: vi.fn().mockResolvedValue({ hash: 'test-hash' })
}));

describe('ChatInputDropper', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFiles.value = null;
        mockIsOverDropZone.value = false;
    });

    it('triggers file dialog on button click', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: {
                loading: false,
                threadId: 'test-thread',
            },
            global: {
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
        
        await (wrapper.vm as any).triggerFileInput();
        expect(mockOpen).toHaveBeenCalled();
    });

    it('processes files when file dialog selection changes', async () => {
        const wrapper = mount(ChatInputDropper, {
            props: { loading: false }
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
            props: { loading: false }
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
            props: { loading: false }
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
});
