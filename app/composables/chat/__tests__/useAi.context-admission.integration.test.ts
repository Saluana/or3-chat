import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, effectScope, ref, type EffectScope } from 'vue';
import { mount } from '@vue/test-utils';
import Dexie from 'dexie';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { useChatModelSelection } from '../useChatModelSelection';
import { useAiSettings } from '../useAiSettings';
import { useModelStore } from '../useModelStore';
import { createThreadInDb } from '~/db/threads';
import { forkThread } from '~/db/branching';
import { captureCompaction, validateCompactionSummary, createCompactedFork } from '~/db/compaction';
import { userTranscriptData } from '~/utils/chat/transcript';
import { consumeChatSendHandled } from '~/utils/chat/send-interception';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { registerHistoryTools } from '~/utils/chat/history-tools';
import { createOrRefFile } from '~/db/files';
import { catalogWorkspaceFile } from '~/db/workspace-files';
import { captureProjectOperation } from '~/utils/projects/context';
import { addProjectDocument } from '~/utils/projects/source-intake';
import { PROJECT_POST_TYPES } from '~~/shared/projects/workspace';
import { moveChatToProject, saveProjectSource, saveProjectSettings } from '~/db/project-workspace';

const external = vi.hoisted(() => ({ capacity: 1_000_000, bodies: [] as Record<string, unknown>[],
    workspace: '', catalogGate: undefined as Promise<void> | undefined, catalogEntered: undefined as (() => void) | undefined,
    toolCall: false, background: false, role: 'owner' }));
vi.unmock('~/composables/chat/useAi');
vi.mock('#imports', async (original) => ({
    ...await original<typeof import('#imports')>(),
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: external.background, sync: { enabled: external.background },
        backgroundStreaming: { enabled: external.background }, limits: { enabled: false },
        openRouter: { allowUserOverride: true, hasInstanceKey: false, requireUserKey: false } } }),
    useToast: () => ({ add() {} }), useAppConfig: () => ({}),
    useUserApiKey: () => ({ apiKey: ref('scripted-key'), setKey() {} }),
    useActivePrompt: () => ({ activePromptContent: ref(null) }),
    useHooks: () => useHooks(),
}));
vi.mock('~/core/auth/useOpenrouter', () => ({ useOpenRouterAuth: () => ({ startLogin() {} }) }));
vi.mock('~/composables/auth/useSessionContext', () => ({ getCachedSessionContext: () => external.background ? { authenticated: true, user: { id: 'fixture-user' }, workspace: { id: external.workspace }, role: external.role } : null, getCachedSessionPayload: () => null, useSessionContext: () => ({ data: ref(external.background
    ? { session: { authenticated: true, workspace: { id: 'scripted-workspace' } } } : null) }) }));
vi.mock('~~/shared/openrouter', async (original) => ({
    ...await original<typeof import('~~/shared/openrouter')>(),
    createOpenRouterClient: () => ({ models: { list: async () => ({
        async *[Symbol.asyncIterator]() { external.catalogEntered?.(); await external.catalogGate; yield { result: { data: [{
            id: 'fixture/model', name: 'Fixture', canonicalSlug: 'fixture/model', contextLength: external.capacity,
            architecture: { inputModalities: ['text'], outputModalities: ['text'] },
            topProvider: { contextLength: external.capacity, maxCompletionTokens: 4096, isModerated: false },
            pricing: { prompt: '0', completion: '0' }, supportedParameters: ['tools'],
        }] } }; },
    }) } }),
}));
import { useChat } from '../useAi';

let workspace: string; let scope: EffectScope | undefined;
beforeEach(async () => {
    workspace = `native-context-${crypto.randomUUID()}`; external.workspace = workspace;
    await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine()));
    localStorage.clear(); external.capacity = 1_000_000; external.bodies = [];
    external.catalogGate = undefined; external.catalogEntered = undefined;
    external.toolCall = false; external.background = false; external.role = 'owner';
    await useModelStore().invalidate();
    await useAiSettings().ensureLoaded();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        external.bodies.push(JSON.parse(init?.body as string));
        const body = external.toolCall && external.bodies.length === 1
            ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"accepted-call","type":"function","function":{"name":"fixture_context_output","arguments":"{}"}}]}}]}\n\n'
                + 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' + 'data: [DONE]\n\n'
            : 'data: {"choices":[{"delta":{"content":"Scripted answer"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
            + 'data: [DONE]\n\n';
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
});
afterEach(async () => {
    scope?.stop(); scope = undefined; vi.unstubAllGlobals();
    const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name);
    setHookEngine(null);
    consumeChatSendHandled();
    useToolRegistry().unregisterTool('fixture_context_output');
});
function chat(threadId?: string) { scope = effectScope(); return scope.run(() => useChat([], threadId))!; }

// A distinct acceptance owner is necessary: existing background-detach tests
// mock DB appends and the message builder. Here DB, builder, catalog, policy,
// hooks and actual foreground transport remain production code; external
// catalog/network inference and credential UI alone are scripted.
describe('native context admission at the actual durable boundary', () => {
    // Diagnostics must not block valid provider input, and a prepared receipt
    // must distinguish a held dispatch, successful acceptance and network failure.
    it('bounds large saved memory in provider input and its diagnostic preview budget', async () => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 1, created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Memory', project_id: 'project' });
        await db.posts.bulkPut(Array.from({ length: 500 }, (_, i) => ({ id: 'memory-' + i, title: 'project',
            postType: PROJECT_POST_TYPES.memory, content: JSON.stringify({ version: 1, text: ('Fact ' + i + ': full durable content. ').padEnd(4000, 'x'), kind: 'fact' }),
            clock: 1, created_at: 1, updated_at: 1, deleted: false })));
        const result = await chat(thread.id).sendMessage('Use the saved facts', { model: 'fixture/model' });
        expect(result.status, JSON.stringify(result)).toBe('complete');
        // 500 explicit memories exceed the 12 KiB selection budget: only a bounded subset is sent.
        const included = JSON.stringify(external.bodies.at(-1)?.messages).match(/full durable content\./g) ?? [];
        expect(included.length).toBeGreaterThan(0);
        expect(included.length).toBeLessThanOrEqual(3);
        const assistant = (await db.messages.where('thread_id').equals(thread.id).toArray()).find(row => row.role === 'assistant')!;
        const data = assistant.data as Record<string, unknown>;
        const receipt = data.project_context as { memories: Array<{ id: string }>; omitted_memory_count: number };
        expect(receipt.memories).toHaveLength(included.length);
        expect(receipt.omitted_memory_count + receipt.memories.length).toBe(500);
        expect(new TextEncoder().encode(JSON.stringify({ project_context: receipt, project_context_iterations: data.project_context_iterations })).byteLength).toBeLessThanOrEqual(128 * 1024);
    });

    it.each(['success', 'network'] as const)('records actual project dispatch state (%s)', async outcome => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 1, created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Dispatch', project_id: 'project' });
        localStorage.setItem('or3:server-route-available', JSON.stringify({ available: false, timestamp: Date.now() }));
        let release!: () => void;
        let requests = 0;
        vi.stubGlobal('fetch', vi.fn(() => ++requests > 1 ? Promise.reject(new TypeError('Connection refused')) : new Promise<Response>((resolve, reject) => {
            release = () => outcome === 'network' ? reject(new TypeError('Connection refused')) : resolve(new Response(
                'data: {"choices":[{"delta":{"content":"Accepted"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                { headers: { 'Content-Type': 'text/event-stream' } }));
        })));
        const iterations = async () => {
            const rows = await db.messages.where('thread_id').equals(thread.id).toArray();
            return (rows.find(row => row.role === 'assistant')?.data as Record<string, unknown>)?.project_context_iterations as Array<{ request_state: string }> | undefined;
        };
        let failureState: string | undefined;
        useHooks().addAction('ai.chat.stream:action:error', async () => {
            failureState = (await iterations())?.at(-1)?.request_state;
        });
        const sending = chat(thread.id).sendMessage('Hello', { model: 'fixture/model' });
        try {
            await vi.waitFor(() => expect(release).toBeTypeOf('function'));
            expect((await iterations())?.at(-1)?.request_state).toBe('dispatched');
        } finally { release(); await sending; }
        if (outcome === 'success') expect((await iterations())?.at(-1)?.request_state).toBe('accepted');
        else {
            expect(failureState).toBe('failed');
            // Preserve normal cleanup: a failed request with no output leaves no empty response.
            expect(await iterations()).toBeUndefined();
        }
    });
    // Failure inventory: rejected preparation or a stale omission token promotes
    // temporary attachments before the user's request has been admitted.
    it.each(['preparation', 'lossy-confirmation'] as const)('does not promote knowledge on rejected %s', async reason => {
        vi.stubGlobal('Blob', NodeBlob);
        vi.stubGlobal('File', NodeFile);
        vi.stubGlobal('Worker', class {
            onmessage?: (event: { data: unknown }) => void;
            postMessage() { queueMicrotask(() => this.onmessage?.({ data: { ok: true, text: 'Temporary attachment', partial: false, locations: [] } })); }
            terminate() {}
        });
        const db = getDb();
        await db.projects.put({ id: 'knowledge', name: 'Knowledge', data: [], clock: 1, created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Admission', project_id: 'knowledge' });
        const file = await createOrRefFile(new NodeBlob(['Temporary attachment'], { type: 'text/plain' }) as Blob, 'temporary.txt');
        if (reason === 'preparation') useHooks().addFilter('ai.chat.send:filter:prepare', value => ({ ...value, error: { code: 'unavailable', message: 'Refused preparation' } }));
        const owner = chat(thread.id);
        const result = await owner.sendMessage('Use my attachment', { model: 'fixture/model', file_hashes: [file.hash], knowledge_project_id: 'knowledge',
            ...(reason === 'lossy-confirmation' ? { lossyConfirmation: {} as import('~~/shared/chat/context-budget').LossyRequestPreview } : {}) });
        expect(result.status).not.toBe('complete');
        expect(external.bodies).toEqual([]);
        expect(await db.posts.where('postType').equals(PROJECT_POST_TYPES.source).count()).toBe(0);
        expect(await db.messages.count()).toBe(0);
    });
    // Project CRUD's actual hook/Dexie boundary: switches and read-only access
    // must refuse without leaking writes to either workspace. The persistence
    // suite's identity hook fixture cannot exercise delayed plugin preparation.
    // Concurrent membership must survive a narrow rename/document association.
    it.each(['create', 'rename', 'thread', 'document'] as const)('fences project %s CRUD during a workspace switch', async operation => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Before', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const otherWorkspace = `crud-other-${crypto.randomUUID()}`;
        const filter = operation === 'thread' ? 'db.threads.create:filter:input'
            : operation === 'document' ? 'db.documents.create:filter:input'
            : operation === 'create' ? 'db.projects.create:filter:input' : 'db.projects.upsert:filter:input';
        let otherDb: ReturnType<typeof getDb> | undefined;
        useHooks().addFilter(filter, async value => {
            otherDb = setActiveWorkspaceDb(otherWorkspace);
            await otherDb.open();
            return value;
        });
        const { useProjectsCrud } = await import('~/composables/projects/useProjectsCrud');
        const crud = useProjectsCrud();
        const action = () => operation === 'create' ? crud.createProject({ id: 'created', name: 'Created' })
            : operation === 'rename' ? crud.renameProject('project', 'After')
            : operation === 'thread' ? crud.createThreadEntry('project') : crud.createDocumentEntry('project');
        try {
            await expect(action()).rejects.toThrow(/workspace|origin/i);
            expect(await db.projects.count()).toBe(1);
            expect((await db.projects.get('project'))?.name).toBe('Before');
            expect(await db.posts.count()).toBe(0);
            expect(await db.threads.count()).toBe(0);
            expect(await otherDb!.projects.count()).toBe(0);
            expect(await otherDb!.posts.count()).toBe(0);
            expect(await otherDb!.threads.count()).toBe(0);
        } finally {
            await setActiveWorkspaceDb(workspace).open();
            evictWorkspaceDb(otherWorkspace);
            if (otherDb) await Dexie.delete(otherDb.name);
        }
    });
    it.each(['create', 'rename', 'thread', 'document'] as const)('refuses project %s CRUD in a viewer workspace', async operation => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Before', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        external.background = true; external.role = 'viewer';
        const { useProjectsCrud } = await import('~/composables/projects/useProjectsCrud');
        const crud = useProjectsCrud();
        const action = () => operation === 'create' ? crud.createProject({ id: 'created', name: 'Created' })
            : operation === 'rename' ? crud.renameProject('project', 'After')
            : operation === 'thread' ? crud.createThreadEntry('project') : crud.createDocumentEntry('project');
        await expect(action()).rejects.toThrow(/read-only/);
        expect(await db.projects.count()).toBe(1);
        expect((await db.projects.get('project'))?.name).toBe('Before');
        expect(await db.posts.count()).toBe(0);
        expect(await db.threads.count()).toBe(0);
    });
    it.each(['rename', 'document'] as const)('preserves concurrent membership during project %s preparation', async operation => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Before', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        useHooks().addFilter(operation === 'rename' ? 'db.projects.upsert:filter:input' : 'db.documents.create:filter:input', async value => {
            await db.projects.update('project', { data: [{ kind: 'doc', id: 'other', name: 'Other', color: 'blue' }], clock: 1 });
            return value;
        });
        const { useProjectsCrud } = await import('~/composables/projects/useProjectsCrud');
        const crud = useProjectsCrud();
        if (operation === 'rename') await crud.renameProject('project', 'After');
        else await crud.createDocumentEntry('project');
        const project = (await db.projects.get('project'))!;
        expect(project.data).toContainEqual({ kind: 'doc', id: 'other', name: 'Other', color: 'blue' });
        if (operation === 'rename') expect(project.name).toBe('After');
        else expect((project.data as unknown[]).length).toBe(2);
        expect(project.clock).toBeGreaterThan(1);
    });
    it.each([false, true])('keeps delayed project hooks outside membership transactions (invalid target: %s)', async invalid => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Move' });
        const wait = () => new Promise<void>(resolve => setTimeout(resolve, 5));
        useHooks().addFilter('db.projects.upsert:filter:input', async value => { await wait(); return value; });
        useHooks().addAction('db.projects.upsert:action:after', wait);
        const { useProjectsCrud } = await import('~/composables/projects/useProjectsCrud');
        const entries = [{ id: thread.id, name: 'Move', kind: 'chat' as const },
            ...(invalid ? [{ id: 'missing', name: 'Missing', kind: 'chat' as const }] : [])];
        const pending = useProjectsCrud().updateProjectEntries('project', entries);
        if (invalid) await expect(pending).rejects.toThrow();
        else await pending;
        expect((await db.threads.get(thread.id))?.project_id ?? null).toBe(invalid ? null : 'project');
        expect((await db.projects.get('project'))?.data).toEqual(invalid ? [] : entries);
    });

    // Project discovery must see the effective prompt, including detached large
    // pastes, and reuse that user intent when continuing a persisted response.
    // Existing admission cases exercise continuations without project sources.
    it.each(['paste', 'continue', 'filtered'] as const)('retrieves project evidence for %s at provider dispatch', async (kind) => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Research', project_id: 'project' });
        await db.posts.put({ id: 'evidence', title: 'Reference', postType: 'doc',
            content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nebulacode launch is September 2032.' }] }] }),
            meta: '', file_hashes: '[]', clock: 0, created_at: 1, updated_at: 1, deleted: false });
        await addProjectDocument(captureProjectOperation(undefined, thread.id), 'project', 'evidence');
        const owner = chat(thread.id);
        if (kind === 'filtered') useHooks().addFilter('ui.chat.message:filter:outgoing', () => 'Explain nebulacode');
        const result = await owner.sendMessage(kind === 'paste' ? '' : kind === 'filtered' ? 'Unrelated original' : 'Explain nebulacode', {
            model: 'fixture/model', ...(kind === 'paste' ? { extraTextParts: ['Explain nebulacode'] } : {}),
        });
        expect(result.status).toBe('complete');
        if (kind === 'continue' && result.status === 'complete')
            await owner.continueMessage(result.assistantMessageId, 'fixture/model');
        expect(JSON.stringify(external.bodies.at(-1)?.messages)).toContain('launch is September 2032');
    });
    // Preparation hooks are another authorization boundary after registry
    // admission. Refusal must precede durable host mutations, not just delivery.
    it.each(['unchanged', 'owner', 'policy', 'registration', 'enabled', 'legacy-enabled'] as const)('refuses a host document write after %s changes during preparation', async change => {
        const db = getDb();
        await db.projects.bulkPut(['project', 'other'].map(id => ({ id, name: id, data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false })));
        const thread = await createThreadInDb(db, { title: 'Tool origin', project_id: 'project' });
        const { registerWorkspaceChatTools } = await import('~/utils/chat/workspace-chat-tools');
        const dispose = registerWorkspaceChatTools();
        const registry = useToolRegistry();
        const name = 'workspace_create_document';
        const tool = registry.getTool(name)!;
        let prepared = false;
        useHooks().addFilter('db.documents.create:filter:input', async value => {
            prepared = true;
            if (change === 'owner') await db.threads.update(thread.id, { project_id: 'other' });
            if (change === 'policy') {
                const { defaultProjectSettings } = await import('~~/shared/projects/workspace');
                await saveProjectSettings(captureProjectOperation(undefined, thread.id), 'project',
                    { ...defaultProjectSettings(), tools: { [name]: { mode: 'disabled', resources: [] } } }, null);
            }
            if (change === 'registration') registry.unregisterTool(name);
            if (change === 'enabled' || change === 'legacy-enabled') tool.enabled.value = false;
            return value;
        });
        try {
            const result = await registry.executeTool(name, JSON.stringify({ title: 'Must not be saved', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Requested document' }] }] } }), {
                projectId: 'project', subject: null, workspaceId: workspace, threadId: thread.id, messageId: null,
                callId: 'guarded-create', requestId: 'guarded-request', abortSignal: new AbortController().signal,
            }, change === 'legacy-enabled' ? undefined : { definition: tool.definition });
            expect(prepared, JSON.stringify(result)).toBe(true);
            if (change === 'unchanged') expect(result.error, JSON.stringify(result)).toBeUndefined();
            else expect(result.error, JSON.stringify(result)).toMatch(/changed|disabled|registration|availability/);
            expect(await db.posts.where('postType').equals('doc').count()).toBe(change === 'unchanged' ? 1 : 0);
        } finally { dispose(); }
    });

    // These registered host boundaries protect durable writes after preparation,
    // including old plugin callers that omit projectId. Existing native cases
    // start in a project and cannot catch ordinary-to-project transitions.
    // Failure modes: a moved owner still saves a legacy create/copy, a registry
    // omits the nullable-owner fence, or a receipt commits after revocation.
    // Real registry, hooks and Dexie writes are used; no production test seam.
    it.each(['create_document', 'duplicate_document', 'workspace_create_document'] as const)(
        'fences ordinary ownership during preparation of %s', async name => {
            const db = getDb();
            await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
                created_at: 1, updated_at: 1, deleted: false });
            const thread = await createThreadInDb(db, { title: 'Ordinary origin' });
            const { createDocumentInDb } = await import('~/db/documents');
            const source = await createDocumentInDb(db, { title: 'Source' });
            const { registerDocumentChatTools } = await import('~/utils/documents/document-chat-tools');
            const { registerWorkspaceChatTools } = await import('~/utils/chat/workspace-chat-tools');
            const dispose = name === 'workspace_create_document' ? registerWorkspaceChatTools() : registerDocumentChatTools();
            useHooks().addFilter('db.documents.create:filter:input', async value => {
                await moveChatToProject(captureProjectOperation(undefined, thread.id), thread.id, 'project');
                return value;
            });
            try {
                const registry = useToolRegistry();
                const args = name === 'duplicate_document' ? { documentId: source.id }
                    : name === 'workspace_create_document' ? { title: 'Output', content: { type: 'doc', content: [{ type: 'paragraph' }] } }
                    : { title: 'Output' };
                const result = await registry.executeTool(name, JSON.stringify(args), {
                    subject: null, workspaceId: workspace, threadId: thread.id, messageId: null,
                    callId: 'ordinary-create', requestId: 'ordinary-request', abortSignal: new AbortController().signal,
                }, { definition: registry.getTool(name)!.definition });
                expect(result.error, JSON.stringify(result)).toMatch(/owning project changed/);
                expect(await db.posts.where('postType').equals('doc').count()).toBe(1);
            } finally { dispose(); }
        },
    );
    it.each(['unchanged', 'owner'] as const)('checks %s ownership before a registered read receipt commits', async change => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Receipt origin' });
        const { createDocumentInDb } = await import('~/db/documents');
        const source = await createDocumentInDb(db, { title: 'Reference', content: {
            type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Evidence' }] }],
        } });
        await db.messages.put({ id: 'receipt-message', thread_id: thread.id, role: 'assistant', index: 1,
            data: { content: 'Answer' }, clock: 0, created_at: 1, updated_at: 1, deleted: false });
        let prepared = false;
        useHooks().addFilter('db.messages.upsert:filter:input', async value => {
            prepared = true;
            if (change === 'owner') await moveChatToProject(captureProjectOperation(undefined, thread.id), thread.id, 'project');
            return value;
        });
        const { registerWorkspaceChatTools } = await import('~/utils/chat/workspace-chat-tools');
        const dispose = registerWorkspaceChatTools();
        try {
            const registry = useToolRegistry();
            const result = await registry.executeTool('workspace_read', JSON.stringify({ item: { kind: 'document', id: source.id } }), {
                projectId: null, subject: null, workspaceId: workspace, threadId: thread.id, messageId: 'receipt-message',
                callId: 'receipt-read', requestId: 'receipt-request', abortSignal: new AbortController().signal,
            }, { definition: registry.getTool('workspace_read')!.definition });
            expect(prepared, JSON.stringify(result)).toBe(true);
            if (change === 'owner') expect(result.error, JSON.stringify(result)).toMatch(/owning project changed/);
            else expect(result.error, JSON.stringify(result)).toBeUndefined();
            const data = (await db.messages.get('receipt-message'))!.data as Record<string, unknown>;
            expect(Object.keys(data).some(key => key.startsWith('or3.workspace-read'))).toBe(change === 'unchanged');
        } finally { dispose(); }
    });

    // Populated chats must inherit project policy across navigation/remount;
    // a user's explicit per-chat model choice must survive those same boundaries.
    it('retains project model inheritance and durable chat overrides after navigation and remount', async () => {
        vi.stubGlobal('process', { ...process, client: true });
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const first = await createThreadInDb(db, { title: 'First', project_id: 'project' });
        const second = await createThreadInDb(db, { title: 'Second', project_id: 'project' });
        const { defaultProjectSettings } = await import('~~/shared/projects/workspace');
        await saveProjectSettings(captureProjectOperation(undefined, first.id), 'project',
            { ...defaultProjectSettings(), default_model: 'fixture/project-model' }, null);
        await db.messages.put({ id: 'populated', thread_id: first.id, role: 'assistant', index: 1,
            data: { content: 'Previous answer' }, clock: 0, created_at: 1, updated_at: 1, deleted: false });
        localStorage.setItem('last_selected_model', 'fixture/model');
        const threadId = ref(first.id);
        let selection!: ReturnType<typeof useChatModelSelection>;
        const component = defineComponent({ setup() {
            selection = useChatModelSelection({ threadId: () => threadId.value, onChange() {} });
            return () => h('div', selection.selectedModel.value);
        } });
        let wrapper = mount(component);
        try {
            await vi.waitFor(() => expect(selection.selectedModel.value).toBe('fixture/project-model'));
            selection.selectedModel.value = 'fixture/explicit-model';
            selection.modelVariant.value = 'nitro';
            await vi.waitFor(() => expect(db.kv.where('name').equals('chat-model:' + first.id).count()).resolves.toBe(1));
            threadId.value = second.id;
            await vi.waitFor(() => expect(selection.selectedModel.value).toBe('fixture/project-model'));
            expect(selection.modelVariant.value).toBe('off');
            threadId.value = first.id;
            await vi.waitFor(() => expect(selection.selectedModel.value).toBe('fixture/explicit-model'));
            expect(selection.modelVariant.value).toBe('nitro');
            wrapper.unmount();
            wrapper = mount(component);
            await vi.waitFor(() => expect(selection.selectedModel.value).toBe('fixture/explicit-model'));
            expect(selection.modelVariant.value).toBe('nitro');
        } finally { wrapper.unmount(); }
    });

    it('updates inherited models on policy changes and project moves without overwriting explicit choices', async () => {
        vi.stubGlobal('process', { ...process, client: true });
        const db = getDb();
        const { defaultProjectSettings } = await import('~~/shared/projects/workspace');
        for (const id of ['first-project', 'second-project']) {
            await db.projects.put({ id, name: id, data: [], clock: 0, created_at: 1, updated_at: 1, deleted: false });
            await saveProjectSettings(captureProjectOperation(), id,
                { ...defaultProjectSettings(), default_model: 'fixture/' + id }, null);
        }
        const thread = await createThreadInDb(db, { title: 'Inherited', project_id: 'first-project' });
        let selection!: ReturnType<typeof useChatModelSelection>;
        const wrapper = mount(defineComponent({ setup() {
            selection = useChatModelSelection({ threadId: () => thread.id, onChange() {} });
            return () => h('div', selection.selectedModel.value);
        } }));
        try {
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/first-project'));
            const settings = await db.posts.get('project-settings-first-project');
            await saveProjectSettings(captureProjectOperation(), 'first-project',
                { ...defaultProjectSettings(), default_model: 'fixture/revised' }, settings!.clock);
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/revised'));
            await moveChatToProject(captureProjectOperation(), thread.id, 'second-project');
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/second-project'));
            selection.selectedModel.value = 'fixture/explicit';
            selection.modelVariant.value = 'nitro';
            await vi.waitFor(async () => expect((await db.kv.where('name').equals('chat-model:' + thread.id).first())?.value)
                .toBe(JSON.stringify({ model: 'fixture/explicit', variant: 'nitro' })));
            await moveChatToProject(captureProjectOperation(), thread.id, 'first-project');
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(wrapper.text()).toBe('fixture/explicit');
            expect(selection.modelVariant.value).toBe('nitro');
        } finally { wrapper.unmount(); }
    });

    it('can clear a durable model override and resume inheritance across remounts', async () => {
        vi.stubGlobal('process', { ...process, client: true });
        const db = getDb();
        const { defaultProjectSettings } = await import('~~/shared/projects/workspace');
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0, created_at: 1, updated_at: 1, deleted: false });
        await saveProjectSettings(captureProjectOperation(), 'project',
            { ...defaultProjectSettings(), default_model: 'fixture/inherited' }, null);
        const thread = await createThreadInDb(db, { title: 'Reset', project_id: 'project' });
        let selection!: ReturnType<typeof useChatModelSelection>;
        const component = defineComponent({ setup() {
            selection = useChatModelSelection({ threadId: () => thread.id, onChange() {} });
            return () => h('div', selection.selectedModel.value);
        } });
        let wrapper = mount(component);
        try {
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/inherited'));
            selection.selectedModel.value = 'fixture/explicit';
            await vi.waitFor(() => expect(db.kv.where('name').equals('chat-model:' + thread.id).count()).resolves.toBe(1));
            await selection.useInheritedModel();
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/inherited'));
            wrapper.unmount(); wrapper = mount(component);
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/inherited'));
            const settings = await db.posts.get('project-settings-project');
            await saveProjectSettings(captureProjectOperation(), 'project',
                { ...defaultProjectSettings(), default_model: 'fixture/revised' }, settings!.clock);
            await vi.waitFor(() => expect(wrapper.text()).toBe('fixture/revised'));
        } finally { wrapper.unmount(); }
    });

    // The full extracted text already exists as a blob; the bounded catalog
    // preview must not make facts later in that extraction undiscoverable.
    it('retrieves file evidence beyond the catalog preview at actual dispatch', async () => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Long reference', project_id: 'project' });
        const text = 'General reference material. '.repeat(1800) + '\nNebulacode launch is September 2032.';
        const file = await createOrRefFile(new NodeBlob([text], { type: 'text/plain' }) as unknown as Blob, 'reference.txt');
        const captured = captureProjectOperation(undefined, thread.id);
        const item = await catalogWorkspaceFile(captured, file.hash, { text: {
            text: text.slice(0, 16000), coverage: 'prefix', indexed_bytes: 16000,
        } });
        await saveProjectSource(captured, 'project', {
            item_id: item.post.id, kind: 'file', title: 'Reference', mode: 'relevant',
            current_revision_id: 'extracted', revisions: [{ id: 'extracted', item_id: item.post.id,
                original_hash: file.hash, text_hash: file.hash, status: 'ready', coverage: 'full', created_at: 1 }],
        });
        const result = await chat(thread.id).sendMessage('Explain nebulacode', { model: 'fixture/model' });
        expect(result.status, JSON.stringify(result)).toBe('complete');
        expect(JSON.stringify(external.bodies.at(-1)?.messages)).toContain('launch is September 2032');
    });
    // Unselected knowledge is diagnostic inventory, not model context. Hundreds
    // of catalog entries must not prevent an otherwise small request dispatch.
    it('dispatches with a large unselected project inventory and bounded receipts', async () => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Inventory', project_id: 'project' });
        await db.posts.bulkPut(Array.from({ length: 300 }, (_, index) => ({
            id: 'source-' + index, title: 'project', postType: PROJECT_POST_TYPES.source,
            content: JSON.stringify({ version: 1, item_id: 'deleted-item-' + index, kind: 'document',
                title: 'Reference '.repeat(50), mode: 'off', current_revision_id: 'revision-' + index,
                revisions: [{ id: 'revision-' + index, status: 'ready', coverage: 'full', created_at: 1, locations: [] }] }),
            meta: '', file_hashes: '[]', clock: 0, created_at: 1, updated_at: 1, deleted: false,
        })));
        const result = await chat(thread.id).sendMessage('Hello', { model: 'fixture/model' });
        expect(result.status, JSON.stringify(result)).toBe('complete');
        expect(external.bodies).toHaveLength(1);
        if (result.status !== 'complete') throw new Error('Expected completed turn');
        const receipt = (await db.messages.get(result.assistantMessageId))?.data as Record<string, unknown>;
        expect(new TextEncoder().encode(JSON.stringify(receipt.project_context)).length).toBeLessThan(16 * 1024);
        expect(receipt.project_context).toMatchObject({ available_source_count: 300, sources: [] });
    });
    it('does not dispatch a continuation assigned to a project during model selection', async () => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Ordinary continuation' });
        const owner = chat(thread.id);
        const first = await owner.sendMessage('Start', { model: 'fixture/model' });
        expect(first.status).toBe('complete');
        if (first.status !== 'complete') throw new Error('Expected first response');
        external.bodies = [];
        useHooks().addFilter('ai.chat.model:filter:select', async model => {
            await moveChatToProject(captureProjectOperation(undefined, thread.id), thread.id, 'project');
            return model;
        });
        await owner.continueMessage(first.assistantMessageId, 'fixture/model');
        expect(external.bodies).toHaveLength(0);
        expect((await db.messages.get(first.assistantMessageId))?.pending).toBe(false);
    });
    it('rejects a chat assigned to a project while its outgoing filter is pending', async () => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Ordinary' });
        const owner = chat(thread.id);
        useHooks().addFilter('ui.chat.message:filter:outgoing', async text => {
            await moveChatToProject(captureProjectOperation(undefined, thread.id), thread.id, 'project');
            return text;
        });
        expect(await owner.sendMessage('Question', { model: 'fixture/model' })).toMatchObject({ status: 'rejected' });
        expect(external.bodies).toHaveLength(0);
        expect(await db.messages.where('thread_id').equals(thread.id).count()).toBe(0);
    });
    it.each(['complete', 'stop', 'switch'] as const)('keeps incoming-filter settlement consistent with %s at the public and durable boundary', async (action) => {
        let release!: (text: string) => void; let entered!: () => void;
        const gate = new Promise<string>(resolve => { release = resolve; });
        const arrival = new Promise<void>(resolve => { entered = resolve; });
        const hooks = useHooks();
        const after: Array<{ aborted?: boolean }> = []; const complete = vi.fn();
        hooks.addFilter('ui.chat.message:filter:incoming', async () => { entered(); return gate; });
        hooks.addAction('ai.chat.send:action:after', payload => { after.push(payload); });
        hooks.addAction('ai.chat.stream:action:complete', complete);
        const owner = chat(); const db = getDb();
        const destination = action === 'switch' ? await createThreadInDb(db, { title: 'Other thread' }) : undefined;
        const run = owner.sendMessage('Synthetic cancellation', { model: 'fixture/model' });
        await arrival;
        const partial = (await db.messages.toArray()).find(row => row.role === 'assistant')!;
        expect(partial.data).toMatchObject({ content: 'Scripted answer' });
        let switching: Promise<unknown> | undefined;
        if (action === 'stop') owner.abort();
        if (destination) switching = owner.switchThread(destination.id);
        release('Filtered answer');
        const result = await run; await switching;
        expect(result.status).toBe(action === 'complete' ? 'complete' : 'aborted');
        expect(await db.messages.get(partial.id)).toMatchObject({ data: {
            content: action === 'complete' ? 'Filtered answer' : 'Scripted answer',
            generation_state: action === 'complete' ? 'complete' : 'aborted',
        } });
        expect(after).toHaveLength(1); expect(after[0]?.aborted).toBe(action !== 'complete');
        expect(complete).toHaveBeenCalledTimes(action === 'complete' ? 1 : 0);
        if (destination) expect(await db.messages.where('thread_id').equals(destination.id).count()).toBe(0);
    });
    it.runIf(Boolean(process.env.OR3_WORKFLOWS_SOURCE))('integrates the separately owned Workflows pure source with real host admission and durable commit', async () => {
        const source = process.env.OR3_WORKFLOWS_SOURCE!;
        const { registerWorkflowSendHooks } = await import(/* @vite-ignore */ source);
        const hooks = useHooks(); const lifetime = new AbortController(); const cleanups: Array<() => void> = [];
        const workflow = { id: 'source-flow', title: 'Flow', updated_at: 12, meta: {
            meta: { id: 'source-flow', version: '2.0.0', name: 'Flow' },
            nodes: [{ id: 'start', type: 'start', data: { label: 'Start' }, position: { x: 0, y: 0 } },
                { id: 'output', type: 'output', data: { label: 'Output', mode: 'combine', sources: ['start'] }, position: { x: 1, y: 0 } }],
            edges: [{ id: 'edge', source: 'start', target: 'output' }],
        } };
        const writes: string[] = []; const starts: Array<{ messageId: string; threadId: string }> = []; let workflowAvailable = false;
        const register = (action: boolean, name: string, callback: (...args: any[]) => any) => {
            const engine = hooks as any;
            engine[action ? 'addAction' : 'addFilter'](name, callback);
            return { dispose: () => engine[action ? 'removeAction' : 'removeFilter'](name, callback) };
        };
        const controller = registerWorkflowSendHooks({ pluginId: 'or3-workflows', generation: 7, signal: lifetime.signal,
            features: { has: (name: string) => name === 'chat.send.prepare-commit-v1' },
            hooks: { onFilter: (name: string, callback: (...args: any[]) => any) => register(false, name, callback),
                onAction: (name: string, callback: (...args: any[]) => any) => register(true, name, callback) },
            onCleanup: (callback: () => void) => cleanups.push(callback) }, {
            getApiKey: () => 'scripted-key', requestApiKeyLogin() {}, getWorkflowById: async () => workflow,
            getWorkflowByName: async () => { expect(await getDb().messages.count()).toBe(0); expect(writes).toEqual([]); expect(starts).toEqual([]); return workflowAvailable ? workflow : null; }, listWorkflowNames: async () => ['Flow'],
            getMessage: async (id: string) => { const row = await getDb().messages.get(id); return row && { id, threadId: row.thread_id, streamId: row.stream_id ?? '', data: row.data }; },
            upsertWorkflowMessage: async (input: { id: string; threadId: string; data: Record<string, unknown>; pending: boolean }) => {
                const saved = await getDb().messages.get(input.id);
                expect(saved).toMatchObject({ role: 'assistant', thread_id: input.threadId });
                writes.push(input.id); await getDb().messages.update(input.id, { data: input.data, pending: input.pending });
            }, markChatSendHandled() { throw new Error('Paired commit must not mark a global send handled'); },
            emitWorkflowState() {}, emitNodeComplete() {}, emitRunStart() {}, emitRunComplete() {},
            canStartBackground: () => true, getModelCatalog: () => [], loadModelCatalog: async () => [],
            startBackground: async (input: { messageId: string; threadId: string }) => { starts.push(input); return { jobId: 'scripted-workflow-job' }; },
            trackBackground() {}, abortBackground: async () => true, backgroundStatus: async () => 'missing',
            completeCaption: async () => { throw new Error('No live caption inference'); }, respondBackgroundHitl: async () => false,
            reportError(error: unknown) { throw error; }, notify() {},
        }, { slashEnabled: true, executionEnabled: true });
        try {
            await useAiSettings().set({ maxContextTokens: 1 });
            expect(await chat().sendMessage('/Flow unavailable source', { model: 'fixture/model' })).toMatchObject({ status: 'rejected', reason: 'unavailable' });
            expect(await getDb().messages.count()).toBe(0); expect(await getDb().threads.count()).toBe(0);
            expect(writes).toEqual([]); expect(starts).toEqual([]); expect(external.bodies).toEqual([]);
            // Delegated workflows prepare their own node requests; the unused
            // native model's maximum must not become an unrelated workflow quota.
            workflowAvailable = true;
            const result = await chat().sendMessage('/Flow admitted work', { model: 'fixture/model' });
            expect(result).toMatchObject({ status: 'detached' }); expect(starts).toHaveLength(1); expect(external.bodies).toEqual([]);
            expect(new Set(writes).size).toBe(1);
            const rows = await getDb().messages.toArray(); expect(rows).toHaveLength(2);
            expect(rows.find((row) => row.id === starts[0]!.messageId)).toMatchObject({ role: 'assistant',
                data: { type: 'workflow-execution', workflowId: 'source-flow', background_job_id: 'scripted-workflow-job' } });
        } finally { lifetime.abort(); cleanups.forEach((cleanup) => cleanup()); await controller.dispose(); }
    });
    it('retains saved image identity and exact hydrated bytes through initial denial, reload and same-ID recovery', async () => {
        // jsdom's Blob lacks arrayBuffer and does not survive native structuredClone.
        // Use native binary storage and adapt only the browser FileReader boundary.
        vi.stubGlobal('FileReader', class {
            result = ''; onload?: () => void; onerror?: () => void;
            readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((buffer) => {
                this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.();
            }, () => this.onerror?.()); }
        });
        const blob = new NodeBlob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII='), (byte) => byte.charCodeAt(0))], { type: 'image/png' });
        const { hash } = await createOrRefFile(blob as unknown as Blob, 'fixture.png');
        await useAiSettings().set({ maxContextTokens: 1 });
        const owner = chat();
        expect(await owner.sendMessage('Retain attachment', { model: 'fixture/model', file_hashes: [hash] })).toMatchObject({ status: 'rejected', reason: 'context_full' });
        expect(await getDb().messages.count()).toBe(0); expect(await getDb().file_meta.get(hash)).toBeTruthy(); expect(external.bodies).toEqual([]);
        await useAiSettings().set({ maxContextTokens: null });
        vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
            external.bodies.push(JSON.parse(init!.body as string));
            return Response.json({ error: { code: 'context_length_exceeded' } }, { status: 400 });
        });
        expect(await owner.sendMessage('Retain attachment', { model: 'fixture/model', file_hashes: [hash] })).toMatchObject({ status: 'failed', reason: 'context_full' });
        const checkpoint = (await getDb().chat_request_recoveries.toArray())[0]!;
        expect(JSON.parse((await getDb().messages.get(checkpoint.user_message_id))!.file_hashes!)).toEqual([hash]);
        scope!.stop(); scope = undefined;
        expect(await chat(checkpoint.thread_id).retryMessage(checkpoint.assistant_message_id, 'fixture/model')).toMatchObject({ status: 'complete',
            userMessageId: checkpoint.user_message_id, assistantMessageId: checkpoint.assistant_message_id });
        expect(external.bodies).toHaveLength(2); expect(external.bodies[1]!.messages).toEqual(external.bodies[0]!.messages);
        expect(JSON.stringify(external.bodies[1]!.messages)).toContain('data:image/png;base64,');
        expect(await getDb().messages.count()).toBe(2);
    });
    it('retains a compacted reference ancestor in native retry and restores it after rejected retry', async () => {
        const db = getDb(); const source = await createThreadInDb(db, { title: 'Original' });
        for (const [index, role] of ['user', 'assistant', 'user', 'assistant'].entries()) await db.messages.add({
            id: `source-${index}`, thread_id: source.id, role, index, created_at: 1, updated_at: 1, clock: 1,
            deleted: false, pending: false, data: { content: `Original source turn ${index} `.repeat(100) } });
        const capture = await captureCompaction({ sourceThreadId: source.id, anchorMessageId: 'source-3', model: 'fixture/model' });
        const summary = await validateCompactionSummary(capture, JSON.stringify({
            summary_markdown: '## Objective\nRetain inherited summary.\n## Important Details\nKeep ancestral decisions.\n## Work State\nReady.\n## Next Move\nRetry safely.\n## Relevant Files\nNone.',
            landmarks: [{ message_id: 'source-3', kind: 'decision', summary: 'Original source decision' }] }),
            { targetTokens: 4096, countText: async (text) => Math.ceil(text.length / 4) });
        const parent = await createCompactedFork({ capture, summary });
        await db.messages.add({ id: 'parent-followup', thread_id: parent.thread.id, role: 'user', index: 1,
            created_at: 2, updated_at: 2, clock: 1, deleted: false, pending: false, data: { content: 'Inherited later parent decision' } });
        const child = await forkThread({ sourceThreadId: parent.thread.id, anchorMessageId: 'parent-followup', mode: 'reference' });
        const owner = chat(child.thread.id);
        const first = await owner.sendMessage('Local descendant question', { model: 'fixture/model' });
        if (first.status !== 'complete') throw new Error('Reference fixture send failed');
        expect(await owner.retryMessage(first.assistantMessageId, 'fixture/model')).toMatchObject({ status: 'complete' });
        const sent = JSON.stringify(external.bodies.at(-1)?.messages);
        expect(sent).toContain('Retain inherited summary.'); expect(sent).toContain('Inherited later parent decision');
        expect(sent).not.toContain('Original source turn');
        const latest = (await db.messages.where('thread_id').equals(child.thread.id).toArray()).findLast((row) => row.role === 'assistant' && !(row.data as Record<string, unknown>)?.superseded_by)!;
        await owner.continueMessage(latest.id, 'fixture/model');
        expect(JSON.stringify(external.bodies.at(-1)?.messages)).toContain('Retain inherited summary.');
        expect(JSON.stringify(external.bodies.at(-1)?.messages)).toContain('Inherited later parent decision');
        expect(JSON.stringify(external.bodies.at(-1)?.messages)).not.toContain('Original source turn');
        const before = await db.messages.toArray(); const calls = external.bodies.length;
        await useAiSettings().set({ maxContextTokens: 1 });
        expect(await owner.retryMessage(latest.id, 'fixture/model')).toMatchObject({ status: 'rejected', reason: 'context_full' });
        expect(await db.messages.toArray()).toEqual(before); expect(external.bodies).toHaveLength(calls);
        expect(JSON.stringify(owner.messages.value)).toContain('Retain inherited summary.');
        expect(JSON.stringify(owner.messages.value)).toContain('Inherited later parent decision');
        await useAiSettings().set({ maxContextTokens: null }); external.bodies = []; external.toolCall = true;
        const tool = vi.fn(() => 'An accepted canonical tool result');
        const registration = useToolRegistry().registerTool({ type: 'function', function: { name: 'fixture_context_output', description: 'Read scoped evidence', parameters: { type: 'object', properties: {} } } }, tool, { runtime: 'client' });
        try {
            expect(await owner.sendMessage('Use the inherited evidence', { model: 'fixture/model' })).toMatchObject({ status: 'complete' });
            expect(tool).toHaveBeenCalledOnce(); expect(external.bodies).toHaveLength(2);
            const loopBody = external.bodies[1]!;
            expect(JSON.stringify(loopBody.messages)).toContain('Retain inherited summary.'); expect(JSON.stringify(loopBody.messages)).toContain('Inherited later parent decision');
            expect((loopBody.messages as Array<{ role: string }>).some(row => row.role === 'tool')).toBe(true); expect(JSON.stringify(loopBody.messages)).not.toContain('Original source turn');
        } finally { registration.dispose(); }
        scope?.stop(); external.toolCall = false; external.background = true; external.bodies = [];
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            external.bodies.push(JSON.parse(init?.body as string));
            return Response.json({ code: 'context_full', error: 'Scripted background refusal before job', retryable: false }, { status: 400 });
        }));
        const backgroundOwner = chat(child.thread.id);
        const backgroundResult = await backgroundOwner.sendMessage('Background inherited evidence', { model: 'fixture/model' });
        if (backgroundResult.status !== 'failed' || !backgroundResult.assistantMessageId) throw new Error('Expected scripted background refusal');
        expect(await backgroundOwner.retryMessage(backgroundResult.assistantMessageId, 'fixture/model')).toMatchObject({ status: 'failed', reason: 'context_full' });
        await backgroundOwner.continueMessage(latest.id, 'fixture/model');
        expect(external.bodies).toHaveLength(3);
        for (const body of external.bodies) {
            expect(body._background).toBe(true); expect(JSON.stringify(body.messages)).toContain('Retain inherited summary.');
            expect(JSON.stringify(body.messages)).toContain('Inherited later parent decision'); expect(JSON.stringify(body.messages)).not.toContain('Original source turn');
        }
    });
    it.each([{ ready: true, bridge: true, runtime: 'hybrid', background: true },
        { ready: false, bridge: true, runtime: 'client', background: true },
        { ready: false, bridge: false, runtime: 'client', background: false }])('freezes actual native history placement for %j', async scenario => {
        external.background = true; const db = getDb(); const source = await createThreadInDb(db, { title: 'History placement' });
        for (const [index, role] of ['user', 'assistant', 'user', 'assistant'].entries()) await db.messages.add({
            id: 'placement-source-' + index, thread_id: source.id, role, index, created_at: 1, updated_at: 1, clock: 1,
            deleted: false, pending: false, data: { content: ('Placement source ' + index).repeat(100) } });
        const capture = await captureCompaction({ sourceThreadId: source.id, anchorMessageId: 'placement-source-3', model: 'fixture/model' });
        const summary = await validateCompactionSummary(capture, JSON.stringify({ summary_markdown: '## Objective\nRead history.\n## Important Details\nKeep scope.\n## Work State\nReady.\n## Next Move\nAnswer.\n## Relevant Files\nNone.', landmarks: [{ message_id: 'placement-source-3', kind: 'decision', summary: 'Read source' }] }),
            { targetTokens: 4096, countText: async text => Math.ceil(text.length / 4) });
        const child = await createCompactedFork({ capture, summary }); const dispose = registerHistoryTools();
        try {
            await vi.waitFor(() => expect(useToolRegistry().getEnabledDefinitions({ workspaceId: workspace, threadId: child.thread.id }).map(tool => tool.function.name)).toContain('get_message'));
            const readiness = vi.fn(async (url: string, options: { query: { thread_id: string } }) => {
                expect(url).toBe('/api/chat/history-readiness'); expect(options.query.thread_id).toBe(child.thread.id); return { ready: scenario.ready };
            }); vi.stubGlobal('$fetch', readiness);
            let bridgeChecks = 0;
            vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
                if (url === '/api/jobs/client-tool/capability') { bridgeChecks++; return Response.json({ available: scenario.bridge }); }
                external.bodies.push(JSON.parse(init?.body as string));
                return scenario.background ? Response.json({ code: 'context_full', error: 'Scripted refusal before job', retryable: false }, { status: 400 })
                    : new Response('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
            }));
            const result = await chat(child.thread.id).sendMessage('Retrieve original evidence', { model: 'fixture/model' });
            expect(result.status, JSON.stringify(result)).toBe(scenario.background ? 'failed' : 'complete'); expect(readiness).toHaveBeenCalledTimes(1);
            expect(bridgeChecks).toBe(scenario.ready ? 0 : 1); expect(external.bodies).toHaveLength(1);
            const body = external.bodies[0]!; expect(Boolean(body._background)).toBe(scenario.background);
            expect((body.tools as Array<{ function: { name: string } }>).map(tool => tool.function.name)).toEqual(['get_message', 'search_parent']);
            if (scenario.background) expect(body._toolRuntime).toEqual({ get_message: scenario.runtime, search_parent: scenario.runtime });
            expect(JSON.stringify(body.messages)).toContain('Read history.'); expect(JSON.stringify(body.messages)).not.toContain('Placement source');
        } finally { dispose(); }
    });
    it('recovers an initial background server context rejection after reload with the same durable IDs', async () => {
        external.background = true;
        const final = vi.fn((request) => request); useHooks().addFilter('ai.chat.messages:filter:before_send', final);
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            external.bodies.push(JSON.parse(init?.body as string));
            return Response.json({ code: 'context_full', error: 'Independent server capacity rejected this request', retryable: false }, { status: 400 });
        }));
        const owner = chat(); const rejected = await owner.sendMessage('Preserve background draft and attachments', { model: 'fixture/model' });
        expect(external.bodies[0]?._background).toBe(true);
        expect(rejected).toMatchObject({ status: 'failed', reason: 'context_full' });
        const threadId = owner.threadId.value!; const checkpoint = await getDb().chat_request_recoveries.get(threadId);
        expect(checkpoint).toBeTruthy(); expect(await getDb().messages.get(checkpoint!.assistant_message_id)).toMatchObject({ error: 'context_full' });
        const before = await getDb().messages.toArray(); scope?.stop(); external.background = false;
        await useModelStore().addFavoriteModel({ id: 'fixture/large-model', name: 'Larger scripted model', context_length: 2_000_000,
            top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['tools'],
            architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } });
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            external.bodies.push(JSON.parse(init?.body as string));
            return new Response('data: {"choices":[{"delta":{"content":"Recovered background request"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
        }));
        const recovered = await chat(threadId).retryMessage(checkpoint!.assistant_message_id, 'fixture/large-model');
        expect(recovered).toMatchObject({ status: 'complete', userMessageId: checkpoint!.user_message_id, assistantMessageId: checkpoint!.assistant_message_id });
        expect((await getDb().messages.toArray()).map((row) => row.id)).toEqual(before.map((row) => row.id));
        expect(final).toHaveBeenCalledOnce(); expect(external.bodies).toHaveLength(2);
        expect(external.bodies[1]?.model).toBe('fixture/large-model');
        expect(external.bodies[1]?.messages).toEqual(external.bodies[0]?.messages);
        expect(await getDb().chat_request_recoveries.count()).toBe(0);
    });
    // Existing recovery tests have no filtered project query. A real provider
    // rejection must recover its same IDs/body without rerunning outgoing hooks;
    // using the raw draft instead changes source selection and falsely refuses.
    it('recovers filtered project evidence with the admitted query and original durable IDs', async () => {
        const db = getDb();
        await db.projects.put({ id: 'project', name: 'Project', data: [], clock: 0,
            created_at: 1, updated_at: 1, deleted: false });
        const thread = await createThreadInDb(db, { title: 'Recovery', project_id: 'project' });
        await db.posts.put({ id: 'recovery-evidence', title: 'Reference', postType: 'doc',
            content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nebulacode launches September 2032.' }] }] }),
            meta: '', file_hashes: '[]', clock: 0, created_at: 1, updated_at: 1, deleted: false });
        await addProjectDocument(captureProjectOperation(undefined, thread.id), 'project', 'recovery-evidence');
        const outgoing = vi.fn(() => 'Explain nebulacode');
        useHooks().addFilter('ui.chat.message:filter:outgoing', outgoing);
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            external.bodies.push(JSON.parse(init?.body as string));
            if (external.bodies.length === 1) return Response.json({ error: {
                code: 'context_length_exceeded', message: 'Scripted initial refusal',
            } }, { status: 400 });
            return new Response('data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n',
                { headers: { 'Content-Type': 'text/event-stream' } });
        }));
        const owner = chat(thread.id);
        expect(await owner.sendMessage('Unrelated original draft', { model: 'fixture/model' }))
            .toMatchObject({ status: 'failed', reason: 'context_full' });
        const checkpoint = (await db.chat_request_recoveries.get(thread.id))!;
        expect(checkpoint).toBeTruthy();
        const rows = await db.messages.toArray();
        scope?.stop();
        const recovered = await chat(thread.id).retryMessage(checkpoint.assistant_message_id, 'fixture/model');
        expect(recovered, JSON.stringify(recovered)).toMatchObject({ status: 'complete', userMessageId: checkpoint.user_message_id,
            assistantMessageId: checkpoint.assistant_message_id });
        expect((await db.messages.toArray()).map(row => row.id)).toEqual(rows.map(row => row.id));
        expect(external.bodies[1]?.messages).toEqual(external.bodies[0]?.messages);
        expect(JSON.stringify(external.bodies[1]?.messages)).toContain('September 2032');
        expect(outgoing).toHaveBeenCalledOnce();
        expect(await db.chat_request_recoveries.count()).toBe(0);
    });

    async function rejectedAttempt() {
        const owner = chat(); const filters = vi.fn((request) => request);
        useHooks().addFilter('ai.chat.messages:filter:before_send', filters);
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            external.bodies.push(JSON.parse(init?.body as string));
            return Response.json({ error: { code: 'context_length_exceeded', message: 'Scripted initial refusal' } }, { status: 400 });
        }));
        const result = await owner.sendMessage('Saved initial request', { model: 'fixture/model' });
        if (result.status !== 'failed') throw new Error('Initial refusal fixture failed');
        const checkpoint = await getDb().chat_request_recoveries.get(owner.threadId.value!);
        if (!checkpoint) throw new Error('Initial refusal did not retain its checkpoint');
        return { owner, checkpoint, filters };
    }
    it('does not repeat final filters or write rows when the saved recovery version is unsupported', async () => {
        const { owner, checkpoint, filters } = await rejectedAttempt();
        // A durable row may be written by a newer client. This deliberately
        // violates the current compile-time version while using real storage.
        await getDb().chat_request_recoveries.put({ ...checkpoint, version: 2 as 1 });
        const before = await getDb().messages.toArray(); const requests = external.bodies.length;
        expect(await owner.retryMessage(checkpoint.assistant_message_id, 'fixture/model'))
            .toMatchObject({ status: 'rejected', reason: 'unavailable' });
        expect(await getDb().messages.toArray()).toEqual(before);
        expect(external.bodies).toHaveLength(requests); expect(filters).toHaveBeenCalledOnce();
    });
    it('refuses a saved recovery after the source or tool selection changes', async () => {
        const { owner, checkpoint, filters } = await rejectedAttempt();
        const db = getDb(); const before = await db.messages.toArray();
        await db.messages.update(checkpoint.user_message_id, { clock: 2 });
        expect(await owner.retryMessage(checkpoint.assistant_message_id, 'fixture/model')).toMatchObject({ status: 'failed', reason: 'unavailable' });
        await db.messages.put(before.find((row) => row.id === checkpoint.user_message_id)!);
        useToolRegistry().registerTool({ type: 'function', function: { name: 'fixture_context_output', description: 'Changed tool selection',
            parameters: { type: 'object', properties: {}, required: [] } } }, () => 'Never execute', { enabled: true });
        expect(await owner.retryMessage(checkpoint.assistant_message_id, 'fixture/model')).toMatchObject({ status: 'failed', reason: 'unavailable' });
        expect(await db.messages.toArray()).toEqual(before); expect(external.bodies).toHaveLength(1); expect(filters).toHaveBeenCalledOnce();
    });
    it('settles a checkpoint storage failure before any provider request', async () => {
        const db = getDb(); const put = vi.spyOn(db.chat_request_recoveries, 'put')
            .mockRejectedValueOnce(new DOMException('Scripted storage exhaustion', 'QuotaExceededError'));
        try {
            expect(await chat().sendMessage('Keep this draft', { model: 'fixture/model' })).toMatchObject({ status: 'failed' });
            expect(external.bodies).toEqual([]); expect(await db.chat_request_recoveries.count()).toBe(0);
            const rows = await db.messages.toArray(); expect(rows.filter((row) => row.role === 'user')).toHaveLength(1);
            expect(rows.filter((row) => row.role === 'assistant' && row.pending)).toEqual([]);
        } finally { put.mockRestore(); }
    });
    it('reports provider context overflow as context_full while retaining the full durable turn and never replaying it', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            external.bodies.push(JSON.parse(init?.body as string));
            return new Response(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'private upstream' } }),
                { status: 400, headers: { 'Content-Type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        const text = 'Preserve the complete user request.';
        expect(await chat().sendMessage(text, { model: 'fixture/model' }))
            .toMatchObject({ status: 'failed', reason: 'context_full' });
        expect(fetchMock).toHaveBeenCalledOnce();
        const rows = await getDb().messages.toArray();
        expect(rows.filter((row) => row.role === 'user')).toHaveLength(1);
        expect(rows.find((row) => row.role === 'user')?.data).toMatchObject({ content: text });
        expect(external.bodies[0]?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user' })]));
    });
    it('rejects an over-budget new conversation before any thread/user/assistant write or inference', async () => {
        await useAiSettings().set({ maxContextTokens: 32 });
        const owner = chat();
        const before = { threads: await getDb().threads.toArray(), messages: await getDb().messages.toArray() };
        const text = 'Keep all selected context. '.repeat(40);
        const result = await owner.sendMessage(text, { model: 'fixture/model', files: [], file_hashes: [] });
        expect(result).toMatchObject({ status: 'rejected', reason: 'context_full' });
        expect(await getDb().threads.toArray()).toEqual(before.threads);
        expect(await getDb().messages.toArray()).toEqual(before.messages);
        expect(owner.threadId.value).toBeUndefined(); expect(external.bodies).toEqual([]);
    });
    it('keeps unknown capacity recoverable rather than creating durable rows with an 8k fallback', async () => {
        external.capacity = 0;
        const owner = chat();
        expect(await owner.sendMessage('Keep this draft', { model: 'fixture/model', files: [], file_hashes: [] }))
            .toMatchObject({ status: 'rejected', reason: 'model_metadata_unavailable' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
    it('counts the pure prepared payload before writes, and never sends trimmed input', async () => {
        await useAiSettings().set({ maxContextTokens: 200 });
        useHooks().addFilter('ai.chat.send:filter:prepare', (payload) => ({ ...payload,
            messages: [...payload.messages, { role: 'system', content: 'Selected context '.repeat(100) }] }));
        expect(await chat().sendMessage('Draft', { model: 'fixture/model' }))
            .toMatchObject({ status: 'rejected', reason: 'context_full' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
    it('keeps the legacy final filter once-only after real assistant IDs exist', async () => {
        let assistantId: string | undefined;
        useHooks().addAction('ai.chat.send:action:before', (payload) => { assistantId = payload.assistant?.id; });
        const final = vi.fn(async (payload) => {
            expect(assistantId).toBeTruthy(); expect(await getDb().messages.get(assistantId!)).toBeTruthy();
            return { messages: [...payload.messages, { role: 'system', content: 'Legacy final context' }] };
        });
        useHooks().addFilter('ai.chat.messages:filter:before_send', final);
        expect(await chat().sendMessage('Ordinary request', { model: 'fixture/model' })).toMatchObject({ status: 'complete' });
        expect(final).toHaveBeenCalledTimes(1);
        expect(external.bodies[0]?.messages).toContainEqual({ role: 'system', content: 'Legacy final context' });
    });
    it('rejects a requested reply allowance outside the actual remaining total window before writes', async () => {
        external.capacity = 300;
        expect(await chat().sendMessage('Full context '.repeat(80), { model: 'fixture/model', maxCompletionTokens: 150 }))
            .toMatchObject({ status: 'rejected', reason: 'context_full' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
    it('cancels held pure preparation before any durable turn or native inference', async () => {
        let release!: () => void; let entered!: () => void;
        const holding = new Promise<void>((resolve) => { release = resolve; });
        const reached = new Promise<void>((resolve) => { entered = resolve; });
        useHooks().addFilter('ai.chat.send:filter:prepare', async (payload) => { entered(); await holding; return payload; });
        const owner = chat(); const sending = owner.sendMessage('Retain draft', { model: 'fixture/model' });
        await reached; await owner.abort(); release();
        expect(await sending).toMatchObject({ status: 'aborted' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
    it('reports cancellation during model readiness as aborted and leaves the full draft uncommitted', async () => {
        let release!: () => void; let entered!: () => void;
        external.catalogGate = new Promise<void>((resolve) => { release = resolve; });
        const reached = new Promise<void>((resolve) => { entered = resolve; }); external.catalogEntered = entered;
        const owner = chat(); const sending = owner.sendMessage('Draft awaiting models', { model: 'fixture/model' });
        await reached; await owner.abort(); release();
        expect(await sending).toMatchObject({ status: 'aborted', reason: 'aborted' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
    it('acknowledges one delegated commit with real DB rows and never dispatches native inference', async () => {
        let preparationSignal: AbortSignal;
        useHooks().addFilter('ai.chat.send:filter:prepare', async (payload) => {
            expect(await getDb().messages.count()).toBe(0); expect(await getDb().threads.count()).toBe(0);
            preparationSignal = payload.signal;
            return { ...payload, delegation: { pluginId: 'fixture', generation: 1, intent: 'intent-identity' } };
        });
        const commit = vi.fn(async (payload) => {
            expect(payload.signal).toBe(preparationSignal);
            expect(await getDb().messages.get(payload.assistant.id)).toMatchObject({ thread_id: payload.assistant.threadId, role: 'assistant' });
            expect(payload.assistant.id).not.toBe('intent-identity');
            return { ...payload, status: 'handled' as const };
        });
        useHooks().addFilter('ai.chat.send:filter:commit', commit);
        expect(await chat().sendMessage('/Flow work', { model: 'fixture/model' })).toMatchObject({ status: 'detached' });
        expect(commit).toHaveBeenCalledTimes(1); expect(external.bodies).toEqual([]);
    });
    it('refuses an unacknowledged delegation without falling through to native inference', async () => {
        useHooks().addFilter('ai.chat.send:filter:prepare', (payload) => ({ ...payload,
            delegation: { pluginId: 'fixture', generation: 1, intent: 'intent' } }));
        expect(await chat().sendMessage('/Flow work', { model: 'fixture/model' })).toMatchObject({ status: 'failed' });
        expect(external.bodies).toEqual([]);
    });
    it.each(['request', 'assistant', 'intent'] as const)('refuses a handled acknowledgement for another %s identity', async (identity) => {
        useHooks().addFilter('ai.chat.send:filter:prepare', (payload) => ({ ...payload,
            delegation: { pluginId: 'fixture', generation: 1, intent: 'intent' } }));
        useHooks().addFilter('ai.chat.send:filter:commit', (payload) => ({ ...payload, status: 'handled' as const,
            ...(identity === 'request' ? { requestId: 'another-request' }
                : identity === 'assistant' ? { assistant: { ...payload.assistant, id: 'another-assistant' } }
                    : { delegation: { ...payload.delegation!, intent: 'another-intent' } }) }));
        expect(await chat().sendMessage('/Flow work', { model: 'fixture/model' })).toMatchObject({ status: 'failed' });
        expect(external.bodies).toEqual([]);
    });
    it('does not detach a cancelled request when a held commit returns a late acknowledgement', async () => {
        let release!: () => void; let entered!: () => void;
        const holding = new Promise<void>((resolve) => { release = resolve; });
        const reached = new Promise<void>((resolve) => { entered = resolve; });
        useHooks().addFilter('ai.chat.send:filter:prepare', (payload) => ({ ...payload,
            delegation: { pluginId: 'fixture', generation: 1, intent: 'intent' } }));
        useHooks().addFilter('ai.chat.send:filter:commit', async (payload) => {
            entered(); await holding; return { ...payload, status: 'handled' as const };
        });
        const owner = chat(); const sending = owner.sendMessage('/Flow work', { model: 'fixture/model' });
        await reached; await owner.abort(); release();
        expect(await sending).toMatchObject({ status: 'aborted' });
        expect(external.bodies).toEqual([]);
    });
    it('leaves a refused retry’s original assistant and turn history intact', async () => {
        const owner = chat();
        const first = await owner.sendMessage('Original full request '.repeat(60), { model: 'fixture/model' });
        expect(first.status).toBe('complete');
        if (first.status !== 'complete') throw new Error('Fixture send failed');
        const before = await getDb().messages.toArray(); const calls = external.bodies.length;
        await useAiSettings().set({ maxContextTokens: 100 });
        await owner.retryMessage(first.assistantMessageId, 'fixture/model');
        expect(await getDb().messages.toArray()).toEqual(before); expect(external.bodies).toHaveLength(calls);
    });
    it('leaves a refused continuation’s target and all prior rows unchanged', async () => {
        const owner = chat();
        const first = await owner.sendMessage('Original full request '.repeat(60), { model: 'fixture/model' });
        if (first.status !== 'complete') throw new Error('Fixture send failed');
        const before = await getDb().messages.toArray(); const calls = external.bodies.length;
        await useAiSettings().set({ maxContextTokens: 100 });
        await owner.continueMessage(first.assistantMessageId, 'fixture/model');
        expect(await getDb().messages.toArray()).toEqual(before); expect(external.bodies).toHaveLength(calls);
        expect(owner.requestState.value).toMatchObject({ status: 'terminal', result: { reason: 'context_full' } });
    });
    it('keeps a confirmed omission set through a tool iteration and stops rather than omitting additional history', async () => {
        const db = getDb(); const thread = await createThreadInDb(db, { title: 'Lossy tool continuation' });
        await db.messages.bulkPut(['user', 'assistant', 'user', 'assistant'].map((role, index) => ({
            id: `lossy-old-${index}`, thread_id: thread.id, role, index, created_at: 1, updated_at: 1, clock: 1,
            pending: false, deleted: false, data: { content: `Saved old turn ${index} `.repeat(600) } })));
        await useAiSettings().set({ maxContextTokens: 1600 }); external.toolCall = true;
        const output = 'Accepted result that exceeds the fixed candidate. '.repeat(1200);
        const handler = vi.fn(() => output);
        useToolRegistry().registerTool({ type: 'function', function: { name: 'fixture_context_output',
            description: 'Read source.', parameters: { type: 'object', properties: {} } } }, handler, { enabled: true });
        const before = await db.messages.toArray(); const owner = chat(thread.id);
        const inspected = await owner.sendMessage('Read source after explicit omissions', { model: 'fixture/model', inspectLossyRequest: true });
        if (inspected.status !== 'rejected' || !inspected.lossyPreview) throw new Error('The overflowing fixture did not produce an inspection');
        expect(await db.messages.toArray()).toEqual(before); expect(external.bodies).toEqual([]);
        expect(await owner.sendMessage('Read source after explicit omissions', { model: 'fixture/model', lossyConfirmation: inspected.lossyPreview }))
            .toMatchObject({ status: 'failed', reason: 'context_full' });
        expect(handler).toHaveBeenCalledOnce(); expect(external.bodies).toHaveLength(1);
        expect(JSON.stringify(external.bodies[0]?.messages)).not.toContain('Saved old turn');
        const after = await db.messages.toArray();
        expect(after.filter((row) => row.id.startsWith('lossy-old-'))).toEqual(before);
        expect(after.find((row) => row.role === 'user' && !row.id.startsWith('lossy-old-'))?.data)
            .toMatchObject({ context_omission: { version: 1, omitted_positions: expect.any(Array) } });
        expect(JSON.stringify(after.filter((row) => row.role === 'tool'))).toContain(output);
        expect(await db.chat_request_recoveries.count()).toBe(0);
    });
    it('stops after an oversized accepted tool result using the captured maximum without repeating the tool', async () => {
        await useAiSettings().set({ maxContextTokens: 1200 });
        external.toolCall = true;
        const output = 'Accepted tool output. '.repeat(2000);
        const handler = vi.fn(async () => {
            // A settings change belongs to future generations.
            await useAiSettings().set({ maxContextTokens: 100_000 });
            return output;
        });
        useToolRegistry().registerTool({ type: 'function', function: {
            name: 'fixture_context_output', description: 'Return the requested source text.',
            parameters: { type: 'object', properties: {}, required: [] },
        } }, handler, { enabled: true, available: (context) => Boolean(context.threadId) });
        const result = await chat().sendMessage('Read the source', { model: 'fixture/model' });
        expect(result).toMatchObject({ status: 'failed', reason: 'context_full' });
        expect(handler).toHaveBeenCalledTimes(1); expect(external.bodies).toHaveLength(1);
        expect(await getDb().chat_request_recoveries.count()).toBe(0);
        const tools = (await getDb().messages.toArray()).filter((row) => row.role === 'tool');
        expect(tools).toHaveLength(1);
        expect(JSON.stringify(tools[0]?.data)).toContain(output);
    });
    it('includes thread-bound tool schema overhead before creating a new conversation', async () => {
        await useAiSettings().set({ maxContextTokens: 200 });
        const handler = vi.fn(() => 'Must not run');
        useToolRegistry().registerTool({ type: 'function', function: {
            name: 'fixture_context_output', description: 'Tool instructions '.repeat(1000),
            parameters: { type: 'object', properties: {}, required: [] },
        } }, handler, { enabled: true, available: (context) => Boolean(context.threadId) });
        expect(await chat().sendMessage('Retain draft', { model: 'fixture/model' }))
            .toMatchObject({ status: 'rejected', reason: 'context_full' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]); expect(handler).not.toHaveBeenCalled();
    });
    it.each([600_000, 3_800_000])('sends every byte of a %i-byte canonical history without a 128k ceiling', async (bytes) => {
        const db = getDb(); const thread = await createThreadInDb(db, { title: 'Large canonical fixture' });
        const chunk = 'x'.repeat(100_000); const total = Math.ceil(bytes / chunk.length);
        const rows = Array.from({ length: total }, (_, index) => {
            const id = crypto.randomUUID();
            return { id, thread_id: thread.id, role: 'user', index, created_at: index + 1, updated_at: index + 1, clock: 1,
                deleted: false, pending: false, data: { ...userTranscriptData(id), content: chunk } };
        });
        await db.messages.bulkAdd(rows);
        expect(await chat(thread.id).sendMessage('Keep all history', { model: 'fixture/model' })).toMatchObject({ status: 'complete' });
        const sent = external.bodies[0]?.messages as Array<{ content: Array<{ text?: string }> | string }>;
        const texts = sent.map((message) => typeof message.content === 'string' ? message.content
            : message.content.map((part) => part.text ?? '').join(''));
        expect(texts.filter((text) => text === chunk)).toHaveLength(total);
        expect(texts.join('').split('x').length - 1).toBe(bytes);
        expect(external.bodies[0]?.max_tokens).toBe(4096);
    });
    it('rejects a preparation filter failure instead of dispatching the engine’s fallback value', async () => {
        useHooks().addFilter('ai.chat.send:filter:prepare', () => { throw new Error('Preparation failed'); });
        expect(await chat().sendMessage('Keep draft', { model: 'fixture/model' })).toMatchObject({ status: 'rejected', reason: 'unavailable' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
    it('invalidates a held preparation when its filter chain changes, even at the same callback count', async () => {
        let release!: () => void; let entered!: () => void;
        const holding = new Promise<void>((resolve) => { release = resolve; });
        const reached = new Promise<void>((resolve) => { entered = resolve; });
        const old = async (payload: import('~~/shared/hooks/hook-domain-types').ChatSendPreparation) => { entered(); await holding; return payload; };
        useHooks().addFilter('ai.chat.send:filter:prepare', old);
        const sending = chat().sendMessage('Draft', { model: 'fixture/model' }); await reached;
        useHooks().removeFilter('ai.chat.send:filter:prepare', old);
        useHooks().addFilter('ai.chat.send:filter:prepare', (payload) => ({ ...payload,
            messages: [...payload.messages, { role: 'system', content: 'New configuration' }] }));
        release(); expect(await sending).toMatchObject({ status: 'rejected', reason: 'unavailable' });
        expect(await getDb().threads.count()).toBe(0); expect(await getDb().messages.count()).toBe(0);
        expect(external.bodies).toEqual([]);
    });
});
