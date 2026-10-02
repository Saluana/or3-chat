import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';
import * as nuxtImports from '#imports';
import Dexie from 'dexie';
import { Blob as NodeBlob } from 'node:buffer';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createDocumentInDb, getDocumentInDb } from '~/db/documents';
import { flush, loadDocument, releaseDocument, useDocumentState } from '~/composables/documents/useDocumentsStore';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { registerWorkspaceChatTools } from '~/utils/chat/workspace-chat-tools';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { applyWorkspaceDocumentChange } from '~/utils/chat/workspace-document-change';
import { testRuntimeConfig } from '~~/tests/setup';

// Only the unrelated AI/model boundary and UI registries are synthetic.
// Editor lifecycle, TipTap content, store, workspace selection and Dexie are real.
vi.mock('~/composables/useIcon', () => ({ useIcon: (name: string) => ref(name) }));
vi.mock('~/composables/core/useResponsiveState', () => ({ useResponsiveState: () => ({ isMobile: ref(false), hydrated: ref(true) }) }));
vi.mock('~/composables/documents/useDocumentAiAgent', () => ({
    useDocumentAiAgent: () => ({
        status: ref('idle'), error: ref(null), tokenEstimate: ref(0), proposal: ref(null),
        stale: ref(false), accepting: ref(false), agentStatus: ref(null),
        pendingHunkCount: ref(0), focusedHunkId: ref(null),
        reset: () => {}, abort: () => {}, syncScopeHighlight: () => {},
    }),
}));

import DocumentEditorRoot from '../DocumentEditorRoot.vue';

const Title = defineComponent({
    name: 'TitleFixture', props: ['modelValue'], emits: ['update:model-value'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:model-value\', $event.target.value)" />',
});
const documentId = 'copied-document';
const content = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
let wrapper: VueWrapper | undefined;
const workspaces: Array<{ id: string; name: string }> = [];

afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    // Await origin-bound teardown writes before deleting disposable DBs.
    for (const { id, name } of workspaces.splice(0)) {
        const db = setActiveWorkspaceDb(id);
        await flush(documentId, db);
        await releaseDocument(documentId, { flush: false });
        setActiveWorkspaceDb(null);
        evictWorkspaceDb(id);
        await Dexie.delete(name);
    }
    setHookEngine(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function mountedWorkspaces() {
    const hooks = createTypedHookEngine(createHookEngine());
    setHookEngine(hooks);
    let editor!: Editor;
    hooks.addAction('editor.created:action:after', (payload) => {
        if (!(payload.editor instanceof Editor)) throw new Error('Expected a real mounted TipTap editor');
        editor = payload.editor;
    });
    const idA = `mounted-doc-a-${crypto.randomUUID()}`;
    const idB = `mounted-doc-b-${crypto.randomUUID()}`;
    const dbA = setActiveWorkspaceDb(idA);
    const created = await createDocumentInDb(dbA, { title: 'A private title', content: content('A original body') });
    const row = (await dbA.posts.get(created.id))!;
    await dbA.posts.delete(created.id);
    await dbA.posts.put({ ...row, id: documentId });
    const dbB = setActiveWorkspaceDb(idB);
    await dbB.posts.put({ ...row, id: documentId, title: 'B title', content: JSON.stringify(content('B original body')) });
    workspaces.push({ id: idA, name: dbA.name }, { id: idB, name: dbB.name });
    // A legitimate earlier visit has already hydrated the B cache.
    await loadDocument(documentId);
    setActiveWorkspaceDb(idA);
    wrapper = shallowMount(DocumentEditorRoot, {
        props: { documentId, paneId: 'fixture-pane', tabId: 'fixture-tab' },
        global: { directives: { theme: () => {} }, stubs: {
            UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true,
        } },
    });
    await vi.waitFor(() => expect(wrapper!.emitted('ready')).toEqual([[documentId]]));
    expect(wrapper.getComponent(Title).props('modelValue')).toBe('A private title');
    expect(JSON.stringify(editor.getJSON())).toContain('A original body');
    return { dbA, dbB, idA, idB, editor, hooks, currentEditor: () => editor };
}

describe('mounted document editor workspace lifecycle', () => {
    it('accepts committed Apply without another storage reload that can revive the old buffer', async () => {
        vi.stubGlobal('Blob', NodeBlob);
        const originalAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
        testRuntimeConfig.value.public.ssrAuthEnabled = false;
        const { dbA, idA, hooks, currentEditor } = await mountedWorkspaces();
        const dispose = registerWorkspaceChatTools();
        const registry = useToolRegistry();
        try {
            await dbA.messages.put({ id: 'mounted-apply-message', thread_id: 'mounted-thread', role: 'assistant',
                data: { content: '' }, created_at: 1, updated_at: 1, deleted: false, clock: 1, pending: false, index: 0 });
            const context = { subject: null, workspaceId: idA, threadId: 'mounted-thread', messageId: 'mounted-apply-message',
                requestId: 'mounted-apply-request', callId: 'mounted-read', abortSignal: new AbortController().signal };
            const read = await registry.executeTool('workspace_read', JSON.stringify({ item: { kind: 'document', id: documentId } }),
                context, { definition: registry.getTool('workspace_read')!.definition });
            expect(read.error).toBeUndefined();
            const revisionBefore = (await dbA.posts.get(documentId))!.clock;
            const proposal = await registry.executeTool('workspace_propose_document_edit', JSON.stringify({
                documentId, readId: JSON.parse(read.result!).readId,
                operations: [{ kind: 'replace_block', ref: 'b1', content: content('Mounted applied body').content }],
            }), { ...context, callId: 'mounted-proposal' }, { definition: registry.getTool('workspace_propose_document_edit')!.definition });
            expect(proposal.error).toBeUndefined();
            expect((await dbA.posts.get(documentId))!.clock).toBe(revisionBefore);
            let afterCommitRead = false;
            const get = dbA.posts.get.bind(dbA.posts);
            hooks.addAction('db.documents.update:action:after', () => {
                vi.spyOn(dbA.posts, 'get').mockImplementationOnce(async () => { afterCommitRead = true; throw new Error('Injected post-commit read failure'); });
            });
            expect((await applyWorkspaceDocumentChange(JSON.parse(proposal.result!))).status).toBe('applied');
            expect(afterCommitRead).toBe(false);
            expect(JSON.stringify(currentEditor().getJSON())).toContain('Mounted applied body');
            vi.restoreAllMocks();
            wrapper!.unmount(); wrapper = undefined;
            await flush(documentId, dbA);
            expect((await get(documentId))?.content).toContain('Mounted applied body');
        } finally { dispose(); testRuntimeConfig.value.public.ssrAuthEnabled = originalAuth; }
    });
    it('avoids a spurious missing-document toast when workspace tabs tear down the old pane', async () => {
        const { dbB, idB } = await mountedWorkspaces();
        await dbB.posts.delete(documentId);
        const add = vi.fn();
        vi.spyOn(nuxtImports, 'useToast').mockReturnValue({ ...nuxtImports.useToast(), add });
        setActiveWorkspaceDb(idB);
        wrapper!.unmount(); wrapper = undefined;
        await flushPromises();
        expect(add).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Document: not found' }));
    });

    it('refreshes a retained same-ID editor for the new workspace', async () => {
        const { idB, currentEditor } = await mountedWorkspaces();
        setActiveWorkspaceDb(idB);
        await vi.waitFor(() => expect(wrapper!.getComponent(Title).props('modelValue')).toBe('B title'));
        expect(useDocumentState(documentId).record?.title).toBe('B title');
        await vi.waitFor(() => expect(JSON.stringify(currentEditor().getJSON())).toContain('B original body'));
    });

    it.each(['debounce', 'unmount'] as const)('keeps a pending editor %s save in its originating workspace', async (mode) => {
        const { dbA, dbB, idB, editor } = await mountedWorkspaces();
        const originState = useDocumentState(documentId);
        editor.commands.setContent(content('A unsaved editor body'), { emitUpdate: true });
        setActiveWorkspaceDb(idB);
        if (mode === 'unmount') { wrapper!.unmount(); wrapper = undefined; }
        await vi.waitFor(() => expect(originState.status).toBe('saved'), { timeout: 2_000 });
        expect(JSON.stringify((await getDocumentInDb(dbB, documentId))?.content)).toContain('B original body');
        expect(JSON.stringify((await getDocumentInDb(dbA, documentId))?.content)).toContain('A unsaved editor body');
    });

    it('ignores a held earlier load after switching B then back to A', async () => {
        const { dbB, idA, idB, hooks, currentEditor } = await mountedWorkspaces();
        let finish!: () => void;
        const held = new Promise<void>((resolve) => { finish = resolve; });
        let started!: () => void;
        const waiting = new Promise<void>((resolve) => { started = resolve; });
        hooks.addFilter('db.documents.get:filter:output', async (document) => {
            if (document?.title === 'B title') { started(); await held; }
            return document;
        });
        setActiveWorkspaceDb(idB);
        await waiting;
        setActiveWorkspaceDb(idA);
        await vi.waitFor(() => expect(currentEditor().isDestroyed).toBe(false));
        await vi.waitFor(() => expect(wrapper!.getComponent(Title).props('modelValue')).toBe('A private title'));
        finish();
        await vi.waitFor(() => expect(useDocumentState(documentId, dbB).status).toBe('idle'));
        await flushPromises();
        expect(wrapper!.emitted('ready')).toHaveLength(2);
        expect(JSON.stringify(currentEditor().getJSON())).toContain('A original body');
        expect(wrapper!.getComponent(Title).props('modelValue')).toBe('A private title');
    });

    it('preserves the pending A body across rapid A→B→A with a delayed save hook', async () => {
        const { dbA, dbB, idA, idB, editor, hooks, currentEditor } = await mountedWorkspaces();
        const originState = useDocumentState(documentId);
        let finish!: () => void;
        const held = new Promise<void>((resolve) => { finish = resolve; });
        let started!: () => void;
        const waiting = new Promise<void>((resolve) => { started = resolve; });
        hooks.addAction('db.documents.update:action:before', async (payload) => {
            if (JSON.stringify(payload.updated.content).includes('A delayed owner edit')) {
                started(); await held;
            }
        });
        editor.commands.setContent(content('A delayed owner edit'), { emitUpdate: true });
        setActiveWorkspaceDb(idB);
        await waiting;
        setActiveWorkspaceDb(idA);
        await vi.waitFor(() => {
            expect(currentEditor().isDestroyed).toBe(false);
            expect(JSON.stringify(currentEditor().getJSON())).toContain('A delayed owner edit');
        });
        finish();
        await vi.waitFor(() => expect(originState.status).toBe('saved'));
        expect(JSON.stringify((await getDocumentInDb(dbA, documentId))?.content)).toContain('A delayed owner edit');
        expect(JSON.stringify((await getDocumentInDb(dbB, documentId))?.content)).toContain('B original body');
    });

    it('preserves the legitimate current-workspace save during unmount', async () => {
        const { dbA, editor } = await mountedWorkspaces();
        editor.commands.setContent(content('A owner edit'), { emitUpdate: true });
        wrapper!.unmount(); wrapper = undefined;
        await vi.waitFor(() => expect(useDocumentState(documentId).status).toBe('saved'));
        expect(JSON.stringify((await getDocumentInDb(dbA, documentId))?.content)).toContain('A owner edit');
    });
});
