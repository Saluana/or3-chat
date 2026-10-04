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
import SidebarFamilyItem from '../SidebarFamilyItem.vue';
import { readFamilyPage } from '~/utils/sidebar/thread-families';

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
    it('names the family after its original even when a compaction has newer activity', async () => {
        const id = `sidebar-timeline-${crypto.randomUUID()}`; const db = setActiveWorkspaceDb(id); await db.open();
        workspaces.push({ id, name: db.name });
        const base = { status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 };
        await db.threads.bulkPut([
            { ...base, id: 'root', title: 'Launch' },
            { ...base, id: 'earlier', title: 'Launch — compacted', parent_thread_id: 'root', root_thread_id: 'root',
                branch_mode: 'compacted', created_at: 2, updated_at: 10 },
            { ...base, id: 'latest', title: 'Launch — compacted', parent_thread_id: 'earlier', root_thread_id: 'root',
                branch_mode: 'compacted', created_at: 3, updated_at: 3 },
        ]);
        const page = await readFamilyPage(db, { limit: 50, type: 'thread', filter: {} });
        expect(page.items[0]?.title).toBe('Launch');
        expect(page.items[0]?.id).toBe('earlier');
        wrapper = shallowMount(SidebarFamilyItem, { props: { item: page.items[0]!, active: false, timeDisplay: '' } });
        const row = wrapper.getComponent({ name: 'SidebarUnifiedItem' });
        row.vm.$emit('rename', page.items[0]); row.vm.$emit('delete', page.items[0]);
        expect(wrapper.emitted('rename')?.[0]?.[0]).toMatchObject({ id: 'root', title: 'Launch' });
        expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ id: 'root', title: 'Launch' });
    });

    it.each(['standalone', 'reference', 'compacted'] as const)('only shows a family dropdown for related chats (%s)', async (kind) => {
        const id = `sidebar-family-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(id); await db.open();
        workspaces.push({ id, name: db.name });
        const base = { status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 };
        await db.threads.put({ ...base, id: 'original', title: 'Original' });
        if (kind !== 'standalone') await db.threads.put({ ...base, id: 'child', title: 'Child',
            parent_thread_id: 'original', root_thread_id: 'original', branch_mode: kind, forked: true });
        // Even when search hides the child, its original still has a family dropdown.
        const page = await readFamilyPage(db, { limit: 50, type: 'thread', filter: { query: 'Original' } });
        wrapper = shallowMount(SidebarFamilyItem, { props: { item: page.items[0]!, active: false, timeDisplay: '' } });
        expect(wrapper.find('[aria-label="Expand Original"]').exists()).toBe(kind !== 'standalone');
    });

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
