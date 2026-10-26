import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { defineComponent, ref, nextTick } from 'vue';
import { shallowMount, flushPromises, type VueWrapper } from '@vue/test-utils';
import type { Editor } from '@tiptap/vue-3';
import { setActiveWorkspaceDb, evictWorkspaceDb, type Or3DB } from '~/db/client';
import { createDocumentInDb } from '~/db/documents';
import { flush } from '~/composables/documents/useDocumentsStore';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import DocumentEditorRoot from '~/components/documents/DocumentEditorRoot.vue';
import DocumentInspector from '~/components/documents/DocumentInspector.vue';
import { getActiveDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import ToolbarButton from '~/components/documents/ToolbarButton.vue';

const controls = vi.hoisted(() => ({ checkpoint: vi.fn(), status: undefined as any }));
vi.mock('~/composables/useIcon', () => ({ useIcon: (name: string) => ref(name) }));
vi.mock('~/composables/core/useResponsiveState', () => ({ useResponsiveState: () => ({ isMobile: ref(false), hydrated: ref(true) }) }));
vi.mock('~/db/document-revisions', () => ({ createDocumentRevision: controls.checkpoint }));
vi.mock('~/composables/documents/useDocumentAiAgent', () => ({ useDocumentAiAgent: () => ({
    status: controls.status = ref('idle'), error: ref(''), tokenEstimate: ref(0), proposal: ref(null),
    stale: ref(false), accepting: ref(false), agentStatus: ref(''), pendingHunkCount: ref(0), focusedHunkId: ref(null),
    reset() {}, abort() {}, syncScopeHighlight() {},
}) }));

const Title = defineComponent({ props: ['modelValue'], emits: ['update:model-value'], template: '<textarea :value="modelValue" @input="$emit(\'update:model-value\', $event.target.value)" />' });
const Button = defineComponent({ props: ['label'], emits: ['click'], template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>' });
const content = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
let wrapper: VueWrapper;
let db: Or3DB;
let workspace: string;
let id: string;
let editor: Editor;

async function mountEditor(raw?: string) {
    controls.checkpoint.mockReset().mockResolvedValue(null);
    workspace = `editor-ui-audit-${crypto.randomUUID()}`;
    db = setActiveWorkspaceDb(workspace);
    await db.open();
    const hooks = createTypedHookEngine(createHookEngine());
    setHookEngine(hooks);
    hooks.addAction('editor.created:action:after', payload => { editor = payload.editor as Editor; });
    id = (await createDocumentInDb(db, { title: 'Current title', content: content('Current saved body') })).id;
    if (raw !== undefined) await db.posts.update(id, { content: raw });
    wrapper = shallowMount(DocumentEditorRoot, { props: { documentId: id, paneId: 'audit-pane', tabId: 'audit-tab' },
        global: { directives: { theme: () => {} }, stubs: { UButton: Button, UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true } } });
    await vi.waitFor(() => expect(wrapper.emitted('ready')).toEqual([[id]]));
    if (raw === undefined) await vi.waitFor(() => expect(editor.isEditable).toBe(true));
}
afterEach(async () => {
    vi.useRealTimers();
    wrapper?.unmount();
    await flushPromises();
    if (db) { await flush(id, db); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); }
    setHookEngine(null);
    vi.restoreAllMocks();
});

it('preserves intervening typing while history restore prepares its checkpoint', async () => {
    await mountEditor();
    let resume!: () => void;
    controls.checkpoint.mockReturnValueOnce(new Promise<void>(resolve => { resume = resolve; }));
    await wrapper.get('[aria-label="Outline & info"]').trigger('click');
    wrapper.getComponent(DocumentInspector).vm.$emit('restore', {
        manifest: { documentId: id, revisionId: 'old-version' }, snapshot: { title: 'Historical title', content: content('Historical body') },
    });
    await vi.waitFor(() => expect(controls.checkpoint).toHaveBeenCalledTimes(1));
    expect(editor.isEditable).toBe(false);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' NEW TYPING WHILE RESTORING');
    resume();
    await flushPromises();
    expect(editor.getText()).toContain('NEW TYPING WHILE RESTORING');
    expect((await db.posts.get(id))?.content).not.toContain('Historical body');
    expect(JSON.stringify(controls.checkpoint.mock.calls[0]![0])).not.toContain('NEW TYPING');
});

it('refuses toolbar mutations while the AI preview has locked the editor', async () => {
    await mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 8 });
    controls.status.value = 'preview';
    await nextTick();
    expect(editor.isEditable).toBe(false);
    expect(wrapper.get('[role="toolbar"]').attributes('inert')).toBeDefined();
    wrapper.findAllComponents(ToolbarButton).find(button => button.props('label')?.startsWith('Bold'))!.vm.$emit('activate');
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"bold"');
});


it.each(['{truncated', JSON.stringify({ type: 'doc', content: [{ type: 'missingPluginNode', attrs: { original: 'preserve me' } }] })])('preserves unreadable native content and offers raw recovery and retry: %s', async raw => {
    await mountEditor(raw);
    expect(wrapper.find('.document-editor-toolbar').exists()).toBe(false);
    expect(wrapper.text()).toContain('Download original document');
    expect((await db.posts.get(id))?.content).toBe(raw);
    await db.posts.update(id, { content: JSON.stringify(content('Recovered storage read')) });
    const retry = wrapper.findAll('button').find(button => button.text() === 'Try again')!;
    await retry.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.document-editor-toolbar').exists()).toBe(true));
    expect(editor.getText()).toBe('Recovered storage read');
});

it('warns that an oversized locally saved document cannot sync without truncating it', async () => {
    await mountEditor();
    const text = 'Large local document '.repeat(16000);
    await db.posts.update(id, { content: JSON.stringify(content(text)) });
    await vi.waitFor(() => expect(wrapper.text()).toContain('too large to sync'));
    expect(wrapper.text()).toContain('Download Markdown');
    expect((await db.posts.get(id))?.content).toContain(text);
});

it('shows failed automatic history separately from body durability and retries without another edit', async () => {
    await mountEditor();
    controls.checkpoint.mockRejectedValueOnce(new Error('Synthetic checkpoint failure'));
    vi.useFakeTimers();
    editor.commands.insertContent(' Local edit');
    await vi.advanceTimersByTimeAsync(30000);
    await flushPromises();
    await vi.waitFor(() => expect(controls.checkpoint).toHaveBeenCalledTimes(1));
    expect(wrapper.text()).toContain('Saved version could not be created');
    editor.commands.setContent(content('Newer draft after failed checkpoint'), { emitUpdate: true });
    const retry = wrapper.findAll('button').find(button => button.text() === 'Retry saved version')!;
    await retry.trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(controls.checkpoint).toHaveBeenCalledTimes(2));
    expect(wrapper.text()).not.toContain('Saved version could not be created');
    expect(JSON.stringify(controls.checkpoint.mock.calls[1]![0].content)).toContain('Local edit');
    expect((await db.posts.get(id))?.content).toContain('Newer draft after failed checkpoint');
});

it('recovers a stale buffer into a separate copy, preserves the remote save and resumes editing', async () => {
    await mountEditor();
    const session = getActiveDocumentEditorSession(id, 'audit-tab')!;
    editor.commands.setContent(content('My unsaved local draft'), { emitUpdate: true });
    session.captureContent();
    await db.posts.update(id, { content: JSON.stringify(content('Remote committed version')), clock: 10 });
    await expect(session.ensureLocalDurability()).rejects.toThrow();
    await nextTick();
    const recover = wrapper.findAll('button').find(button => button.text() === 'Save local copy and reload');
    expect(recover).toBeDefined();
    await recover!.trigger('click');
    await vi.waitFor(() => expect(editor.getText()).toBe('Remote committed version'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('Your local edits were saved as'));
    const copies = await db.posts.where('postType').equals('doc').and(row => row.id !== id).toArray();
    expect(copies).toHaveLength(1);
    expect(copies[0]!.content).toContain('My unsaved local draft');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' continued editing');
    await getActiveDocumentEditorSession(id, 'audit-tab')!.ensureLocalDurability();
    expect((await db.posts.get(id))?.content).toContain('Remote committed version continued editing');
});
