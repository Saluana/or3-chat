import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { readProjectWorkspace } from '~/db/project-workspace';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { testRuntimeConfig } from '~~/tests/setup';

const projectId = ref('a');
const toolCatalog = vi.hoisted(() => ({ tools: [] as unknown[] }));
vi.mock('#imports', async load => ({ ...(await load<Record<string, unknown>>()), useRuntimeConfig: () => testRuntimeConfig.value }));
vi.mock('~/composables/sidebar/useProjectSidebar', () => ({ useProjectSidebar: () => ({ projectId, returnTo: ref('home') }) }));
vi.mock('~/composables/sidebar/useActiveSidebarPage', () => ({ useActiveSidebarPage: () => ({ setActivePage: async () => {} }) }));
vi.mock('~/utils/chat/tool-registry', () => ({ useToolRegistry: () => ({ listTools: shallowRef(toolCatalog.tools) }) }));
vi.mock('~/composables/chat/useModelStore', () => ({ useModelStore: () => ({ catalog: ref([]), favoriteModels: ref([]) }) }));
vi.mock('~/composables/search/useCommandPalette', () => ({ getPaletteHostContext: () => null }));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => null, getCachedSessionPayload: () => null }));
import SidebarProjectsPage from '../SidebarProjectsPage.vue';

// The actual kept-alive page owns navigation cancellation. Store tests cannot
// exercise its lifecycle. A held extraction worker provides a deterministic
// completion after navigation; extraction itself is covered at its own boundary.
let wrapper: VueWrapper;
let db: ReturnType<typeof setActiveWorkspaceDb>;
let workspaceId: string;
let ssr: boolean;
const visible = ref(true);
const workers: Array<{ onmessage?: (event: { data: unknown }) => void }> = [];
beforeEach(async () => {
    toolCatalog.tools = [];
    ssr = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('File', NodeFile);
    vi.stubGlobal('useIcon', (name: string) => ref(name));
    vi.stubGlobal('Worker', class {
        onmessage?: (event: { data: unknown }) => void;
        constructor() { workers.push(this); }
        postMessage() {}
        terminate() {}
    });
    workers.length = 0;
    projectId.value = 'a';
    visible.value = true;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspaceId = `project-intake-${crypto.randomUUID()}`;
    db = setActiveWorkspaceDb(workspaceId);
    await db.open();
    await db.projects.bulkPut(['a', 'b'].map(id => ({ id, name: `Project ${id.toUpperCase()}`, data: [], clock: 1, created_at: 1, updated_at: 1, deleted: false })));
    const Host = defineComponent({ components: { SidebarProjectsPage }, setup: () => ({ visible }),
        template: '<KeepAlive><SidebarProjectsPage v-if="visible" /></KeepAlive>' });
    wrapper = mount(Host, { global: { stubs: {
        SidebarTimeGroupedList: defineComponent({ template: '<div><slot name="header" /></div>' }),
        USelectMenu: true, USelect: true, USwitch: true,
        UPopover: defineComponent({ template: '<div><slot /><slot name="content" /></div>' }),
    } } });
});

// A globally enabled server tool still cannot execute in a browser project.
it('shows server-owned tools as unavailable rather than offering permission controls', async () => {
    wrapper.unmount();
    toolCatalog.tools = [{ definition: { type: 'function', function: { name: 'server_only', description: 'Server tool', parameters: { type: 'object', properties: {} } }, ui: { label: 'Server only' } },
        runtime: 'server', enabled: ref(true) }];
    wrapper = mount(SidebarProjectsPage, { global: { stubs: { SidebarTimeGroupedList: defineComponent({ template: '<div><slot name="header" /></div>' }), USelectMenu: true, USelect: true, USwitch: true } } });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Project A'));
    await wrapper.get('button[title="Project settings"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Server only'));
    const unavailable = wrapper.find('details.project-unavailable-tools');
    expect(unavailable.exists()).toBe(true);
    expect(unavailable.text()).toContain('Server only');
    expect(unavailable.text()).toMatch(/server.*project|project.*browser/i);
});

// Failure inventory: source completion closes a newer note/picker draft; a
// refused binding leaves a standalone note committed and invites duplicates.
it.each(['note', 'document', 'file'] as const)('retains a newer %s draft after knowledge submission', async kind => {
    await db.posts.bulkPut(['one', 'two'].map(id => ({ id, postType: 'doc', title: id, content: '{"type":"doc","content":[]}',
        deleted: false, clock: 1, created_at: 1, updated_at: 1 })));
    const { importWorkspaceFile } = await import('~/db/workspace-files');
    const { captureProjectOperation } = await import('~/utils/projects/context');
    const saved = kind === 'file' ? await Promise.all(['one', 'two'].map(name => importWorkspaceFile(captureProjectOperation(), new NodeBlob([name], { type: 'text/plain' }) as Blob, `${name}.txt`))) : [];
    await vi.waitFor(() => expect(wrapper.text()).toContain('Project A'));
    await wrapper.get('button[aria-label="Knowledge"]').trigger('click');
    const label = kind === 'note' ? 'Write a note' : kind === 'document' ? 'OR3 document' : 'Saved file';
    await wrapper.get(`button[label="${label}"]`).trigger('click');
    let release!: () => void;
    if (kind === 'note') useHooks().addAction('db.documents.create:action:before', () => new Promise<void>(resolve => { release = resolve; }));
    if (kind === 'document') useHooks().addFilter('db.posts.upsert:filter:input', value => 'postType' in value && value.postType === 'or3:project-source'
        ? new Promise<typeof value>(resolve => { release = () => resolve(value); }) : value);
    if (kind === 'note') {
        await wrapper.get('input[aria-label="Note title"]').setValue('Submitted note');
        await wrapper.get('textarea[aria-label="Note text"]').setValue('Submitted text');
    } else {
        const first = kind === 'document' ? 'one' : saved[0]!.post.id;
        await vi.waitFor(() => expect(wrapper.find(`option[value="${first}"]`).exists()).toBe(true));
        await wrapper.get('select').setValue(first);
    }
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => kind === 'file' ? expect(workers).toHaveLength(1) : expect(release).toBeTypeOf('function'));
    if (kind === 'note') {
        await wrapper.get('input[aria-label="Note title"]').setValue('Newer draft');
        await wrapper.get('textarea[aria-label="Note text"]').setValue('Keep this text');
    } else await wrapper.get('select').setValue(kind === 'document' ? 'two' : saved[1]!.post.id);
    if (kind === 'file') workers[0]!.onmessage?.({ data: { ok: true, text: 'one', partial: false, locations: [] } });
    else release();
    await vi.waitFor(async () => expect((await readProjectWorkspace(db, 'a')).sources).toHaveLength(1));
    await vi.waitFor(() => expect((wrapper.get('button[label="Add source"]').element as HTMLButtonElement).disabled).toBe(false));
    await vi.waitFor(() => expect(wrapper.find('form').exists()).toBe(true));
    if (kind === 'note') {
        expect((wrapper.get('input[aria-label="Note title"]').element as HTMLInputElement).value).toBe('Newer draft');
        expect((wrapper.get('textarea[aria-label="Note text"]').element as HTMLTextAreaElement).value).toBe('Keep this text');
    } else expect((wrapper.get('select').element as HTMLSelectElement).value).toBe(kind === 'document' ? 'two' : saved[1]!.post.id);
});

it('does not commit a note when its project knowledge binding is refused', async () => {
    await vi.waitFor(() => expect(wrapper.text()).toContain('Project A'));
    await wrapper.get('button[aria-label="Knowledge"]').trigger('click');
    await wrapper.get('button[label="Write a note"]').trigger('click');
    await wrapper.get('input[aria-label="Note title"]').setValue('Atomic note');
    await wrapper.get('textarea[aria-label="Note text"]').setValue('Keep on failure');
    useHooks().addFilter('db.posts.upsert:filter:input', value => 'postType' in value && value.postType === 'or3:project-source' ? { ...value, id: 'redirected' } : value);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('filter'));
    expect(await db.posts.where('postType').equals('doc').count()).toBe(0);
    expect((await db.projects.get('a'))?.data).toEqual([]);
    expect((wrapper.get('textarea[aria-label="Note text"]').element as HTMLTextAreaElement).value).toBe('Keep on failure');
});
afterEach(async () => {
    wrapper?.unmount();
    setActiveWorkspaceDb(null);
    evictWorkspaceDb(workspaceId);
    await Dexie.delete(db.name);
    setHookEngine(null);
    vi.unstubAllGlobals();
    testRuntimeConfig.value.public.ssrAuthEnabled = ssr;
});

it.each(['hidden', 'home', 'other project'] as const)('finishes an admitted project upload after navigating to %s', async destination => {
    await vi.waitFor(() => expect(wrapper.text()).toContain('Project A'));
    const knowledge = wrapper.findAll('button').find(button => button.text().includes('Knowledge'));
    expect(knowledge).toBeDefined();
    await knowledge!.trigger('click');
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new NodeFile(['Knowledge content'], 'notes.txt', { type: 'text/plain' })] });
    await input.trigger('change');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    expect((await readProjectWorkspace(db, 'a')).sources[0]?.value.revisions[0]?.status).toBe('processing');
    // A picker that remains available during extraction silently loses its
    // next selection because the page's action runner is still occupied.
    expect((input.element as HTMLInputElement).disabled).toBe(true);
    if (destination === 'hidden') visible.value = false;
    else projectId.value = destination === 'home' ? '' : 'b';
    await nextTick();
    workers[0]!.onmessage?.({ data: { ok: true, text: 'Knowledge content', partial: false, locations: [] } });
    await vi.waitFor(async () => expect((await readProjectWorkspace(db, 'a')).sources[0]?.value.revisions[0]?.status).toBe('ready'));
    expect((await readProjectWorkspace(db, 'b')).sources).toHaveLength(0);
    projectId.value = 'a';
    visible.value = true;
    await nextTick();
    if (destination !== 'hidden') {
        await vi.waitFor(() => expect(wrapper.find('button[aria-label="Knowledge"]').exists()).toBe(true));
        await wrapper.get('button[aria-label="Knowledge"]').trigger('click');
    }
    await vi.waitFor(() => expect(wrapper.text()).toContain('notes.txt'));
});
