import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import Dexie from 'dexie';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { MessageSchema, ThreadSchema } from '~/db/schema';
import ThreadChildLinks from '../ThreadChildLinks.vue';

const workspaces: string[] = [];
// fake-indexeddb treats the repeated array sentinel in the compound bound as a cycle.
const maxKey = Dexie.maxKey;
beforeEach(() => { Object.defineProperty(Dexie, 'maxKey', { value: '\uffff', configurable: true, writable: true }); });
function workspace() { const id = `branch-links-${crypto.randomUUID()}`; workspaces.push(id); return setActiveWorkspaceDb(id); }
afterEach(async () => { setActiveWorkspaceDb(null); for (const id of workspaces.splice(0)) { evictWorkspaceDb(id); await Dexie.delete(`or3-db-${id}`); } vi.restoreAllMocks(); Object.defineProperty(Dexie, 'maxKey', { value: maxKey, configurable: true, writable: true }); });
const stub = { UButton: { template: '<button><slot /></button>' } };
const message = (id: string, thread_id = 'root') => MessageSchema.parse({ id, thread_id, role: 'user', index: 1, data: { content: id }, created_at: 1, updated_at: 1, clock: 1 });
const branch = (id: string, anchor_message_id: string, extra = {}) => ThreadSchema.parse({ id, parent_thread_id: 'root', anchor_message_id, title: id, created_at: 1, updated_at: 1, clock: 1, ...extra });

it('standalone rows retain their lookup without branches', async () => {
    const db = workspace(); await db.open(); await db.messages.put(message('m0'));
    const get = vi.spyOn(db.messages, 'get');
    const wrapper = mount(defineComponent({ render: () => h('div', Array.from({ length: 10 }, (_, i) => h(ThreadChildLinks, { threadId: 'root', messageId: `m${i}` }))) }), { global: { stubs: stub } });
    try {
        await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(10));
        console.log('Baseline standalone messages.get count for 10 rows:', get.mock.calls.length);
    } finally { wrapper.unmount(); }
});

it('renders an existing branch without a provider', async () => {
    const db = workspace(); await db.open(); await db.messages.put(message('m0')); await db.threads.put(branch('child', 'm0'));
    const wrapper = mount(defineComponent({ render: () => h('div', [h(ThreadChildLinks, { threadId: 'root', messageId: 'm0' })]) }), { global: { stubs: stub } });
    try { await vi.waitFor(() => expect(wrapper.text()).toContain('Branch · child')); } finally { wrapper.unmount(); }
});

it('shares branch anchors across rows and follows deletion and workspace switches', async () => {
    const db = workspace(); await db.open(); await db.messages.bulkPut(Array.from({ length: 10 }, (_, i) => message(`m${i}`)));
    const get = vi.spyOn(db.messages, 'get');
    const { provideChatBranchAnchors } = await import('~/composables/projects/useChatBranchAnchors');
    const thread = ref('root');
    const wrapper = mount(defineComponent({ setup() { provideChatBranchAnchors(() => thread.value); return () => h('div', Array.from({ length: 10 }, (_, i) => h(ThreadChildLinks, { threadId: thread.value, messageId: `m${i}` }))); } }), { global: { stubs: stub } });
    try {
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(get).not.toHaveBeenCalled();
        await db.threads.put(branch('child', 'm3', { fork_reason: 'retry' }));
        await vi.waitFor(() => expect(wrapper.text()).toContain('Retry · child'));
        expect(wrapper.findAllComponents(ThreadChildLinks).filter(row => row.text().includes('child'))).toHaveLength(1);
        await db.threads.update('child', { deleted: true });
        await vi.waitFor(() => expect(wrapper.text()).not.toContain('child'));
        await db.threads.put(branch('compact', 'm3', { branch_mode: 'compacted' }));
        await vi.waitFor(() => expect(wrapper.text()).toContain('Compacted · compact'));
        thread.value = 'other';
        await vi.waitFor(() => expect(wrapper.text()).not.toContain('compact'));
        thread.value = 'root';
        await vi.waitFor(() => expect(wrapper.text()).toContain('compact'));
        await workspace().open();
        await vi.waitFor(() => expect(wrapper.text()).not.toContain('compact'));
    } finally { wrapper.unmount(); }
});

it('shows a tool-result branch beneath its owning assistant and hides inherited rows', async () => {
    const db = workspace(); await db.open();
    await db.messages.bulkPut([
        MessageSchema.parse({ id: 'assistant', thread_id: 'root', role: 'assistant', index: 1, data: { content: '', tool_calls: [{ id: 'call', name: 'lookup', args: '{}', status: 'complete', result: 'ok', transcript: { parentAssistantId: 'assistant' } }] }, created_at: 1, updated_at: 1, clock: 1 }),
        MessageSchema.parse({ id: 'tool', thread_id: 'root', role: 'tool', index: 2, data: { content: 'ok', parent_assistant_id: 'assistant', tool_call_id: 'call', tool_name: 'lookup' }, created_at: 1, updated_at: 1, clock: 1 }),
        message('inherited', 'other'),
    ]);
    await db.threads.bulkPut([branch('tool-child', 'tool'), branch('inherited-child', 'inherited')]);
    const { provideChatBranchAnchors } = await import('~/composables/projects/useChatBranchAnchors');
    const wrapper = mount(defineComponent({ setup() { provideChatBranchAnchors(() => 'root'); return () => h('div', [h(ThreadChildLinks, { threadId: 'root', messageId: 'assistant', toolResultMessageIds: ['tool'] }), h(ThreadChildLinks, { threadId: 'root', messageId: 'inherited' })]); } }), { global: { stubs: stub } });
    try {
        await vi.waitFor(() => expect(wrapper.text()).toContain('Branch · tool-child'));
        expect(wrapper.text()).not.toContain('inherited-child');
    } finally { wrapper.unmount(); }
});

it('keeps an in-flight navigation when branch metadata changes', async () => {
    const db = workspace(); await db.open(); await db.messages.bulkPut([message('m0'), message('m1')]); await db.threads.bulkPut([branch('child', 'm0'), branch('other', 'm1')]);
    const { provideChatBranchAnchors } = await import('~/composables/projects/useChatBranchAnchors');
    const navigate = vi.fn();
    const wrapper = mount(defineComponent({ setup() { provideChatBranchAnchors(() => 'root'); return () => h('div', [h(ThreadChildLinks, { threadId: 'root', messageId: 'm0', onNavigate: navigate }), h(ThreadChildLinks, { threadId: 'root', messageId: 'm1' })]); } }), { global: { stubs: stub } });
    try {
        await vi.waitFor(() => expect(wrapper.text()).toContain('Branch · child'));
        const original = db.threads.get.bind(db.threads); let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(db.threads, 'get').mockImplementation((async (id: string) => { await gate; return original(id); }) as typeof db.threads.get);
        await wrapper.find('button').trigger('click');
        await db.threads.update('other', { title: 'renamed' });
        await vi.waitFor(() => expect(wrapper.text()).toContain('renamed'));
        release();
        await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    } finally { wrapper.unmount(); }
});

it('shows existing branches when the shared anchor query fails', async () => {
    const db = workspace(); await db.open(); await db.messages.put(message('m0')); await db.threads.put(branch('child', 'm0'));
    const where = db.threads.where.bind(db.threads); let failed = false;
    vi.spyOn(db.threads, 'where').mockImplementation(((index: string) => {
        if (index === 'parent_thread_id' && !failed) { failed = true; throw new Error('transient read failure'); }
        return where(index);
    }) as typeof db.threads.where);
    const { provideChatBranchAnchors } = await import('~/composables/projects/useChatBranchAnchors');
    const wrapper = mount(defineComponent({ setup() { provideChatBranchAnchors(() => 'root'); return () => h(ThreadChildLinks, { threadId: 'root', messageId: 'm0' }); } }), { global: { stubs: stub } });
    try { await vi.waitFor(() => expect(wrapper.text()).toContain('Branch · child')); } finally { wrapper.unmount(); }
});
