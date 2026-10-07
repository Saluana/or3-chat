import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, computed, ref } from 'vue';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createDocumentInDb } from '~/db/documents';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import * as nuxtImports from '#imports';
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
import { readFamilyPage } from '~/utils/sidebar/thread-families';

const Content = defineComponent({
    name: 'SidebarContentFixture',
    props: ['docs', 'items', 'projects', 'displayDocuments', 'sidebarQuery'],
    emits: ['update:sidebar-query'],
    template: '<div />',
});
const Modals = defineComponent({
    name: 'SidebarEntityModals',
    props: ['showRenameModal', 'renameTitle'],
    emits: ['saveRename', 'update:renameTitle'],
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

    it('removes unavailable file metadata from the mounted project projection', async () => {
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
        wrapper = shallowMount(SideBar, { global: { stubs: {
            SidebarSideNavContent: Content, SidebarSideNavContentCollapsed: true,
            SidebarSideMobileBottomNav: true, SidebarEntityModals: true, UModal: true,
        } } });
        const view = wrapper.getComponent(Content);
        await vi.waitFor(() => expect(view.props('projects')[0]?.data).toHaveLength(1));
        await db.projects.update('file-project', { data: [{ kind: 'file', id: 'project-file', name: 'Project alias' }] });
        await vi.waitFor(() => expect(view.props('projects')[0]?.data[0]?.name).toBe('Project alias'));
        await db.file_meta.update(hash, { deleted: true });
        await vi.waitFor(() => expect(view.props('projects')[0]?.data).toHaveLength(0));
        expect((await db.projects.get('file-project'))?.data).toEqual([{ kind: 'file', id: 'project-file', name: 'Project alias' }]);
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

    // A rename supplies no editor snapshot, so an edit that lands while the update
    // hooks run is rejected rather than overwritten.
    // Failure cases: the rename overwrites the newer edit; the user is given no
    // explanation and the typed title is lost; the rejection goes unhandled;
    // retrying against the current document does not succeed.
    it('keeps the rename open and explains it when the document changed meanwhile, then saves on retry', async () => {
        const toastAdd = vi.fn();
        const toastSpy = vi.spyOn(nuxtImports, 'useToast').mockReturnValue({ add: toastAdd } as never);
        try {
            const hooks = createTypedHookEngine(createHookEngine());
            setHookEngine(hooks);
            const id = `sidebar-rename-${crypto.randomUUID()}`;
            const db = setActiveWorkspaceDb(id);
            workspaces.push({ id, name: db.name });
            const document = await createDocumentInDb(db, { title: 'Original title' });
            wrapper = shallowMount(SideBar, { global: { stubs: {
                SidebarSideNavContent: Content, SidebarSideNavContentCollapsed: true,
                SidebarSideMobileBottomNav: true, SidebarEntityModals: Modals, UModal: true,
            } } });
            const view = wrapper.getComponent(Content);
            await vi.waitFor(() => expect(view.props('docs')).toHaveLength(1));
            const modals = wrapper.getComponent(Modals);
            view.vm.$emit('rename-document', { id: document.id, title: document.title, postType: 'doc' });
            await vi.waitFor(() => expect(modals.props('showRenameModal')).toBe(true));
            modals.vm.$emit('update:renameTitle', 'Renamed in sidebar');

            // Hold the rename inside its update hooks while another writer edits the document.
            let resume!: () => void;
            let entered!: () => void;
            const reached = new Promise<void>((resolve) => { entered = resolve; });
            const gate = new Promise<void>((resolve) => { resume = resolve; });
            const barrier = async () => { entered(); await gate; };
            hooks.addAction('db.documents.update:action:before', barrier);
            modals.vm.$emit('saveRename');
            await reached;
            const newerContent = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Newer work' }] }] });
            await db.posts.update(document.id, { content: newerContent, clock: 99 });
            resume();

            await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Document: rename not saved' })));
            expect(modals.props('showRenameModal')).toBe(true);
            expect(modals.props('renameTitle')).toBe('Renamed in sidebar');
            expect(await db.posts.get(document.id)).toMatchObject({ title: 'Original title', content: newerContent });

            // Retrying now renames the current document and keeps the newer edit.
            hooks.removeAction('db.documents.update:action:before', barrier);
            modals.vm.$emit('saveRename');
            await vi.waitFor(async () => expect((await db.posts.get(document.id))?.title).toBe('Renamed in sidebar'));
            expect((await db.posts.get(document.id))?.content).toBe(newerContent);
            await vi.waitFor(() => expect(modals.props('showRenameModal')).toBe(false));
        } finally {
            toastSpy.mockRestore();
        }
    });
});
