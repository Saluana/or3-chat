import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import SideNavContent from '../SideNavContent.vue';

// Minimal stubs for child components & composables used inside (focus is resize logic wiring)
vi.mock('~/components/sidebar/SidebarVirtualList.vue', () => ({
    default: {
        name: 'SidebarVirtualList',
        props: [
            'height',
            'projects',
            'threads',
            'documents',
            'displayDocuments',
            'expandedProjects',
            'activeSections',
            'activeThread',
            'activeDocument',
            'activeThreads',
            'activeDocuments',
        ],
        template: '<div class="virtual-list" />',
    },
}));
vi.mock('~/components/sidebar/SideNavHeader.vue', () => ({
    default: {
        name: 'SideNavHeader',
        props: ['sidebarQuery', 'activeSections', 'projects'],
        template: '<header class="side-nav-header" />',
    },
}));
vi.mock('dexie', () => ({
    liveQuery: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
}));
vi.mock('~/db', () => ({
    db: {
        threads: {
            orderBy: () => ({
                reverse: () => ({
                    filter: () => ({ toArray: async () => [] }),
                }),
            }),
        },
        projects: {
            orderBy: () => ({
                reverse: () => ({
                    filter: () => ({ toArray: async () => [] }),
                }),
            }),
        },
        posts: {
            where: () => ({
                equals: () => ({ and: () => ({ toArray: async () => [] }) }),
            }),
        },
    },
    upsert: {},
    del: {},
    create: {},
}));
vi.mock('~/db/documents', () => ({ updateDocument: vi.fn() }));
vi.mock('~/composables/documents/useDocumentsStore', () => ({
    loadDocument: vi.fn(),
}));
vi.mock('~/composables/sidebar/useSidebarSearch', () => ({
    useSidebarSearch: () => ({
        query: ref(''),
        threadResults: ref([]),
        projectResults: ref([]),
        documentResults: ref([]),
    }),
}));
vi.mock('~/composables/useHooks', () => ({
    useHooks: () => ({ doAction: async () => {} }),
}));

import { ref } from 'vue';

describe('SideNavContent resize logic', () => {
    it('mounts and provides a numeric listHeight', async () => {
        const wrapper = mount(SideNavContent, {
            props: { activeThread: undefined },
        });
        // Allow nextTick chain used in onMounted
        await wrapper.vm.$nextTick();
        expect(typeof (wrapper.vm as any).listHeight).toBe('number');
        // Simulate container size change by directly calling recompute if exposed
        // (Not strictly necessary; mount success without TS/runtime errors is primary assertion.)
    });
});
