import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';
import * as nuxtImports from '#imports';
import Dexie from 'dexie';
import { Blob as NodeBlob } from 'node:buffer';
import { setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { createDocumentInDb, getDocumentInDb } from '~/db/documents';
import { flush, loadDocument, releaseDocument, useAllDocumentsState, useDocumentState } from '~/composables/documents/useDocumentsStore';
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
import * as documentSchema from '~/utils/documents/document-editor-schema';

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

async function mountedWorkspaces(initialAvailability?: 'trashed' | 'missing', mountEditorContent = false) {
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
    await dbA.threads.put({ id: 'mounted-thread', title: 'Tool origin', status: 'ready',
        created_at: 1, updated_at: 1, clock: 1, deleted: false, pinned: false, forked: false });
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
    if (initialAvailability === 'trashed') await dbA.posts.update(documentId, { meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: 1 } }) });
    if (initialAvailability === 'missing') await dbA.posts.delete(documentId);
    wrapper = shallowMount(DocumentEditorRoot, {
        props: { documentId, paneId: 'fixture-pane', tabId: 'fixture-tab' },
        global: { directives: { theme: () => {} }, stubs: {
            EditorContent: !mountEditorContent, NodeViewWrapper: false, USlider: true,
            UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true,
        } },
    });
    await vi.waitFor(() => expect(wrapper!.emitted('ready')).toEqual([[documentId]]));
    if (!initialAvailability) {
        expect(wrapper.getComponent(Title).props('modelValue')).toBe('A private title');
        expect(JSON.stringify(editor.getJSON())).toContain('A original body');
    }
    return { dbA, dbB, idA, idB, editor, hooks, currentEditor: () => editor };
}

describe('mounted document editor workspace lifecycle', () => {
    it('releases a closed document only after its last split pane saves', async () => {
        const { dbA, currentEditor } = await mountedWorkspaces();
        const peer = shallowMount(DocumentEditorRoot, {
            props: { documentId, paneId: 'peer-pane', tabId: 'peer-tab' },
            global: { directives: { theme: () => {} }, stubs: {
                UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true,
            } },
        });
        try {
            await vi.waitFor(() => expect(peer.emitted('ready')).toEqual([[documentId]]));
            wrapper!.unmount(); wrapper = undefined;
            await flushPromises();
            expect(useAllDocumentsState().get(documentId)?.record?.title).toBe('A private title');
            currentEditor().commands.insertContent('Peer survives closing its sibling. ');
        } finally { peer.unmount(); }
        await vi.waitFor(() => expect(useAllDocumentsState().has(documentId)).toBe(false));
        expect((await dbA.posts.get(documentId))?.content).toContain('Peer survives closing its sibling.');
    });

    it('renames a document without serializing its unchanged editor body', async () => {
        const { dbA, editor } = await mountedWorkspaces();
        const serialize = vi.spyOn(editor, 'getJSON');
        await wrapper!.getComponent(Title).get('textarea').setValue('Renamed document');
        expect(serialize).not.toHaveBeenCalled();
        serialize.mockRestore();
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        await getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' })!.ensureLocalDurability();
        expect((await dbA.posts.get(documentId))?.title).toBe('Renamed document');
        expect(editor.getText()).toBe('A original body');
    });

    it.each(['clean', 'dirty'] as const)('reconciles a synced document while preserving a %s editor buffer', async (mode) => {
        const { dbA, editor } = await mountedWorkspaces();
        if (mode === 'dirty') {
            editor.commands.setContent(content('Unsent local edit'), { emitUpdate: true });
        }
        // Incoming sync writes Dexie directly, without a document CRUD hook.
        await dbA.posts.update(documentId, {
            title: 'Remote title', content: JSON.stringify(content('Remote body')), clock: 20,
        });
        if (mode === 'clean') {
            await vi.waitFor(() => expect(wrapper!.getComponent(Title).props('modelValue')).toBe('Remote title'));
            expect(editor.getText()).toBe('Remote body');
        } else {
            const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
            await expect(getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' })!.ensureLocalDurability()).rejects.toThrow();
            expect(editor.getText()).toBe('Unsent local edit');
            expect((await dbA.posts.get(documentId))?.content).toContain('Remote body');
        }
    });

    // Shared store state must not let a stale split pane replace another pane's
    // committed content, or acknowledge an independently changed editor buffer.
    it.each(['clean', 'dirty', 'retained'] as const)('keeps a %s same-document split pane safe after its peer saves', async (mode) => {
        const { dbA, idA, idB, editor: firstEditor, currentEditor } = await mountedWorkspaces();
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        let peer = shallowMount(DocumentEditorRoot, {
            props: { documentId, paneId: 'peer-pane', tabId: 'peer-tab' },
            global: { directives: { theme: () => {} }, stubs: {
                UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true,
            } },
        });
        try {
            await vi.waitFor(() => expect(peer.emitted('ready')).toEqual([[documentId]]));
            let peerEditor = currentEditor();
            const first = getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' })!;
            let second = getDocumentEditorSession({ paneId: 'peer-pane', tabId: 'peer-tab' })!;
            firstEditor.commands.setContent(content('First pane committed body'), { emitUpdate: true });
            if (mode !== 'clean') {
                peerEditor.commands.setTextSelection(peerEditor.state.doc.content.size - 1);
                peerEditor.commands.insertContent(' with an independent draft');
            }
            await first.ensureLocalDurability();
            if (mode === 'clean') {
                await vi.waitFor(() => expect(peerEditor.getText()).toBe('First pane committed body'));
                peerEditor.commands.setTextSelection(peerEditor.state.doc.content.size - 1);
                peerEditor.commands.insertContent(' plus the second pane');
                await second.ensureLocalDurability();
                expect((await dbA.posts.get(documentId))?.content).toContain('First pane committed body plus the second pane');
                await vi.waitFor(() => expect(firstEditor.getText()).toBe('First pane committed body plus the second pane'));
            } else {
                await expect(second.ensureLocalDurability()).rejects.toThrow(/another pane/i);
                expect(peerEditor.getText()).toBe('A original body with an independent draft');
                expect((await dbA.posts.get(documentId))?.content).toContain('First pane committed body');
                expect(peer.get('[role="alert"]').text()).toContain('undo');
                if (mode === 'retained') {
                    setActiveWorkspaceDb(idB);
                    peer.unmount(); wrapper!.unmount(); wrapper = undefined;
                    await flushPromises();
                    setActiveWorkspaceDb(idA);
                    await releaseDocument(documentId, { flush: false });
                    setActiveWorkspaceDb(idB);
                    evictWorkspaceDb(idA);
                    const reopened = setActiveWorkspaceDb(idA);
                    peer = shallowMount(DocumentEditorRoot, {
                        props: { documentId, paneId: 'restored-peer-pane', tabId: 'peer-tab' },
                        global: { directives: { theme: () => {} }, stubs: {
                            UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true,
                        } },
                    });
                    await vi.waitFor(() => expect(peer.emitted('ready')).toEqual([[documentId]]));
                    peerEditor = currentEditor();
                    second = getDocumentEditorSession({ paneId: 'restored-peer-pane', tabId: 'peer-tab' })!;
                    expect(peerEditor.getText()).toBe('A original body with an independent draft');
                    expect(peer.get('[role="alert"]').text()).toContain('undo');
                    expect((await reopened.posts.get(documentId))?.content).toContain('First pane committed body');
                }
                peerEditor.commands.undo();
                await second.ensureLocalDurability();
                expect(peerEditor.getText()).toBe('First pane committed body');
                expect(peer.find('[role="alert"]').exists()).toBe(false);
            }
        } finally { peer.unmount(); await flushPromises(); }
    });

    it('saves the first edit in a newly created empty document without a false split conflict', async () => {
        const { dbA, currentEditor } = await mountedWorkspaces();
        const created = await createDocumentInDb(dbA);
        await wrapper!.setProps({ documentId: created.id });
        await vi.waitFor(() => expect(wrapper!.emitted('ready')).toContainEqual([created.id]));
        currentEditor().commands.insertContent('First typed text');
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        const session = getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' })!;
        await session.ensureLocalDurability();
        expect((await dbA.posts.get(created.id))?.content).toContain('First typed text');
        expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
        await releaseDocument(created.id, { flush: false });
    });

    // Cold unavailable loads must not become blank editors or block tab-close
    // durability; restoring a cold Trash tab must hydrate the actual saved body.
    it.each(['trashed', 'missing'] as const)('keeps a cold %s document closable without pretending it loaded', async (availability) => {
        const { dbA } = await mountedWorkspaces(availability);
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        const session = getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' });
        expect(session).toBeDefined();
        await expect(session!.ensureLocalDurability()).resolves.toBeUndefined();
        expect(wrapper!.findComponent(Title).exists()).toBe(false);
        expect(wrapper!.get('[role="status"]').text()).toContain(availability === 'trashed' ? 'Trash' : 'unavailable');
        if (availability === 'missing') {
            expect(wrapper!.text()).not.toContain('Restore');
        } else {
            const row = (await dbA.posts.get(documentId))!;
            expect(row.content).toContain('A original body');
            await dbA.posts.update(documentId, { meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: null } }) });
            await vi.waitFor(() => expect(wrapper!.getComponent(Title).props('modelValue')).toBe('A private title'));
            expect(wrapper!.text()).not.toContain('Restore it');
            expect((await dbA.posts.get(documentId))?.content).toBe(row.content);
        }
    });

    it('does not commit an image intake after its originating editor unmounts', async () => {
        vi.stubGlobal('Blob', NodeBlob);
        vi.stubGlobal('Image', undefined);
        const { dbA, hooks, editor } = await mountedWorkspaces(undefined, true);
        expect(editor.isDestroyed).toBe(false);
        await vi.waitFor(() => expect(editor.isEditable).toBe(true));
        let entered = false; let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        hooks.addFilter('db.files.create:filter:input', async value => { entered = true; await gate; return value; });
        const files = await import('~/db/files'); const create = files.createOrRefFile;
        const pending: Promise<unknown>[] = [];
        vi.spyOn(files, 'createOrRefFile').mockImplementation((...args) => {
            const result = create(...args); pending.push(result.catch(() => undefined)); return result;
        });
        const image = new NodeBlob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82])], { type: 'image/png' });
        Object.defineProperty(image, 'name', { value: 'synthetic-delayed-intake.png' });
        const input = wrapper!.get('input[type="file"]');
        Object.defineProperty(input.element, 'files', { value: [image], configurable: true });
        try {
            await input.trigger('change');
            await vi.waitFor(() => expect(entered).toBe(true));
            wrapper!.unmount(); wrapper = undefined;
            release(); await Promise.all(pending); await flushPromises();
            expect(await dbA.file_meta.count()).toBe(0);
            expect(await dbA.file_blobs.count()).toBe(0);
            expect((await dbA.posts.get(documentId))?.content).not.toContain('or3Image');
        } finally { release(); await Promise.all(pending); await flushPromises(); }
    });

    it('reports an image intake storage failure and preserves the document through a successful retry', async () => {
        vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('Image', undefined);
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
        const { dbA, editor } = await mountedWorkspaces(undefined, true);
        await vi.waitFor(() => expect(editor.isEditable).toBe(true));
        const files = await import('~/db/files'); const create = files.createOrRefFile;
        const pending: Promise<unknown>[] = [];
        vi.spyOn(files, 'createOrRefFile').mockImplementation((...args) => {
            const result = create(...args); pending.push(result.catch(() => undefined)); return result;
        });
        const image = new NodeBlob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82])], { type: 'image/png' });
        Object.defineProperty(image, 'name', { value: 'synthetic-retry-intake.png' });
        const input = wrapper!.get('input[type="file"]');
        Object.defineProperty(input.element, 'files', { value: [image], configurable: true });
        const quota = vi.spyOn(dbA.file_blobs, 'put').mockRejectedValue(new DOMException('Synthetic image quota', 'QuotaExceededError'));
        await input.trigger('change'); await Promise.all(pending); await flushPromises();
        expect(wrapper!.get('[role="alert"]').text()).toContain('Image could not be added');
        expect(await dbA.file_meta.count()).toBe(0); expect(await dbA.file_blobs.count()).toBe(0);
        expect((await dbA.posts.get(documentId))?.content).toContain('A original body');
        quota.mockRestore();
        await input.trigger('change'); await Promise.all(pending); await flushPromises();
        expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
        const saved = (await dbA.file_meta.toArray())[0]!;
        expect(JSON.stringify(editor.getJSON())).toContain(saved.hash);
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        await getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' })!.ensureLocalDurability();
        expect((await dbA.posts.get(documentId))?.file_hashes).toContain(saved.hash);
        expect(await dbA.file_meta.count()).toBe(1); expect(await dbA.file_blobs.count()).toBe(1);
    });

    it('still blocks tab-close durability when real unsaved edits fail to persist', async () => {
        const { dbA, editor } = await mountedWorkspaces();
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        editor.commands.setContent(content('Keep this unsaved body'), { emitUpdate: true });
        const put = vi.spyOn(dbA.posts, 'put').mockRejectedValue(new Error('Disk unavailable'));
        const session = getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' });
        await expect(session!.ensureLocalDurability()).rejects.toThrow();
        expect(JSON.stringify(useDocumentState(documentId, dbA).pendingContent)).toContain('Keep this unsaved body');
        put.mockRestore();
        await session!.ensureLocalDurability();
        expect((await dbA.posts.get(documentId))?.content).toContain('Keep this unsaved body');
    });

    it('preserves an edit made immediately before Trash instead of allowing it to be lost on close', async () => {
        const { dbA, editor } = await mountedWorkspaces();
        const { getDocumentEditorSession } = await import('~/composables/documents/useDocumentEditorSessions');
        editor.commands.setContent(content('Edit before Trash'), { emitUpdate: true });
        await dbA.posts.update(documentId, { meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: 1 } }) });
        await vi.waitFor(() => expect(editor.isEditable).toBe(false));
        const session = getDocumentEditorSession({ paneId: 'fixture-pane', tabId: 'fixture-tab' });
        await expect(session!.ensureLocalDurability()).rejects.toThrow();
        expect(JSON.stringify(useDocumentState(documentId, dbA).pendingContent)).toContain('Edit before Trash');
        await dbA.posts.update(documentId, { meta: JSON.stringify({ 'or3.workspace-item': { version: 1, trashed_at: null } }) });
        await vi.waitFor(() => expect(editor.isEditable).toBe(true));
        await session!.ensureLocalDurability();
        expect((await dbA.posts.get(documentId))?.content).toContain('Edit before Trash');
    });

    it('makes retained trashed documents read-only and restores editing without deleting content', async () => {
        const { dbA, editor } = await mountedWorkspaces();
        const { updateWorkspaceFile } = await import('~/db/workspace-files');
        const { workspaceRevision } = await import('~/utils/chat/workspace-items');
        const scope = { db: dbA, workspaceId: 'local', signal: new AbortController().signal,
            writable: true, assertCurrent() {} } as never;
        const before = (await dbA.posts.get(documentId))!;
        const trashed = await updateWorkspaceFile(scope, documentId, await workspaceRevision(before), { trashed: true });
        await vi.waitFor(() => expect(editor.isEditable).toBe(false));
        expect((await dbA.posts.get(documentId))?.content).toBe(before.content);
        await updateWorkspaceFile(scope, documentId, await workspaceRevision(trashed), { trashed: false });
        await vi.waitFor(() => expect(editor.isEditable).toBe(true));
    });
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
                vi.spyOn(dbA.posts, 'get').mockImplementationOnce(() => { afterCommitRead = true; throw new Error('Injected post-commit read failure'); });
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
    it.each(['after commit', 'during write'] as const)('keeps Apply when a second real pane finishes a cold editor load $phase', async (phase) => {
        vi.stubGlobal('Blob', NodeBlob);
        const originalAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
        testRuntimeConfig.value.public.ssrAuthEnabled = false;
        const { dbA, idA, currentEditor } = await mountedWorkspaces();
        const dispose = registerWorkspaceChatTools();
        const registry = useToolRegistry();
        let latePane: VueWrapper | undefined;
        let release!: () => void;
        let finishWrite: (() => void) | undefined;
        try {
            await dbA.messages.put({ id: 'late-pane-message', thread_id: 'mounted-thread', role: 'assistant',
                data: { content: '' }, created_at: 1, updated_at: 1, deleted: false, clock: 1, pending: false, index: 0 });
            const context = { subject: null, workspaceId: idA, threadId: 'mounted-thread', messageId: 'late-pane-message',
                requestId: 'late-pane-request', callId: 'late-read', abortSignal: new AbortController().signal };
            const read = await registry.executeTool('workspace_read', JSON.stringify({ item: { kind: 'document', id: documentId } }),
                context, { definition: registry.getTool('workspace_read')!.definition });
            expect(read.error).toBeUndefined();
            const proposal = await registry.executeTool('workspace_propose_document_edit', JSON.stringify({
                documentId, readId: JSON.parse(read.result!).readId,
                operations: [{ kind: 'replace_block', ref: 'b1', content: content('Applied while pane loads').content }],
            }), { ...context, callId: 'late-proposal' }, { definition: registry.getTool('workspace_propose_document_edit')!.definition });
            expect(proposal.error).toBeUndefined();
            const realLoad = documentSchema.loadDocumentEditorExtensions;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            let entered!: () => void;
            const loading = new Promise<void>((resolve) => { entered = resolve; });
            // Delay only the real pane's cold extension boundary; Apply still validates the actual schema.
            vi.spyOn(documentSchema, 'loadDocumentEditorExtensions').mockImplementationOnce(async () => {
                const extensions = await realLoad(); entered(); await gate; return extensions;
            });
            latePane = shallowMount(DocumentEditorRoot, {
                props: { documentId, paneId: 'late-pane', tabId: 'late-tab' },
                global: { directives: { theme: () => {} }, stubs: {
                    UTextarea: Title, USelect: true, UDropdownMenu: true, UFormField: true, USwitch: true,
                } },
            });
            await loading;
            if (phase === 'after commit') {
                expect((await applyWorkspaceDocumentChange(JSON.parse(proposal.result!))).status).toBe('applied');
                release();
            } else {
                const realPut = dbA.posts.put.bind(dbA.posts);
                const writeGate = new Promise<void>((resolve) => { finishWrite = resolve; });
                let writeEntered!: () => void;
                const writing = new Promise<void>((resolve) => { writeEntered = resolve; });
                vi.spyOn(dbA.posts, 'put').mockImplementationOnce((...args: Parameters<typeof realPut>) => realPut(...args).then((id) => {
                    writeEntered(); return Dexie.waitFor(writeGate).then(() => id);
                }));
                const applying = applyWorkspaceDocumentChange(JSON.parse(proposal.result!));
                await writing;
                release();
                await vi.waitFor(() => expect(latePane!.emitted('ready')).toEqual([[documentId]]));
                finishWrite!();
                expect((await applying).status).toBe('applied');
            }
            await vi.waitFor(() => expect(latePane!.emitted('ready')).toEqual([[documentId]]));
            expect(JSON.stringify(currentEditor().getJSON())).toContain('Applied while pane loads');
            latePane.unmount(); latePane = undefined;
            await flushPromises(); await flush(documentId, dbA);
            expect((await dbA.posts.get(documentId))?.content).toContain('Applied while pane loads');
        } finally {
            release?.(); finishWrite?.(); latePane?.unmount(); dispose(); testRuntimeConfig.value.public.ssrAuthEnabled = originalAuth;
        }
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
        await flushPromises();
        expect((await dbB.posts.get(documentId))?.title).toBe('B title');
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
        await vi.waitFor(() => expect(useAllDocumentsState().has(documentId)).toBe(false));
        expect(JSON.stringify((await getDocumentInDb(dbA, documentId))?.content)).toContain('A owner edit');
    });
});
