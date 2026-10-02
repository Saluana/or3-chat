import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, computed, ref } from 'vue';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createDocumentInDb } from '~/db/documents';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';

// Keep UI-only registries/themes out of the fixture; data subscriptions,
// workspace switching, search and display projection are production owners.
vi.mock('~/composables/useIcon', () => ({ useIcon: (name: string) => ref(name) }));
vi.mock('~/composables/useOr3Config', () => ({
    useOr3Config: () => ({ features: { documents: { enabled: true } } }),
}));
vi.mock('~/composables/useThemeResolver', () => ({ useThemeOverrides: () => computed(() => ({})) }));
vi.mock('~/composables/search/useCommandPalette', () => ({ useCommandPalette: () => ({ open: () => {} }) }));
vi.mock('~/composables/sidebar/useActiveSidebarPage', () => ({
    useActiveSidebarPage: () => ({ activePageId: ref('sidebar-home'), resetToDefault: () => {} }),
}));

import SideBar from '../SideBar.vue';

const Content = defineComponent({
    name: 'SidebarContentFixture',
    props: ['docs', 'items', 'projects', 'displayDocuments', 'sidebarQuery'],
    emits: ['update:sidebar-query'],
    template: '<div />',
});
let wrapper: VueWrapper | undefined;
const workspaces: Array<{ id: string; name: string }> = [];

afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    setActiveWorkspaceDb(null);
    for (const { id, name } of workspaces.splice(0)) {
        evictWorkspaceDb(id);
        await Dexie.delete(name);
    }
    setHookEngine(null);
});

describe('mounted sidebar workspace isolation', () => {
    it('replaces lists and search results immediately when the active workspace switches', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const idA = `sidebar-isolation-a-${crypto.randomUUID()}`;
        const idB = `sidebar-isolation-b-${crypto.randomUUID()}`;
        const dbA = setActiveWorkspaceDb(idA);
        await createDocumentInDb(dbA, { title: 'Workspace A private title' });
        const dbB = setActiveWorkspaceDb(idB);
        await createDocumentInDb(dbB, { title: 'Workspace B title' });
        workspaces.push({ id: idA, name: dbA.name }, { id: idB, name: dbB.name });
        setActiveWorkspaceDb(idA);
        wrapper = shallowMount(SideBar, {
            global: { stubs: {
                SidebarSideNavContent: Content, SidebarSideNavContentCollapsed: true,
                SidebarSideMobileBottomNav: true, SidebarEntityModals: true, UModal: true,
            } },
        });
        const view = wrapper.getComponent(Content);
        await vi.waitFor(() => expect(view.props('docs').map((doc: { title: string }) => doc.title)).toEqual(['Workspace A private title']));
        view.vm.$emit('update:sidebar-query', 'Workspace A private');
        await vi.waitFor(() => expect(view.props('displayDocuments').map((doc: { title: string }) => doc.title)).toEqual(['Workspace A private title']));
        setActiveWorkspaceDb(idB);
        await vi.waitFor(() => expect(view.props('docs').map((doc: { title: string }) => doc.title)).toEqual(['Workspace B title']));
        await vi.waitFor(() => expect(view.props('displayDocuments')).toEqual([]));
        view.vm.$emit('update:sidebar-query', 'Workspace B');
        await vi.waitFor(() => expect(view.props('displayDocuments').map((doc: { title: string }) => doc.title)).toEqual(['Workspace B title']));
    });
});
