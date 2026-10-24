import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import SidebarProjectsSection from '../SidebarProjectsSection.vue';

let workspace: string;
let wrapper: VueWrapper | undefined;
const Child = defineComponent({ name: 'SidebarProjectChild', props: ['child'], template: '<span>{{ child.name }}</span>' });
beforeEach(async () => {
    workspace = `project-titles-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
});
afterEach(async () => {
    wrapper?.unmount(); wrapper = undefined;
    const name = getDb().name;
    setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(name);
});
it('observes canonical automatic and manual titles without rewriting cached project entry labels', async () => {
    const db = getDb();
    await db.threads.add({ id: 'chat', title: 'Temporary title', title_source: 'temporary', created_at: 1, updated_at: 1,
        clock: 1, deleted: false, pinned: false, forked: false, status: 'ready' });
    const project = { id: 'project', name: 'Project', data: [{ kind: 'chat' as const, id: 'chat', name: 'Stale shortcut label' }],
        created_at: 1, updated_at: 1, clock: 1, deleted: false };
    wrapper = mount(SidebarProjectsSection, { props: { projects: [project], hasMore: false, collapsed: false,
        expandedProjects: ['project'], activeThreadIds: [], activeDocumentIds: [] },
        global: { stubs: { SidebarProjectRoot: true, SidebarGroupHeader: true, SidebarProjectChild: Child } } });
    await vi.waitFor(() => expect(wrapper!.text()).toContain('Temporary title'));
    await db.threads.update('chat', { title: 'OR3 Plugin Architecture', title_source: 'generated' });
    await vi.waitFor(() => expect(wrapper!.text()).toContain('OR3 Plugin Architecture'));
    await db.threads.update('chat', { title: 'My chosen title', title_source: 'manual' });
    await vi.waitFor(() => expect(wrapper!.text()).toContain('My chosen title'));
    expect(project.data[0]!.name).toBe('Stale shortcut label');
});
