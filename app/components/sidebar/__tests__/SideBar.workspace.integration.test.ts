import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, computed, h, ref, KeepAlive, nextTick } from 'vue';
import { mount, shallowMount, type VueWrapper } from '@vue/test-utils';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createDocumentInDb } from '~/db/documents';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';

const session = vi.hoisted(() => ({ payload: null as any }));
vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({ data: computed(() => session.payload) }),
    getCachedSessionContext: () => session.payload?.session ?? null,
    getCachedSessionPayload: () => session.payload,
}));
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
import SidebarTimeGroupedList from '../SidebarTimeGroupedList.vue';
import SidebarProjectsSection from '../SidebarProjectsSection.vue';
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
    session.payload = null;
    vi.unstubAllGlobals();
});

describe('mounted sidebar workspace isolation', () => {
    // Failures: hidden KeepAlive views retain live queries; Home reads the full
    // project catalog before slicing, or bounded shortcuts break project search.
    it('pauses kept-alive activity reads and refreshes when shown again', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
        const id = `sidebar-paused-${crypto.randomUUID()}`; const db = setActiveWorkspaceDb(id); await db.open();
        workspaces.push({ id, name: db.name });
        const base = { status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 };
        await db.threads.put({ ...base, id: 'initial', title: 'Initial' });
        let reads = 0;
        const reading = (row: unknown) => { reads++; return row; };
        db.threads.hook('reading', reading);
        const visible = ref(true);
        wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, {
            default: () => visible.value ? h(SidebarTimeGroupedList, { type: 'thread', query: '', activeIds: [] }) : null,
        }) }), { global: { stubs: { SidebarUnifiedItem: true } } });
        try {
            await vi.waitFor(() => expect(wrapper!.findComponent({ name: 'SidebarUnifiedItem' }).exists()).toBe(true));
            visible.value = false; await nextTick();
            const before = reads;
            await db.threads.put({ ...base, id: 'new', title: 'Newest', updated_at: 5 });
            // Allow Dexie's observable mutation to settle while the view is hidden.
            await new Promise(resolve => setTimeout(resolve, 80));
            expect(reads).toBe(before);
            visible.value = true; await nextTick();
            await vi.waitFor(() => expect(wrapper!.findAllComponents({ name: 'SidebarUnifiedItem' }).some(row => row.props('item').id === 'new')).toBe(true));
        } finally { db.threads.hook('reading').unsubscribe(reading); }
    });

    it('loads six Home project rows while search can find projects outside those shortcuts', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const id = `sidebar-bound-${crypto.randomUUID()}`; const db = setActiveWorkspaceDb(id); await db.open();
        workspaces.push({ id, name: db.name });
        await db.projects.bulkPut(Array.from({ length: 100 }, (_, i) => ({ id: 'project-' + i, name: 'Workspace ' + i,
            data: [], clock: 1, deleted: false, created_at: 1, updated_at: i + 1 })));
        wrapper = shallowMount(SideBar, { global: { stubs: { SidebarSideNavContent: Content,
            SidebarSideNavContentCollapsed: true, SidebarSideMobileBottomNav: true, SidebarEntityModals: true, UModal: true } } });
        const view = wrapper.getComponent(Content);
        await vi.waitFor(() => expect(view.props('projects').length).toBeGreaterThan(0));
        expect(view.props('projects')).toHaveLength(6);
        view.vm.$emit('update:sidebar-query', 'Workspace 3');
        await vi.waitFor(() => expect(view.props('projects')).toHaveLength(100));
        view.vm.$emit('update:sidebar-query', '');
        await vi.waitFor(() => expect(view.props('projects')).toHaveLength(6));
    });

    it('reads project activity without hydrating unrelated workspace chats and documents', async () => {
        const id = `sidebar-scoped-${crypto.randomUUID()}`; const db = setActiveWorkspaceDb(id); await db.open();
        workspaces.push({ id, name: db.name });
        const base = { status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 };
        await db.projects.put({ id: 'selected', name: 'Selected', data: [{ kind: 'doc', id: 'selected-doc' }],
            clock: 1, deleted: false, created_at: 1, updated_at: 1 });
        await db.threads.bulkPut([{ ...base, id: 'selected-chat', title: 'Selected', project_id: 'selected' },
            ...Array.from({ length: 500 }, (_, i) => ({ ...base, id: 'noise-chat-' + i, title: 'Other', updated_at: 10 }))]);
        await db.posts.bulkPut([{ id: 'selected-doc', title: 'Document', postType: 'doc', content: '{}', deleted: false,
            clock: 1, created_at: 1, updated_at: 1 },
            ...Array.from({ length: 500 }, (_, i) => ({ id: 'noise-doc-' + i, title: 'Other', postType: 'doc', content: '{}', deleted: false,
                clock: 1, created_at: 1, updated_at: 10 }))]);
        const reads: string[] = [];
        const reading = (row: { id: string }) => { reads.push(row.id); return row; };
        db.threads.hook('reading', reading); db.posts.hook('reading', reading);
        try {
            const page = await readFamilyPage(db, { type: 'all', limit: 50, filter: { projectId: 'selected' } });
            expect(page.items.map(row => row.id).sort()).toEqual(['selected-chat', 'selected-doc']);
            expect(reads.filter(id => id.startsWith('noise-'))).toEqual([]);
        } finally { db.threads.hook('reading').unsubscribe(reading); db.posts.hook('reading').unsubscribe(reading); }
    });

    it('names the family after its original even when a compaction has newer activity', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
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
        vi.stubGlobal('useToast', () => ({ add: vi.fn() }));
        wrapper = mount(SidebarTimeGroupedList, {
            props: { type: 'thread', query: '', activeIds: [] },
            global: { stubs: { SidebarUnifiedItem: true } },
        });
        await vi.waitFor(() => expect(wrapper!.findComponent({ name: 'SidebarUnifiedItem' }).exists()).toBe(true));
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

    it('hides unavailable project file shortcuts and restores them without changing membership', async () => {
        setHookEngine(createTypedHookEngine(createHookEngine()));
        const id = `sidebar-file-${crypto.randomUUID()}`;
        const db = setActiveWorkspaceDb(id);
        workspaces.push({ id, name: db.name });
        const hash = `sha256:${'a'.repeat(64)}`;
        await db.file_meta.put({ hash, name: 'Saved project file', mime_type: 'text/plain', size_bytes: 5,
            kind: 'file', ref_count: 1, deleted: false, clock: 1, created_at: 1, updated_at: 1 });
        await db.posts.put({ id: 'project-file', postType: 'or3:file', title: 'Saved project file', content: 'saved',
            file_hashes: JSON.stringify([hash]), clock: 1, deleted: false, created_at: 1, updated_at: 1 });
        await db.projects.put({ id: 'file-project', name: 'Retained project', data: [{ kind: 'file', id: 'project-file' }],
            clock: 1, deleted: false, created_at: 1, updated_at: 1 });
        // Exercise Home's actual displayed-project -> child-query boundary.
        // Raw project membership deliberately survives unavailable metadata.
        const ProjectContent = defineComponent({
            inheritAttrs: false,
            props: ['displayProjects'],
            setup(props) {
                return () => h(SidebarProjectsSection, {
                    projects: props.displayProjects, hasMore: false, collapsed: false,
                    expandedProjects: ['file-project'], activeThreadIds: [], activeDocumentIds: [],
                });
            },
        });
        wrapper = mount(SideBar, { global: { stubs: {
            SidebarSideNavContent: ProjectContent, SidebarSideNavContentCollapsed: true,
            SidebarSideMobileBottomNav: true, SidebarEntityModals: true, UModal: true,
            SidebarProjectRoot: true, SidebarProjectChild: true,
            SidebarCreateProjectModal: true, SidebarAddToProjectModal: true, SidebarCreateDocumentModal: true,
        } } });
        const child = () => wrapper!.findComponent({ name: 'SidebarProjectChild' });
        await vi.waitFor(() => expect(child().props('child')).toMatchObject({ id: 'project-file', name: 'Saved project file' }));
        await db.projects.update('file-project', { data: [{ kind: 'file', id: 'project-file', name: 'Project alias' }] });
        await vi.waitFor(() => expect(child().props('child').name).toBe('Project alias'));
        await db.file_meta.update(hash, { deleted: true });
        await vi.waitFor(() => expect(child().exists()).toBe(false));
        expect((await db.projects.get('file-project'))?.data).toEqual([{ kind: 'file', id: 'project-file', name: 'Project alias' }]);
        await db.file_meta.update(hash, { deleted: false });
        await vi.waitFor(() => expect(child().props('child')).toMatchObject({ id: 'project-file', name: 'Project alias' }));
    });

    it.each([false, true])('moves a supported document to Files Trash (SSR: %s)', async ssr => {
        const ssrAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
        testRuntimeConfig.value.public.ssrAuthEnabled = ssr;
        try {
            setHookEngine(createTypedHookEngine(createHookEngine()));
            const id = `sidebar-trash-${crypto.randomUUID()}`;
            const db = setActiveWorkspaceDb(id);
            workspaces.push({ id, name: db.name });
            session.payload = { appAccessAllowed: true, workspaceItemCapability: 'v1', session: { authenticated: true, user: { id: 'owner' }, workspace: { id }, role: 'owner' } };
            const document = await createDocumentInDb(db, { title: 'Recoverable sidebar document' });
            wrapper = shallowMount(SideBar, { global: { stubs: {
                SidebarSideNavContent: Content, SidebarSideNavContentCollapsed: true,
                SidebarSideMobileBottomNav: true, SidebarEntityModals: true, UModal: true,
            } } });
            const view = wrapper.getComponent(Content);
            await vi.waitFor(() => expect(view.props('docs')).toHaveLength(1));
            view.vm.$emit('delete-document', { id: document.id, title: document.title });
            wrapper.getComponent({ name: 'SidebarEntityModals' }).vm.$emit('deleteDocument');
            await vi.waitFor(async () => {
                const saved = await db.posts.get(document.id);
                expect(saved?.deleted).toBe(false);
                expect(JSON.parse(saved!.meta as string)['or3.workspace-item'].trashed_at).toBeTypeOf('number');
            });
            await vi.waitFor(() => expect(view.props('docs')).toHaveLength(0));
        } finally { testRuntimeConfig.value.public.ssrAuthEnabled = ssrAuth; }
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
