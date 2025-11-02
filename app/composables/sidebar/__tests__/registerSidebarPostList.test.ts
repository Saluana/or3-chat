import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computed, ref, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const usePostsListModulePath = vi.hoisted(
    () => new URL('../../posts/usePostsList.ts', import.meta.url).pathname
);

vi.mock(usePostsListModulePath, () => ({
    usePostsList: () => ({
        items: computed(() => [
            {
                id: 'post-1',
                title: 'Post 1',
                postType: 'test-type',
                content: '',
                created_at: 0,
                updated_at: 10,
                deleted: false,
                meta: null,
                file_hashes: null,
            },
        ]),
        loading: computed(() => false),
        error: computed(() => null),
        refresh: vi.fn(),
    }),
}));

// Stubs for global components referenced via resolveComponent
const UIconStub = defineComponent({
    name: 'UIconStub',
    setup() {
        return () => h('span');
    },
});

const RetroGlassBtnStub = defineComponent({
    name: 'RetroGlassBtnStub',
    emits: ['click'],
    setup(_, { slots, emit }) {
        return () =>
            h(
                'button',
                {
                    type: 'button',
                    onClick: () => emit('click'),
                },
                slots.default ? slots.default() : []
            );
    },
});
import { registerSidebarPostList } from '../registerSidebarPostList';

describe('registerSidebarPostList', () => {
    beforeEach(() => {
        (process as any).client = true;
        const registry = (globalThis as any).__or3SidebarSectionsRegistry as
            | Map<string, unknown>
            | undefined;
        if (registry?.clear) {
            registry.clear();
        } else {
            (globalThis as any).__or3SidebarSectionsRegistry = new Map();
        }

        (globalThis as any).resolveComponent = (name: string) => {
            if (name === 'UIcon') return UIconStub;
            if (name === 'RetroGlassBtn') return RetroGlassBtnStub;
            return defineComponent({
                name: `${name}Stub`,
                setup: () => () => h('span'),
            });
        };
    });

    afterEach(() => {
        delete (globalThis as any).__or3MultiPaneApi;
        delete (globalThis as any).resolveComponent;
    });

    function getRegisteredComponent(id: string) {
        const registry = (globalThis as any)
            .__or3SidebarSectionsRegistry as Map<string, { component: any }>;
        const entry = registry?.get(id);
        if (!entry) {
            throw new Error(`Sidebar section ${id} not registered`);
        }
        return entry.component;
    }

    function mountRegisteredComponent(id: string) {
        const component = getRegisteredComponent(id);
        return mount(component, {
            global: {
                components: {
                    UIcon: UIconStub,
                    RetroGlassBtn: RetroGlassBtnStub,
                },
            },
        });
    }

    const basePost = {
        id: 'post-1',
        title: 'Post 1',
        postType: 'test-type',
        content: '',
        created_at: 0,
        updated_at: 10,
        deleted: false,
        meta: null,
        file_hashes: null,
    };

    it('reuses existing pane by calling setActive', async () => {
        const setActive = vi.fn();
        const newPaneForApp = vi.fn();
        const panes = ref([
            { id: 'pane-1', mode: 'test-app', documentId: 'post-1' },
        ]);

        (globalThis as any).__or3MultiPaneApi = {
            panes,
            activePaneIndex: ref(0),
            setActive,
            newPaneForApp,
        };

        registerSidebarPostList({
            id: 'test-list',
            label: 'Test',
            appId: 'test-app',
            postType: 'test-type',
            reusePane: true,
        });

        const wrapper = mountRegisteredComponent('test-list');

        const vm = wrapper.vm as unknown as {
            handleItemClick: (post: typeof basePost) => Promise<void>;
        };

        await vm.handleItemClick(basePost);

        expect(setActive).toHaveBeenCalledWith(0);
        expect(newPaneForApp).not.toHaveBeenCalled();
    });

    it('opens new pane with initialRecordId when reuse not possible', async () => {
        const setActive = vi.fn();
        const newPaneForApp = vi.fn().mockResolvedValue(undefined);

        (globalThis as any).__or3MultiPaneApi = {
            panes: ref([
                { id: 'pane-1', mode: 'test-app', documentId: 'post-99' },
            ]),
            activePaneIndex: ref(0),
            setActive,
            newPaneForApp,
        };

        registerSidebarPostList({
            id: 'test-list-2',
            label: 'Test',
            appId: 'test-app',
            postType: 'test-type',
            reusePane: true,
        });

        const wrapper = mountRegisteredComponent('test-list-2');

        const vm = wrapper.vm as unknown as {
            handleItemClick: (post: typeof basePost) => Promise<void>;
        };

        await vm.handleItemClick(basePost);

        expect(newPaneForApp).toHaveBeenCalledTimes(1);
        expect(newPaneForApp).toHaveBeenCalledWith('test-app', {
            initialRecordId: 'post-1',
        });
        expect(setActive).not.toHaveBeenCalled();
    });
});
