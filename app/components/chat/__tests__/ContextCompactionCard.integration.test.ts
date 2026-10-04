import Dexie from 'dexie';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { storedMessagesToCanonicalTranscript, projectTranscriptForUi } from '~/utils/chat/transcript';
import ContextCompactionCard from '../ContextCompactionCard.vue';
import { captureCompaction, validateCompactionSummary, createCompactedFork } from '~/db/compaction';
import type { CompactionData } from '~~/shared/chat/compaction';

const data: CompactionData = { version: 1, compaction_id: 'operation', source_thread_id: 'source', anchor_message_id: 'anchor', anchor_index: 1,
    generated_at: 2, model: 'chosen-model:exact-route', message_count: 2, prior_message_count: 4, summary_markdown: '## Objective\nContinue exact work.',
    landmarks: [{ message_id: 'evidence', thread_id: 'source', role: 'user', index: 0, kind: 'constraint', summary: 'Keep the exact source path' }],
    history_scope: { version: 1, segments: [{ thread_id: 'source', messages: [{ message_id: 'evidence', clock: 1 }, { message_id: 'anchor', clock: 1 }] }] } };
const button = { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' };
let workspace: string;
const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(async () => {
    setHookEngine(createTypedHookEngine(createHookEngine()));
    workspace = `compaction-card-${crypto.randomUUID()}`; await setActiveWorkspaceDb(workspace).open();
    await getDb().threads.put({ id: 'source', title: 'Original', status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 });
    for (const [index, id] of ['evidence', 'anchor'].entries()) await getDb().messages.put({ id, thread_id: 'source', role: index ? 'assistant' : 'user', index,
        created_at: 1, updated_at: 1, clock: 1, deleted: false, pending: false, data: { content: `Original ${id}` } });
    await getDb().messages.put({ id: 'summary', thread_id: 'child', role: 'system', index: 0, created_at: 2, updated_at: 2, clock: 2, deleted: false,
        data: { kind: 'compaction', content: 'Historical reference', compaction: data } });
});
afterEach(async () => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); setHookEngine(null); });
async function card(threadId = 'child') {
    const rows = await getDb().messages.where('thread_id').equals(threadId).toArray();
    const message = projectTranscriptForUi(storedMessagesToCanonicalTranscript(rows))[0]!;
    if (!message.compaction) throw new Error('Expected validated metadata after canonical reload');
    const wrapper = mount(ContextCompactionCard, { props: { threadId, message: { ...message, compaction: message.compaction } }, global: { stubs: { UButton: button } } });
    wrappers.push(wrapper); return wrapper;
}
it('renders a collapsed summary from durable canonical reload with truthful counts and manual landmarks', async () => {
    const wrapper = await card();
    expect(wrapper.get('details').attributes('open')).toBeUndefined();
    expect(wrapper.get('summary').text()).toContain('6 messages · 1 landmark');
    expect(wrapper.get('[data-compaction-summary]').text()).toContain('Continue exact work.');
    expect(wrapper.text()).toContain('chosen-model:exact-route');
    expect(wrapper.text()).toContain('Historical reference');
    const labels = wrapper.findAll('button').map((item) => item.text());
    expect(labels).toEqual(['Keep the exact source path', 'View original']);
    await wrapper.findAll('button')[0]!.trigger('click'); await vi.waitFor(() => expect(wrapper.emitted('view-compaction-source')).toHaveLength(1));
    expect(wrapper.emitted('view-compaction-source')).toEqual([[{ threadId: 'source', messageId: 'evidence', originThreadId: 'child' }]]);
    await wrapper.findAll('button')[1]!.trigger('click'); await vi.waitFor(() => expect(wrapper.emitted('view-compaction-source')).toHaveLength(2));
    expect(wrapper.emitted('view-compaction-source')?.[1]).toEqual([{ threadId: 'source', messageId: 'anchor', originThreadId: 'child' }]);
    expect(await getDb().messages.count()).toBe(3); expect(await getDb().threads.count()).toBe(1);
});
it.each(['deleted', 'replaced', 'wrong-owner', 'missing-thread'] as const)('reports an unavailable original target without navigating (%s)', async (failure) => {
    if (failure === 'missing-thread') await getDb().threads.delete('source');
    else await getDb().messages.update('anchor', failure === 'deleted' ? { deleted: true }
        : failure === 'wrong-owner' ? { thread_id: 'other' } : { data: { content: 'Original', superseded_by: 'replacement' } });
    const wrapper = await card(); await wrapper.findAll('button')[1]!.trigger('click'); await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(true));
    expect(wrapper.emitted('view-compaction-source')).toBeUndefined(); expect(wrapper.get('[role="status"]').text()).toContain('unavailable');
});
it('rejects a workspace round trip during actual source resolution', async () => {
    const wrapper = await card(); let switched = false;
    const origin = getDb();
    const switchWorkspace = (row: unknown) => { if (!switched) { switched = true; setActiveWorkspaceDb('other-card-workspace'); setActiveWorkspaceDb(workspace); } return row; };
    origin.threads.hook('reading', switchWorkspace);
    try { await wrapper.findAll('button')[1]!.trigger('click'); await vi.waitFor(() => expect(switched).toBe(true)); await flushPromises(); }
    finally { origin.threads.hook('reading').unsubscribe(switchWorkspace); evictWorkspaceDb('other-card-workspace'); }
    expect(wrapper.emitted('view-compaction-source')).toBeUndefined();
    await vi.waitFor(() => expect(wrapper.findAll('button')[1]!.attributes('disabled')).toBeUndefined());
    expect(await origin.messages.count()).toBe(3);
    await wrapper.findAll('button')[1]!.trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('view-compaction-source')).toEqual([[{ threadId: 'source', messageId: 'anchor', originThreadId: 'child' }]]));
});

it('rejects an initiating pane thread change during an actual source read and allows a fresh repeat', async () => {
    const wrapper = await card(); const origin = getDb(); let changed = false;
    const changeView = (row: unknown) => { if (!changed) { changed = true; void wrapper.setProps({ threadId: 'other-child' }); } return row; };
    origin.threads.hook('reading', changeView);
    try { await wrapper.findAll('button')[1]!.trigger('click'); await vi.waitFor(() => expect(changed).toBe(true)); await flushPromises(); }
    finally { origin.threads.hook('reading').unsubscribe(changeView); }
    expect(wrapper.emitted('view-compaction-source')).toBeUndefined();
    await wrapper.setProps({ threadId: 'child' }); await wrapper.findAll('button')[1]!.trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('view-compaction-source')).toHaveLength(1));
});

it('keeps a retained summary tied to its rendered workspace when another workspace has the same source IDs', async () => {
    const wrapper = await card(); const origin = getDb(); const otherId = `other-card-${crypto.randomUUID()}`;
    const other = setActiveWorkspaceDb(otherId); await other.open();
    await other.threads.put({ id: 'source', title: 'Unrelated original', status: 'ready', deleted: false, pinned: false, forked: false, created_at: 1, updated_at: 1, clock: 1 });
    await other.messages.put({ id: 'anchor', thread_id: 'source', role: 'assistant', index: 1, created_at: 1, updated_at: 1, clock: 1, deleted: false, data: { content: 'Unrelated workspace' } });
    try {
        await wrapper.findAll('button')[1]!.trigger('click');
        await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(true));
        expect(wrapper.get('[role="status"]').text()).toContain('previous workspace');
        expect(wrapper.emitted('view-compaction-source')).toBeUndefined();
        expect(await other.messages.count()).toBe(1); expect(await origin.messages.count()).toBe(3);
    } finally { setActiveWorkspaceDb(workspace); evictWorkspaceDb(otherId); await Dexie.delete(other.name); }
    await wrapper.findAll('button')[1]!.trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('view-compaction-source')).toEqual([[{ threadId: 'source', messageId: 'anchor', originThreadId: 'child' }]]));
});

it.each([{ kind: 'landmark', lateWorkspace: false }, { kind: 'anchor', lateWorkspace: false }, { kind: 'landmark', lateWorkspace: true }] as const)('keeps a tool $kind identity with visible assistant evidence (late workspace: $lateWorkspace)', async ({ kind, lateWorkspace }) => {
    const db = getDb();
    await db.messages.update('anchor', { data: { content: 'Tool owner reply', tool_calls: [{ id: 'lookup', name: 'lookup', args: '{}', status: 'complete' }] } });
    for (const [index, role] of ['user', 'assistant'].entries()) await db.messages.put({ id: `followup${index}`, thread_id: 'source', role, index: index + 2,
        pending: false, deleted: false, clock: 1, created_at: 1, updated_at: 1, data: { content: 'Long settled evidence '.repeat(300) } });
    await db.messages.put({ id: 'tool-evidence', thread_id: 'source', role: 'tool', index: 4, pending: false, deleted: false, clock: 1, created_at: 1, updated_at: 1,
        data: { content: 'Canonical lookup evidence', tool_call_id: 'lookup', tool_name: 'lookup', parent_assistant_id: 'anchor' } });
    const capture = await captureCompaction({ sourceThreadId: 'source', anchorMessageId: 'tool-evidence', model: 'chosen-model:exact-route' });
    const summary = await validateCompactionSummary(capture, JSON.stringify({ summary_markdown: '## Objective\nContinue.\n## Important Details\nKeep evidence.\n## Work State\nSettled.\n## Next Move\nInspect source.\n## Relevant Files\nNone.',
        landmarks: [{ message_id: 'tool-evidence', kind: 'tool-result', summary: 'Inspect canonical lookup evidence' }] }), { targetTokens: 4096, countText: async (text) => Math.ceil(text.length / 4) });
    const child = await createCompactedFork({ capture, summary });
    const visible = projectTranscriptForUi(storedMessagesToCanonicalTranscript(await db.messages.where('thread_id').equals('source').toArray()));
    expect(visible.some((row) => row.id === 'tool-evidence')).toBe(false);
    expect(visible.find((row) => row.id === 'anchor')?.toolCalls).toMatchObject([{ id: 'lookup', result: 'Canonical lookup evidence' }]);
    const wrapper = await card(child.thread.id);
    let changed = false; const otherId = `tool-link-${crypto.randomUUID()}`;
    const switchDuringParent = (row: { id?: string }) => { if (lateWorkspace && row.id === 'anchor' && !changed) { changed = true; setActiveWorkspaceDb(otherId); setActiveWorkspaceDb(workspace); } return row; };
    db.messages.hook('reading', switchDuringParent);
    try {
        await wrapper.findAll('button')[kind === 'landmark' ? 0 : 1]!.trigger('click');
        if (lateWorkspace) {
            await vi.waitFor(() => expect(changed).toBe(true)); await flushPromises();
            expect(wrapper.emitted('view-compaction-source')).toBeUndefined();
            await vi.waitFor(() => expect(wrapper.findAll('button')[0]!.attributes('disabled')).toBeUndefined());
            await wrapper.findAll('button')[0]!.trigger('click');
        }
        await vi.waitFor(() => expect(wrapper.emitted('view-compaction-source')).toEqual([[{ threadId: 'source', messageId: 'tool-evidence', originThreadId: child.thread.id, scrollMessageId: 'anchor' }]]));
    } finally { db.messages.hook('reading').unsubscribe(switchDuringParent); if (lateWorkspace) evictWorkspaceDb(otherId); }
});
