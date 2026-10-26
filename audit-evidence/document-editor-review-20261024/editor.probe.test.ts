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

async function mountEditor() {
    controls.checkpoint.mockReset().mockResolvedValue(null);
    workspace = `editor-ui-audit-${crypto.randomUUID()}`;
    db = setActiveWorkspaceDb(workspace);
    await db.open();
    const hooks = createTypedHookEngine(createHookEngine());
    setHookEngine(hooks);
    hooks.addAction('editor.created:action:after', payload => { editor = payload.editor as Editor; });
    id = (await createDocumentInDb(db, { title: 'Current title', content: content('Current saved body') })).id;
    wrapper = shallowMount(DocumentEditorRoot, { props: { documentId: id, paneId: 'audit-pane', tabId: 'audit-tab' },
        global: { directives: { theme: () => {} }, stubs: { UButton: Button, UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true } } });
    await vi.waitFor(() => expect(wrapper.emitted('ready')).toEqual([[id]]));
    await vi.waitFor(() => expect(editor.isEditable).toBe(true));
}
afterEach(async () => {
    wrapper?.unmount();
    await flushPromises();
    if (db) { await flush(id, db); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); }
    setHookEngine(null);
    vi.restoreAllMocks();
});

it('reproduces losing intervening typing while history restore awaits its checkpoint', async () => {
    await mountEditor();
    let resume!: () => void;
    controls.checkpoint.mockReturnValueOnce(new Promise<void>(resolve => { resume = resolve; }));
    await wrapper.get('[aria-label="Outline & info"]').trigger('click');
    wrapper.getComponent(DocumentInspector).vm.$emit('restore', {
        manifest: { documentId: id, revisionId: 'old-version' }, snapshot: { title: 'Historical title', content: content('Historical body') },
    });
    await vi.waitFor(() => expect(controls.checkpoint).toHaveBeenCalledTimes(1));
    expect(editor.isEditable).toBe(true);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' NEW TYPING WHILE RESTORING');
    resume();
    await vi.waitFor(() => expect(editor.getText()).toBe('Historical body'));
    await vi.waitFor(async () => expect((await db.posts.get(id))?.content).toContain('Historical body'));
    expect(JSON.stringify(controls.checkpoint.mock.calls[0][0])).not.toContain('NEW TYPING');
});

it('reproduces toolbar mutations while the AI preview has locked the editor', async () => {
    await mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 8 });
    controls.status.value = 'preview';
    await nextTick();
    expect(editor.isEditable).toBe(false);
    expect([undefined, 'false']).toContain(wrapper.get('[role="toolbar"]').attributes('inert'));
    wrapper.findAllComponents(ToolbarButton).find(button => button.props('label')?.startsWith('Bold'))!.vm.$emit('activate');
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"bold"');
});
