import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { registerDocumentEditorSession } from '~/composables/documents/useDocumentEditorSessions';
import { setWorkspaceTabPaletteProvider } from '~/core/search/command-palette/sources/workspace-tab-source';
import { evictWorkspaceDb, getDb, setActiveWorkspaceDb, Or3DB } from '~/db/client';
import { flush, loadDocument, setDocumentContent, useDocumentState } from '~/composables/documents/useDocumentsStore';
import { getDocumentInDb } from '~/db/documents';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine } from '~/core/hooks/useHooks';
import { registerDocumentChatTools } from '../document-chat-tools';
import { registerWorkspaceChatTools } from '~/utils/chat/workspace-chat-tools';
import { testRuntimeConfig } from '~~/tests/setup';
import { workspaceRevision } from '~/utils/chat/workspace-items';

const disposers: Array<() => void> = [];
let originalSsrAuth: boolean;
beforeEach(async () => {
    vi.stubGlobal('Blob', NodeBlob);
    originalSsrAuth = testRuntimeConfig.value.public.ssrAuthEnabled;
    testRuntimeConfig.value.public.ssrAuthEnabled = false;
    setHookEngine(createTypedHookEngine(createHookEngine()));
    await setActiveWorkspaceDb('workspace-a').open();
});
afterEach(async () => {
    testRuntimeConfig.value.public.ssrAuthEnabled = originalSsrAuth;
    while (disposers.length) disposers.pop()?.();
    const name = getDb().name;
    setActiveWorkspaceDb(null);
    evictWorkspaceDb('workspace-a');
    await Dexie.delete(name);
    setHookEngine(null);
    vi.unstubAllGlobals();
});

describe('chat document tools', () => {
    async function pendingChange() {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        await getDb().posts.put({ id: 'apply-doc', title: 'Apply draft', postType: 'doc',
            content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original apply paragraph"}]}]}',
            meta: '{"unrelated":"retain"}', created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        await getDb().messages.put({ id: 'apply-message', thread_id: 'thread-a', role: 'assistant',
            data: { content: 'Model prose cannot mark this saved', unrelated: 'retain' }, created_at: 1,
            updated_at: 1, deleted: false, clock: 1, index: 0, pending: false });
        const context = { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a', messageId: 'apply-message',
            callId: 'apply-read', requestId: 'apply-request', abortSignal: new AbortController().signal };
        const read = await registry.executeTool('workspace_read', '{"item":{"kind":"document","id":"apply-doc"}}',
            context, { definition: registry.getTool('workspace_read')!.definition });
        expect(read.error).toBeUndefined();
        const proposed = await registry.executeTool('workspace_propose_document_edit', JSON.stringify({
            documentId: 'apply-doc', readId: JSON.parse(read.result!).readId, operations: [
                { kind: 'replace_block', ref: 'b1', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Applied paragraph' }] }] },
            ],
        }), { ...context, callId: 'apply-proposal' }, { definition: registry.getTool('workspace_propose_document_edit')!.definition });
        expect(proposed.error).toBeUndefined();
        return { ref: JSON.parse(proposed.result!), context };
    }
    it('commits checkpoint/content/action once across concurrent Apply and guards Undo after later edits', async () => {
        const { ref } = await pendingChange();
        const changes = await import('~/utils/chat/workspace-document-change');
        expect(changes).toHaveProperty('applyWorkspaceDocumentChange');
        const applied = await Promise.all([changes.applyWorkspaceDocumentChange(ref), changes.applyWorkspaceDocumentChange(ref)]);
        expect(applied.every((receipt) => receipt.status === 'applied')).toBe(true);
        const saved = await getDb().posts.get('apply-doc');
        expect(saved?.content).toContain('Applied paragraph');
        expect(saved?.clock).toBe(2);
        expect(saved?.meta).toContain('unrelated');
        expect(await getDb().posts.where('postType').equals('or3:document-revision').count()).toBe(1);
        expect((await getDb().messages.get('apply-message'))?.data).toMatchObject({ unrelated: 'retain' });
        await getDb().posts.update('apply-doc', { content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Later user edit"}]}]}', clock: 3 });
        await expect(changes.undoWorkspaceDocumentChange(ref)).rejects.toThrow(/history|later|changed/i);
        expect((await getDb().posts.get('apply-doc'))?.content).toContain('Later user edit');
    });
    it('refuses stale Apply and leaves the changed document intact', async () => {
        const { ref } = await pendingChange();
        await getDb().posts.update('apply-doc', { content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Newer user draft"}]}]}', clock: 2 });
        const changes = await import('~/utils/chat/workspace-document-change');
        expect(changes).toHaveProperty('applyWorkspaceDocumentChange');
        await expect(changes.applyWorkspaceDocumentChange(ref)).rejects.toThrow(/changed|proposal/i);
        expect((await getDb().posts.get('apply-doc'))?.content).toContain('Newer user draft');
        expect(await getDb().posts.where('postType').equals('or3:document-revision').count()).toBe(0);
    });
    it('retains a second tab draft instead of autosaving it over committed Apply', async () => {
        const { ref } = await pendingChange();
        const otherTab = new Or3DB(getDb().name);
        try {
            await otherTab.open();
            await loadDocument('apply-doc', otherTab);
            const oldDraft = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second tab pending draft' }] }] };
            setDocumentContent('apply-doc', oldDraft, otherTab);
            const { applyWorkspaceDocumentChange } = await import('~/utils/chat/workspace-document-change');
            expect((await applyWorkspaceDocumentChange(ref)).status).toBe('applied');
            await flush('apply-doc', otherTab);
            expect((await getDb().posts.get('apply-doc'))?.content).toContain('Applied paragraph');
            expect(useDocumentState('apply-doc', otherTab)).toMatchObject({ status: 'error', pendingContent: oldDraft });
        } finally {
            // Dispose only this synthetic unsaved draft after proving it survived the failed save.
            const state = useDocumentState('apply-doc', otherTab);
            state.pendingContent = undefined; state.pendingTitle = undefined;
            otherTab.close();
        }
    });
    it('rolls back content and checkpoint on receipt-write failure, then permits a recoverable retry and Undo', async () => {
        const { ref } = await pendingChange();
        const changes = await import('~/utils/chat/workspace-document-change');
        expect(changes).toHaveProperty('applyWorkspaceDocumentChange');
        const realPut = getDb().messages.put.bind(getDb().messages);
        const put = vi.spyOn(getDb().messages, 'put').mockImplementationOnce(() => { throw new Error('Injected durable receipt failure'); });
        try {
            await expect(changes.applyWorkspaceDocumentChange(ref)).rejects.toThrow(/receipt failure/i);
            expect((await getDb().posts.get('apply-doc'))?.content).toContain('Original apply paragraph');
            expect(await getDb().posts.where('postType').equals('or3:document-revision').count()).toBe(0);
        } finally { put.mockImplementation(realPut); put.mockRestore(); }
        expect((await changes.applyWorkspaceDocumentChange(ref)).status).toBe('applied');
        expect((await changes.undoWorkspaceDocumentChange(ref)).status).toBe('undone');
        expect((await getDb().posts.get('apply-doc'))?.content).toContain('Original apply paragraph');
    });
    it('stages a durable document proposal from exposed read blocks without saving the candidate', async () => {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        await getDb().posts.put({ id: 'proposal-doc', title: 'Review draft', postType: 'doc',
            content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original paragraph"}]}]}',
            created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        await getDb().messages.put({ id: 'assistant-a', thread_id: 'thread-a', role: 'assistant', data: { content: '' },
            created_at: 1, updated_at: 1, deleted: false, clock: 1, index: 0, pending: false });
        const context = { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a',
            messageId: 'assistant-a', callId: 'read-for-proposal', requestId: 'proposal-request',
            abortSignal: new AbortController().signal };
        const propose = registry.getTool('workspace_propose_document_edit');
        expect(propose, 'normal chat advertises one reviewable edit tool').toBeDefined();
        const readTool = registry.getTool('workspace_read')!;
        const read = await registry.executeTool('workspace_read', '{"item":{"kind":"document","id":"proposal-doc"}}',
            context, { definition: readTool.definition });
        expect(read.error).toBeUndefined();
        const receipt = JSON.parse(read.result!);
        expect(receipt.readId).toEqual(expect.any(String));
        expect(receipt.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ ref: 'b1', text: 'Original paragraph' })]));
        const staged = await registry.executeTool('workspace_propose_document_edit', JSON.stringify({
            documentId: 'proposal-doc', readId: receipt.readId, operations: [{ kind: 'replace_block', ref: 'b1', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Proposed paragraph' }] },
            ] }],
        }), { ...context, callId: 'proposal-call' }, { definition: propose!.definition });
        expect(staged.error).toBeUndefined();
        expect(JSON.parse(staged.result!)).toMatchObject({ status: 'pending_review', documentId: 'proposal-doc' });
        expect((await getDb().posts.get('proposal-doc'))?.content).toContain('Original paragraph');
        expect((await getDb().posts.get('proposal-doc'))?.content).not.toContain('Proposed paragraph');
        expect(JSON.stringify((await getDb().messages.get('assistant-a'))?.data)).toContain('pending');
        const forged = await registry.executeTool('workspace_propose_document_edit', JSON.stringify({
            documentId: 'proposal-doc', readId: receipt.readId, operations: [{ kind: 'delete_block', ref: 'b99' }],
        }), { ...context, callId: 'forged-proposal' }, { definition: propose!.definition });
        expect(forged.error).toMatch(/exposed|reference/i);
    });
    it('refuses disagreement between live document buffers before flushing either', async () => {
        disposers.push(registerWorkspaceChatTools());
        const flush = vi.fn(async () => undefined);
        for (const [tabId, text] of [['tab-one', 'first draft'], ['tab-two', 'second draft']]) {
            disposers.push(registerDocumentEditorSession({
                documentId: 'conflicted-doc', paneId: tabId, tabId, captureContent: () => undefined,
                ensureLocalDurability: flush, captureViewState: () => ({ version: 1, documentId: 'conflicted-doc', scrollTop: 0 }),
                restoreViewState: async () => undefined,
                getDocumentSnapshot: () => ({ title: 'Draft', content: { type: 'doc', content: [
                    { type: 'paragraph', content: [{ type: 'text', text }] },
                ] } }),
            }));
        }
        const registry = useToolRegistry();
        const tool = registry.getTool('workspace_read')!;
        const result = await registry.executeTool('workspace_read', '{"item":{"kind":"document","id":"conflicted-doc"}}',
            { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a', messageId: null,
                callId: 'conflict-read', requestId: 'conflict-request', abortSignal: new AbortController().signal },
            { definition: tool.definition });
        expect(result.error).toMatch(/reconcile|disagree/i);
        expect(flush).not.toHaveBeenCalled();
    });
    it('rejects source content changed while its revision is being computed', async () => {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        await getDb().posts.put({ id: 'changing-doc', title: 'Changing', postType: 'doc',
            content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"old secret"}]}]}',
            created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const hashing = new Promise<void>((resolve) => { entered = resolve; });
        const realDigest = crypto.subtle.digest.bind(crypto.subtle);
        const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, bytes) => {
            entered(); await gate; return realDigest(algorithm, bytes);
        });
        try {
            const tool = registry.getTool('workspace_read')!;
            const pending = registry.executeTool('workspace_read', '{"item":{"kind":"document","id":"changing-doc"}}',
                { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a', messageId: null,
                    callId: 'changing-read', requestId: 'changing-request', abortSignal: new AbortController().signal },
                { definition: tool.definition });
            await hashing;
            await getDb().posts.update('changing-doc', { content: '{"type":"doc","content":[]}', clock: 2 });
            release();
            expect((await pending).error).toMatch(/changed/i);
        } finally { release(); spy.mockRestore(); }
    });
    it('keeps actual shared Orama token and fuzzy matches while refusing changed current content', async () => {
        const { registerPaletteSource } = await import('~/core/search/command-palette/registry');
        const { createDocumentPaletteSource } = await import('~/core/search/command-palette/sources/document-source');
        const { useCommandPalette, disposeCommandPalette } = await import('~/composables/search/useCommandPalette');
        const handle = registerPaletteSource(createDocumentPaletteSource());
        disposers.push(() => { disposeCommandPalette(); handle.dispose(); });
        disposers.push(registerWorkspaceChatTools());
        await getDb().posts.put({ id: 'token-match', title: 'Planning', postType: 'doc',
            content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'launch budget approved' }] }] }),
            created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        const palette = useCommandPalette(); await palette.warm();
        const coordinator = palette.getCoordinator()!;
        const registry = useToolRegistry();
        const context = { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a', messageId: null,
            requestId: 'token-search', callId: 'token-call', abortSignal: new AbortController().signal };
        for (const query of ['budget launch', 'budjet']) {
            const indexed = await coordinator.searchOnce({ term: query, sourceIds: ['document'], limit: 20 });
            expect(indexed.results.map((result) => result.recordId)).toContain('token-match');
            const reply = await registry.executeTool('workspace_search', JSON.stringify({ query, kinds: ['document'] }),
                context, { definition: registry.getTool('workspace_search')!.definition });
            expect(reply.error).toBeUndefined();
            expect(JSON.parse(reply.result!).results).toEqual([expect.objectContaining({ source: expect.objectContaining({ id: 'token-match' }), excerpt: 'launch budget approved' })]);
        }
        await getDb().posts.update('token-match', { content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Removed evidence' }] }] }), clock: 2 });
        const stale = await registry.executeTool('workspace_search', JSON.stringify({ query: 'budget launch', kinds: ['document'] }), context,
            { definition: registry.getTool('workspace_search')!.definition });
        expect(stale.error).toBeUndefined();
        expect(JSON.parse(stale.result!).results).toEqual([]);
        expect(JSON.parse(stale.result!).partial).toBe(true);
        expect(stale.result).not.toContain('launch budget approved');
    });
    it.each(['document', 'project'].flatMap((operation) => ['abort', 'workspace', 'authorization'].map((interruption) => ({ operation, interruption }))))
    ('rolls back $operation creation when $interruption changes during the transaction read', async ({ operation, interruption }) => {
        const sessionModule = await import('~/composables/auth/useSessionContext');
        let session: import('~/core/hooks/hook-types').SessionContext = { authenticated: true, user: { id: 'owner-a' },
            workspace: { id: 'workspace-a', name: 'A' }, role: 'owner', authorizationRevision: 1 };
        if (interruption === 'authorization') {
            testRuntimeConfig.value.public.ssrAuthEnabled = true;
            vi.spyOn(sessionModule, 'getCachedSessionContext').mockImplementation(() => session);
        }
        disposers.push(registerWorkspaceChatTools());
        const db = getDb();
        const controller = new AbortController();
        let interrupted = false;
        const interrupt = () => {
            if (!Dexie.currentTransaction || interrupted) return;
            interrupted = true;
            if (interruption === 'abort') controller.abort();
            else if (interruption === 'workspace') setActiveWorkspaceDb('interrupted-workspace');
            else session = { ...session, role: 'viewer', authorizationRevision: 2 };
        };
        const table = operation === 'document' ? db.posts : db.projects;
        const get = table.get.bind(table);
        const spy = vi.spyOn(table, 'get').mockImplementation((...args: Parameters<typeof get>) => get(...args).then((row) => {
            interrupt(); return row;
        }));
        try {
            const registry = useToolRegistry();
            const name = operation === 'document' ? 'workspace_create_document' : 'workspace_update_project';
            const reply = await registry.executeTool(name, JSON.stringify(operation === 'document'
                ? { title: 'Never committed', content: { type: 'doc', content: [{ type: 'paragraph' }] } }
                : { operation: 'create', name: 'Never committed' }),
                { subject: interruption === 'authorization' ? 'owner-a' : null, workspaceId: 'workspace-a', threadId: 'thread-a', messageId: null,
                    requestId: `interrupted-${operation}`, callId: interruption, abortSignal: controller.signal },
                { definition: registry.getTool(name)!.definition });
            expect(interrupted).toBe(true);
            expect(reply.error).toMatch(/abort|workspace|access/i);
            spy.mockRestore();
            expect(await db.posts.count()).toBe(0);
            expect(await db.projects.count()).toBe(0);
            expect(await db.pending_ops.count()).toBe(0);
        } finally {
            spy.mockRestore(); vi.restoreAllMocks(); setActiveWorkspaceDb('workspace-a');
            evictWorkspaceDb('interrupted-workspace'); testRuntimeConfig.value.public.ssrAuthEnabled = false;
        }
    });
    it('reads the same visible project membership used by scoped search including legacy pointers', async () => {
        const { registerPaletteSource } = await import('~/core/search/command-palette/registry');
        const { createChatPaletteSource } = await import('~/core/search/command-palette/sources/chat-source');
        const { disposeCommandPalette } = await import('~/composables/search/useCommandPalette');
        const handle = registerPaletteSource(createChatPaletteSource());
        disposers.push(() => { disposeCommandPalette(); handle.dispose(); });
        disposers.push(registerWorkspaceChatTools());
        await getDb().projects.put({ id: 'membership-project', name: 'Members', data: [
            { kind: 'doc', id: 'visible-doc' }, { kind: 'document', id: 'visible-doc' }, { kind: 'doc', id: 'deleted-doc' },
            { kind: 'chat', id: 'foreign-chat' },
        ], created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        for (const [id, deleted] of [['visible-doc', false], ['deleted-doc', true]] as const) {
            await getDb().posts.put({ id, deleted, title: id, postType: 'doc', content: '{"type":"doc","content":[]}', created_at: 1, updated_at: 1, clock: 1 });
        }
        for (const [id, project, deleted] of [['legacy-chat', 'membership-project', false], ['deleted-chat', 'membership-project', true], ['other-project-chat', 'different-project', false]] as const) {
            await getDb().threads.put({ id, title: 'legacy-link', project_id: project, status: 'ready', deleted, pinned: false, forked: false,
                created_at: 1, updated_at: 1, clock: 1 });
        }
        const registry = useToolRegistry();
        const context = { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a', messageId: null,
            requestId: 'membership-read', callId: 'read', abortSignal: new AbortController().signal };
        const read = await registry.executeTool('workspace_read', '{"item":{"kind":"project","id":"membership-project"}}', context,
            { definition: registry.getTool('workspace_read')!.definition });
        expect(read.error).toBeUndefined();
        expect(JSON.parse(JSON.parse(read.result!).content).entries).toEqual([
            { kind: 'document', id: 'visible-doc' }, { kind: 'chat', id: 'legacy-chat' },
        ]);
        const search = await registry.executeTool('workspace_search', '{"query":"legacy-link","projectId":"membership-project","kinds":["chat"]}',
            context, { definition: registry.getTool('workspace_search')!.definition });
        expect(search.error).toBeUndefined();
        expect(JSON.parse(search.result!).results.map((hit: { source: { id: string } }) => hit.source.id)).toEqual(['legacy-chat']);
    });
    it('associates a new document atomically and preserves unknown project entries', async () => {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        const project = { id: 'project-a', name: 'Project A', data: [
            { kind: 'plugin-private', id: 'private-record', extra: 'retain' },
        ], created_at: 1, updated_at: 1, deleted: false, clock: 1 };
        await getDb().projects.put(project);
        const context = { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a',
            messageId: null, callId: 'association-call', requestId: 'association-request',
            abortSignal: new AbortController().signal };
        const tool = registry.getTool('workspace_create_document')!;
        const args = { title: 'Associated result', content: { type: 'doc', content: [{ type: 'paragraph' }] },
            project: { id: project.id, revision: await workspaceRevision(project) } };
        const created = await registry.executeTool('workspace_create_document', JSON.stringify(args), context,
            { definition: tool.definition });
        expect(created.error).toBeUndefined();
        const id = JSON.parse(created.result!).source.id;
        expect((await getDb().projects.get(project.id))?.data).toEqual([
            project.data[0], { kind: 'doc', id, name: 'Associated result' },
        ]);
        const readProject = await registry.executeTool('workspace_read', JSON.stringify({ item: { kind: 'project', id: project.id } }),
            context, { definition: registry.getTool('workspace_read')!.definition });
        expect(readProject.error).toBeUndefined();
        expect(readProject.result).not.toContain('private-record');
        expect(readProject.result).not.toContain('plugin-private');
        const stale = await registry.executeTool('workspace_create_document', JSON.stringify(args),
            { ...context, callId: 'stale-association' }, { definition: tool.definition });
        expect(stale.error).toMatch(/changed/i);
        expect(await getDb().posts.count()).toBe(1);
    });
    it('updates a project by read revision and removes association without deleting its document', async () => {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        const project = { id: 'project-a', name: 'Project A', data: [
            { kind: 'plugin-private', id: 'private-record', extra: 'retain' },
            { kind: 'doc', id: 'document-a' },
        ], created_at: 1, updated_at: 1, deleted: false, clock: 1 };
        await getDb().projects.put(project);
        await getDb().posts.put({ id: 'document-a', title: 'Keep me', postType: 'doc',
            content: '{"type":"doc","content":[{"type":"paragraph"}]}', created_at: 1, updated_at: 1, deleted: false, clock: 1 });
        const context = { subject: null, workspaceId: 'workspace-a', threadId: 'thread-a',
            messageId: null, callId: 'project-call', requestId: 'project-request',
            abortSignal: new AbortController().signal };
        const tool = registry.getTool('workspace_update_project');
        expect(tool).toBeDefined();
        const revision = await workspaceRevision(project);
        const result = await registry.executeTool('workspace_update_project', JSON.stringify({
            operation: 'remove_item', projectId: project.id, revision, item: { kind: 'document', id: 'document-a' },
        }), context, { definition: tool!.definition });
        expect(result.error).toBeUndefined();
        expect((await getDb().projects.get(project.id))?.data).toEqual([project.data[0]]);
        expect((await getDb().posts.get('document-a'))?.deleted).toBe(false);
        const stale = await registry.executeTool('workspace_update_project', JSON.stringify({
            operation: 'rename', projectId: project.id, revision, name: 'Stale rename',
        }), { ...context, callId: 'stale-rename' }, { definition: tool!.definition });
        expect(stale.error).toMatch(/changed/i);
        expect((await getDb().projects.get(project.id))?.name).toBe('Project A');
    });
    it('creates once per host execution and rejects invalid native content without writing', async () => {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        const context = {
            subject: null, workspaceId: 'workspace-a', threadId: 'thread-a',
            messageId: null, callId: 'create-call', requestId: 'create-request',
            abortSignal: new AbortController().signal,
        };
        const tool = registry.getTool('workspace_create_document');
        expect(tool, 'normal chat advertises native document creation').toBeDefined();
        const args = JSON.stringify({ title: 'Durable result', content: {
            type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Actual saved result' }] }],
        } });
        const first = await registry.executeTool('workspace_create_document', args, context, { definition: tool!.definition });
        expect(first.error).toBeUndefined();
        const receipt = JSON.parse(first.result!);
        const replay = await registry.executeTool('workspace_create_document', args, context, { definition: tool!.definition });
        expect(replay.error).toBeUndefined();
        expect(JSON.parse(replay.result!).source.id).toBe(receipt.source.id);
        expect(await getDb().posts.count()).toBe(1);
        expect((await getDb().posts.get(receipt.source.id))?.content).toContain('Actual saved result');
        const invalid = await registry.executeTool('workspace_create_document', JSON.stringify({
            title: 'Invalid', content: { type: 'doc', content: [{ type: 'unknown-node' }] },
        }), { ...context, callId: 'invalid-call' }, { definition: tool!.definition });
        expect(invalid.error).toBeDefined();
        expect(await getDb().posts.count()).toBe(1);
        const distinct = await registry.executeTool('workspace_create_document', args,
            { ...context, requestId: 'deliberate-new-request' }, { definition: tool!.definition });
        expect(distinct.error).toBeUndefined();
        expect(JSON.parse(distinct.result!).source.id).not.toBe(receipt.source.id);
    });
    it('reads an identified saved document in explicit pages through workspace tools', async () => {
        disposers.push(registerWorkspaceChatTools());
        const registry = useToolRegistry();
        await getDb().posts.put({
            id: 'saved-document', title: 'Saved evidence', postType: 'doc',
            content: JSON.stringify({ type: 'doc', content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'first source paragraph' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'second source paragraph' }] },
            ] }),
            created_at: 1, updated_at: 1, deleted: false, clock: 7,
        });
        const context = {
            subject: null, workspaceId: 'workspace-a', threadId: 'thread-a',
            messageId: null, callId: 'workspace-read', requestId: 'workspace-request',
            abortSignal: new AbortController().signal,
        };
        const tool = registry.getTool('workspace_read');
        expect(tool, 'normal chat advertises workspace_read').toBeDefined();
        const result = await registry.executeTool('workspace_read', JSON.stringify({
            item: { kind: 'document', id: 'saved-document' },
        }), context, { definition: tool!.definition });
        expect(result.error).toBeUndefined();
        const receipt = JSON.parse(result.result!);
        expect(receipt).toMatchObject({
            version: 1, workspaceId: 'workspace-a',
            source: { kind: 'document', id: 'saved-document', title: 'Saved evidence' },
        });
        expect(receipt.content).toContain('first source paragraph');
        expect(await getDb().posts.get('saved-document')).toMatchObject({ clock: 7 });
        await getDb().posts.update('saved-document', { deleted: true });
        const unavailable = await registry.executeTool('workspace_read', JSON.stringify({
            item: { kind: 'document', id: 'saved-document' },
        }), context, { definition: tool!.definition });
        expect(unavailable.error).toMatch(/unavailable/i);
    });

    it('creates a document with content and duplicates its saved content', async () => {
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };
        const createTool = registry.getTool('create_document')!;
        const created = await registry.executeTool(
            'create_document',
            JSON.stringify({ title: 'Release plan', content: '# Milestones\n\nShip it.' }),
            context,
            { definition: createTool.definition },
        );
        expect(created.error).toBeUndefined();
        const originalId = JSON.parse(created.result!).documentId as string;
        const original = await getDocumentInDb(getDb(), originalId);
        expect(original).toMatchObject({ title: 'Release plan', deleted: false });
        expect(JSON.stringify(original?.content)).toContain('Milestones');

        const duplicateTool = registry.getTool('duplicate_document')!;
        const duplicated = await registry.executeTool(
            'duplicate_document',
            JSON.stringify({ documentId: originalId }),
            context,
            { definition: duplicateTool.definition },
        );
        expect(duplicated.error).toBeUndefined();
        const copyId = JSON.parse(duplicated.result!).documentId as string;
        expect(copyId).not.toBe(originalId);
        const copy = await getDocumentInDb(getDb(), copyId);
        expect(copy).toMatchObject({ title: 'Release plan (copy)', deleted: false });
        expect(copy?.content).toEqual(original?.content);
    });

    it('refuses to duplicate a deleted source or write after the workspace changes', async () => {
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };
        const createTool = registry.getTool('create_document')!;
        const duplicateTool = registry.getTool('duplicate_document')!;
        const created = await registry.executeTool(
            'create_document', JSON.stringify({ title: 'Original' }), context,
            { definition: createTool.definition },
        );
        const originalId = JSON.parse(created.result!).documentId as string;
        await getDb().posts.update(originalId, { deleted: true });
        const rejected = await registry.executeTool(
            'duplicate_document', JSON.stringify({ documentId: originalId }), context,
            { definition: duplicateTool.definition },
        );
        expect(rejected.error).toMatch(/no longer available/i);
        expect(await getDb().posts.count()).toBe(1);

        const wrongWorkspace = await registry.executeTool(
            'create_document', JSON.stringify({ title: 'Wrong workspace' }),
            { ...context, workspaceId: 'workspace-b' },
            { definition: createTool.definition },
        );
        expect(wrongWorkspace.error).toMatch(/unavailable|workspace/i);
        expect(await getDb().posts.count()).toBe(1);
    });
    it('targets the open document session and refuses a different workspace', async () => {
        const executeChatTool = vi.fn(() => '{"readableBlockCount":2}');
        disposers.push(setWorkspaceTabPaletteProvider(() => [
            {
                id: 'tab-doc',
                resource: { kind: 'document', documentId: 'doc-a' },
                cachedTitle: 'Draft',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: false,
            },
        ]));
        disposers.push(registerDocumentEditorSession({
            documentId: 'doc-a',
            paneId: 'pane-doc',
            tabId: 'tab-doc',
            captureContent: () => undefined,
            ensureLocalDurability: async () => undefined,
            captureViewState: () => ({ version: 1, documentId: 'doc-a', scrollTop: 0 }),
            restoreViewState: async () => undefined,
            getChatContext: () => '{"documentBlocks":[]}',
            executeChatTool,
        }));
        disposers.push(registerDocumentChatTools());

        const registry = useToolRegistry();
        const tool = registry.getTool('get_document_outline');
        expect(tool).toBeDefined();
        registry.setEnabled('get_document_outline', true);
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };
        const result = await registry.executeTool(
            'get_document_outline',
            '{"documentId":"doc-a"}',
            context,
            { definition: tool!.definition },
        );
        expect(result.result).toBe('{"readableBlockCount":2}');
        expect(executeChatTool).toHaveBeenCalledWith(
            'get_document_outline',
            '{"documentId":"doc-a"}',
            'request-a',
        );

        const wrongWorkspace = await registry.executeTool(
            'get_document_outline',
            '{"documentId":"doc-a"}',
            { ...context, workspaceId: 'workspace-b' },
            { definition: tool!.definition },
        );
        expect(wrongWorkspace.error).toMatch(/unavailable|workspace/i);
        expect(executeChatTool).toHaveBeenCalledTimes(1);
    });

    it('lists open tabs and reads the live editor context', async () => {
        disposers.push(setWorkspaceTabPaletteProvider(() => [
            {
                id: 'tab-doc',
                resource: { kind: 'document', documentId: 'doc-a' },
                cachedTitle: 'Draft',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: false,
            },
        ]));
        disposers.push(registerDocumentEditorSession({
            documentId: 'doc-a',
            paneId: 'pane-doc',
            tabId: 'tab-doc',
            captureContent: () => undefined,
            ensureLocalDurability: async () => undefined,
            captureViewState: () => ({ version: 1, documentId: 'doc-a', scrollTop: 0 }),
            restoreViewState: async () => undefined,
            getChatContext: () => '{"documentBlocks":[{"ref":"b1"}]}',
            executeChatTool: () => '',
        }));
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        registry.setEnabled('get_open_pane_context', true);
        const tool = registry.getTool('get_open_pane_context')!;
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };

        const listed = await registry.executeTool(
            'get_open_pane_context', '{}', context, { definition: tool.definition },
        );
        expect(JSON.parse(listed.result!)).toMatchObject({
            tabs: [{ tabId: 'tab-doc', kind: 'document', documentId: 'doc-a' }],
        });
        const read = await registry.executeTool(
            'get_open_pane_context', '{"tabId":"tab-doc"}', context,
            { definition: tool.definition },
        );
        expect(JSON.parse(read.result!)).toMatchObject({
            tabId: 'tab-doc',
            content: '{"documentBlocks":[{"ref":"b1"}]}',
        });
    });

    it('lists a blank chat and returns that list when tabId is blank or unknown', async () => {
        disposers.push(setWorkspaceTabPaletteProvider(() => [
            {
                id: 'tab-new',
                resource: { kind: 'chat', threadId: null },
                cachedTitle: 'New chat',
                createdAt: 1,
                lastActivatedAt: 2,
                ephemeral: true,
            },
            {
                id: 'tab-doc',
                resource: { kind: 'document', documentId: 'doc-a' },
                cachedTitle: 'Draft',
                createdAt: 1,
                lastActivatedAt: 3,
                ephemeral: false,
            },
            {
                id: 'tab-self',
                resource: { kind: 'chat', threadId: 'thread-a' },
                cachedTitle: 'This chat',
                createdAt: 1,
                lastActivatedAt: 4,
                ephemeral: false,
            },
        ]));
        disposers.push(registerDocumentChatTools());
        const registry = useToolRegistry();
        registry.setEnabled('get_open_pane_context', true);
        const tool = registry.getTool('get_open_pane_context')!;
        const context = {
            subject: null,
            workspaceId: 'workspace-a',
            threadId: 'thread-a',
            messageId: null,
            callId: 'call-a',
            requestId: 'request-a',
            abortSignal: new AbortController().signal,
        };

        const listed = await registry.executeTool(
            'get_open_pane_context', '{"tabId":""}', context, { definition: tool.definition },
        );
        expect(listed.error).toBeUndefined();
        const blank = await registry.executeTool(
            'get_open_pane_context', '{"tabId":" "}', context, { definition: tool.definition },
        );
        expect(blank.error).toBeUndefined();
        expect(JSON.parse(blank.result!)).toEqual(JSON.parse(listed.result!));
        expect(JSON.parse(listed.result!)).toMatchObject({
            total: 3,
            tabs: [
                { tabId: 'tab-new', kind: 'chat', empty: true },
                { tabId: 'tab-doc', kind: 'document', documentId: 'doc-a' },
                { tabId: 'tab-self', kind: 'chat', threadId: 'thread-a', current: true },
            ],
        });
        expect(JSON.parse(listed.result!).tabs[0].threadId).toBeUndefined();

        const missed = await registry.executeTool(
            'get_open_pane_context', '{"tabId":"list"}', context, { definition: tool.definition },
        );
        expect(missed.error).toBeUndefined();
        expect(JSON.parse(missed.result!)).toMatchObject({
            matched: false,
            tabs: [{ tabId: 'tab-new' }, { tabId: 'tab-doc' }, { tabId: 'tab-self' }],
        });

        const emptyChat = await registry.executeTool(
            'get_open_pane_context', '{"tabId":"tab-new"}', context, { definition: tool.definition },
        );
        expect(emptyChat.error).toBeUndefined();
        expect(JSON.parse(emptyChat.result!)).toMatchObject({
            tabId: 'tab-new',
            kind: 'chat',
            empty: true,
            content: 'This chat has no messages yet.',
        });
        expect(JSON.parse(emptyChat.result!).threadId).toBeUndefined();
    });
});
