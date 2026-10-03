import { useRuntimeConfig } from '#imports';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
    registerServerTool,
    unregisterServerTool,
    executeServerTool,
    getServerTool,
} from '../tool-registry';
import { registerServerHistoryTools } from '../history-tools';
import { registerSyncGatewayAdapter } from '../../../sync/gateway/registry';
import type { SyncGatewayAdapter } from '../../../sync/gateway/types';
import { registerAuthWorkspaceStore } from '../../../auth/store/registry';
import type { AuthWorkspaceStore } from '../../../auth/store/types';
import { clearAllJobs, memoryJobProvider, getJobCount } from '../../background-jobs/providers/memory';
import { registerAuthProvider } from '../../../auth/registry';
import { _resetSharedSessionCache } from '../../../auth/session';
import { createApp, toWebHandler, getHeader } from 'h3';
import readinessHandler from '../../../api/chat/history-readiness.get';
import { placeHistoryTools } from '~/utils/chat/history-placement';
import { getChatJobExecution } from '../../background-jobs/types';
import { startBackgroundStream } from '../../background-jobs/stream-handler';
import { resetJobProvider } from '../../background-jobs/store';
import type { CanonicalHistoryActor, CanonicalHistoryRecord } from '~~/shared/chat/background-history';
import type { CanonicalChatQuery } from '~~/shared/chat/history-reader';
import { historyToolDefinitions } from '~~/shared/chat/history-tools';
import type { ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';

describe('server tool registry', () => {
    afterEach(() => vi.useRealTimers());
    it('executes a hybrid tool', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'server_echo',
                description: 'Echo input',
                parameters: {
                    type: 'object',
                    properties: {
                        value: { type: 'string' },
                    },
                    required: ['value'],
                },
            },
            runtime: 'hybrid',
        };

        registerServerTool(def, ({ value }: { value: string }) => value, {
            override: true,
        });

        const result = await executeServerTool(
            'server_echo',
            JSON.stringify({ value: 'ok' })
        );

        expect(result.error).toBeUndefined();
        expect(result.result).toBe('ok');

        unregisterServerTool('server_echo');
    });

    it('rejects client-only tools', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'client_only',
                description: 'Client only',
                parameters: {
                    type: 'object',
                    properties: {},
                },
            },
            runtime: 'client',
        };

        registerServerTool(def, () => 'nope', { override: true });

        const result = await executeServerTool('client_only', '{}');

        expect(result.error).toContain('client-only');

        unregisterServerTool('client_only');
    });

    it('passes exact request-scoped execution context while legacy handlers remain valid', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'context_tool',
                description: 'Context test',
                parameters: { type: 'object', properties: {} },
            },
            runtime: 'server',
        };
        let received: ToolExecutionContext | undefined;
        registerServerTool(def, (_args, context) => {
            received = context;
            return context.callId;
        }, { override: true });
        const controller = new AbortController();
        const context: ToolExecutionContext = {
            subject: 'user-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messageId: 'message-1',
            callId: 'call-1',
            requestId: 'request-1',
            abortSignal: controller.signal,
        };

        await expect(executeServerTool('context_tool', '{}', context)).resolves.toMatchObject({
            result: 'call-1',
        });
        expect(received).toMatchObject({ ...context, abortSignal: expect.any(AbortSignal) });
        expect(received?.abortSignal).not.toBe(context.abortSignal);
        unregisterServerTool('context_tool');
    });

    it('rejects a request definition that differs from the registered server tool', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: {
                name: 'definition_bound',
                description: 'registered',
                parameters: { type: 'object', properties: {} },
            },
            runtime: 'server',
        };
        let calls = 0;
        registerServerTool(def, () => { calls += 1; return 'nope'; }, { override: true });
        const mismatched = structuredClone(def);
        mismatched.function.description = 'client supplied';

        const result = await executeServerTool('definition_bound', '{}', undefined, {
            definition: mismatched,
        });
        expect(result.error).toContain('does not match');
        expect(calls).toBe(0);
        unregisterServerTool('definition_bound');
    });

    it('aborts timed-out handlers and does not misclassify ordinary timeout text', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: { name: 'timeout_typed', description: 'timeout', parameters: { type: 'object', properties: {} } },
            runtime: 'server',
        };
        let signal: AbortSignal | undefined;
        registerServerTool(def, (_args, context) => {
            signal = context.abortSignal;
            return new Promise(() => undefined);
        }, { override: true, timeoutMs: 5 });
        vi.useFakeTimers();
        const timed = executeServerTool(def.function.name, '{}');
        await vi.advanceTimersByTimeAsync(5);
        await expect(timed).resolves.toMatchObject({ timedOut: true });
        expect(signal?.aborted).toBe(true);
        unregisterServerTool(def.function.name);

        registerServerTool(def, () => { throw new Error('domain timeout rule'); }, { override: true });
        await expect(executeServerTool(def.function.name, '{}')).resolves.toMatchObject({
            timedOut: false,
            error: 'domain timeout rule',
        });
        unregisterServerTool(def.function.name);
    });

    it('returns a disposer scoped to the exact server registration', () => {
        const def: ToolDefinition = {
            type: 'function',
            function: { name: 'owned_server', description: 'owned', parameters: { type: 'object', properties: {} } },
            runtime: 'server',
        };
        const disposeFirst = registerServerTool(def, () => 'first', { override: true });
        const disposeSecond = registerServerTool(def, () => 'second', { override: true });
        expect(disposeFirst()).toBe(false);
        expect(getServerTool(def.function.name)).toBeDefined();
        expect(disposeSecond()).toBe(true);
        expect(disposeSecond()).toBe(false);
        expect(getServerTool(def.function.name)).toBeUndefined();
    });

    it('rejects oversized UTF-8 arguments and results', async () => {
        const def: ToolDefinition = {
            type: 'function',
            function: { name: 'bounded_server', description: 'bounded', parameters: { type: 'object', properties: {} } },
            runtime: 'server',
        };
        const handler = vi.fn(() => 'x'.repeat(1024 * 1024));
        registerServerTool(def, handler, { override: true });
        const oversizedArgs = JSON.stringify({ value: 'é'.repeat(40_000) });
        await expect(executeServerTool(def.function.name, oversizedArgs)).resolves.toMatchObject({
            error: expect.stringContaining('Tool arguments exceeds'),
        });
        expect(handler).not.toHaveBeenCalled();
        await expect(executeServerTool(def.function.name, '{}')).resolves.toMatchObject({
            error: expect.stringContaining('Tool result exceeds'),
        });
        unregisterServerTool(def.function.name);
    });
});


/** Host authorization owner. External storage alone is scripted; job identity,
 * registry, can(), scope construction and retrieval are production code. */
describe('registered canonical history authorization', () => {
    let dispose: () => void;
    let context: ToolExecutionContext;
    let allowed: boolean;
    let revokeOnOriginal: boolean;
    let reads: Array<{ actor: CanonicalHistoryActor; query: CanonicalChatQuery }>;
    let records: Map<string, CanonicalHistoryRecord>;
    let adapter: SyncGatewayAdapter;
    beforeEach(async () => {
        vi.stubGlobal('useRuntimeConfig', () => ({ auth: { enabled: true, provider: 'history-identity' }, sync: { provider: 'history-owner' }, public: { sync: { provider: 'history-owner' } }, backgroundJobs: { storageProvider: 'memory', maxConcurrentPerUser: 20, encryptionKey: 'disposable-fixture-secret' } }));
        vi.mocked(useRuntimeConfig).mockImplementation(() => (globalThis as unknown as { useRuntimeConfig(): ReturnType<typeof useRuntimeConfig> }).useRuntimeConfig());
        _resetSharedSessionCache();
        registerAuthProvider({ id: 'history-identity', create: () => ({ name: 'history-identity', getSession: async event => getHeader(event, 'authorization') === 'fixture-owner'
            ? { provider: 'history-identity', user: { id: 'identity-owner' }, expiresAt: new Date(Date.now() + 60000) } : null }) });
        resetJobProvider(); clearAllJobs(); allowed = true; revokeOnOriginal = false; reads = [];
        records = new Map([
            ['original', { id: 'original', clock: 1, thread_id: 'root', role: 'assistant', index: 0, data: { content: 'EXACT_AUTHORIZED_EVIDENCE' } }],
            ['private', { id: 'private', clock: 1, thread_id: 'sibling', role: 'assistant', index: 0, data: { content: 'NEVER_DISCLOSE_SIBLING' } }],
            ['root', { id: 'root', clock: 1 }],
            ['current', { id: 'current', clock: 1, parent_thread_id: 'root', anchor_message_id: 'original', summary_message_id: 'summary', branch_mode: 'compacted' }],
            ['summary', { id: 'summary', clock: 1, thread_id: 'current', role: 'system', index: 0, data: { kind: 'compaction', content: 'Saved summary', compaction: {
                version: 1, compaction_id: 'op', source_thread_id: 'root', anchor_message_id: 'original', anchor_index: 0, generated_at: 1, model: 'model',
                message_count: 1, prior_message_count: 0, summary_markdown: 'Saved summary', landmarks: [],
                history_scope: { version: 1, segments: [{ thread_id: 'root', messages: [{ message_id: 'original', clock: 1 }] }] }
            } } }],
        ]);
        adapter = { capabilities: { canonicalChatHistory: 'v1' }, readChatHistory: async (actor, query) => {
            reads.push({ actor, query });
            if (query.kind === 'messages') {
                const messages = query.message_ids.map(id => records.get(id)).filter((row): row is CanonicalHistoryRecord => Boolean(row));
                if (revokeOnOriginal && query.message_ids.includes('original')) allowed = false;
                return { status: 'ok', messages };
            }
            return query.kind === 'thread' ? { status: 'ok', thread: records.get(query.thread_id), revision: '1' } : { status: 'ok', messages: [] };
        } } as SyncGatewayAdapter;
        registerSyncGatewayAdapter({ id: 'history-owner', create: () => adapter });
        registerAuthWorkspaceStore({ id: 'history-owner', create: () => ({ listUserWorkspaces: async (subject: string) =>
            allowed && subject === 'owner' ? [{ id: 'workspace', name: 'Workspace', role: 'viewer' }] : [],
            getUser: async () => ({ userId: 'owner' }), getOrCreateDefaultWorkspace: async () => ({ workspaceId: 'workspace', workspaceName: 'Workspace', created: false }),
            getWorkspaceRole: async () => 'viewer' }) as unknown as AuthWorkspaceStore });
        const requestId = await memoryJobProvider.createJob({ userId: 'owner', threadId: 'current', messageId: 'assistant', model: 'model',
            syncProviderId: 'history-owner', execution: { version: 1, workspaceId: 'workspace', body: { model: 'model', messages: [] },
                referer: 'http://localhost', apiKeyCiphertext: 'unused' } });
        context = { subject: 'owner', workspaceId: 'workspace', threadId: 'current', messageId: 'assistant', requestId, callId: 'lookup', abortSignal: new AbortController().signal };
        dispose = registerServerHistoryTools();
    });
    afterEach(() => { dispose?.(); clearAllJobs(); resetJobProvider(); _resetSharedSessionCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
    async function lookup(messageId = 'original', extra: Partial<ToolExecutionContext> = {}) {
        const result = await executeServerTool('get_message', JSON.stringify({ message_id: messageId, include_after_compaction: true }), { ...context, ...extra });
        expect(result.error).toBeUndefined(); return JSON.parse(result.result!);
    }
    it('returns same-workspace evidence and denies sibling/unknown IDs through the registered tool', async () => {
        records.set('original', { ...records.get('original')!, index: 37, order_key: '37:reindexed', clock: 2 });
        expect(await lookup()).toMatchObject({ status: 'ok', message: { text: 'EXACT_AUTHORIZED_EVIDENCE', thread_id: 'root', reference_only: true,
            index: 37, order_key: '37:reindexed', changed_since_compaction: true }, neighbors: [] });
        expect(reads.every(read => read.actor.userId === 'owner' && read.actor.workspaceId === 'workspace')).toBe(true);
        expect(await lookup('private')).toMatchObject({ status: 'out_of_scope' });
        expect(await lookup('unknown')).toMatchObject({ status: 'out_of_scope' });
        expect(JSON.stringify(await lookup('private'))).not.toContain('NEVER_DISCLOSE_SIBLING');
    });
    it.each(['subject', 'workspaceId', 'threadId', 'messageId', 'requestId'] as const)('rejects forged %s before a canonical content read', async field => {
        expect(await lookup('original', { [field]: 'forged' })).toMatchObject({ status: 'scope_incomplete' }); expect(reads).toEqual([]);
    });
    it('rechecks membership before and after materialized original reads', async () => {
        allowed = false; expect(await lookup()).toMatchObject({ status: 'scope_incomplete' }); expect(reads).toEqual([]);
        allowed = true; revokeOnOriginal = true; const result = await lookup();
        expect(result).toMatchObject({ status: 'scope_incomplete' }); expect(JSON.stringify(result)).not.toContain('EXACT_AUTHORIZED_EVIDENCE');
        expect(reads.some(read => read.query.kind === 'messages' && read.query.message_ids.includes('original'))).toBe(true);
    });
    it('reports missing canonical capability and missing summary as incomplete', async () => {
        adapter.capabilities = {}; expect(await lookup()).toMatchObject({ status: 'scope_incomplete' }); expect(reads).toEqual([]);
        adapter.capabilities = { canonicalChatHistory: 'v1' }; records.delete('summary');
        expect(await lookup()).toMatchObject({ status: 'scope_incomplete' });
    });
    it('serves authenticated read-only readiness and places history tools before freezing the catalog', async () => {
        const app = createApp().use('/api/chat/history-readiness', readinessHandler); const request = toWebHandler(app);
        const endpoint = 'http://localhost/api/chat/history-readiness?thread_id=current';
        expect((await request(new Request(endpoint))).status).toBe(401); expect(reads).toEqual([]);
        const response = await request(new Request(endpoint, { headers: { authorization: 'fixture-owner' } }));
        expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
        expect(await response.json()).toEqual({ ready: true }); expect(getJobCount()).toBe(1);
        vi.stubGlobal('$fetch', async (url: string, options: { query: { thread_id: string } }) => {
            expect(url).toBe('/api/chat/history-readiness'); expect(options.query.thread_id).toBe('current');
            return (await request(new Request(endpoint, { headers: { authorization: 'fixture-owner' } }))).json();
        });
        const definitions = historyToolDefinitions.map(tool => ({ ...tool, runtime: 'client' as const }));
        const placed = await placeHistoryTools(definitions, { background: true, threadId: 'current', signal: new AbortController().signal });
        expect(placed.every(tool => tool.runtime === 'hybrid')).toBe(true); expect(definitions.every(tool => tool.runtime === 'client')).toBe(true);
        adapter.capabilities = {}; reads.length = 0;
        expect(await (await request(new Request(endpoint, { headers: { authorization: 'fixture-owner' } }))).json()).toEqual({ ready: false });
        expect(reads).toEqual([]);
        expect((await placeHistoryTools(definitions, { background: true, threadId: 'current', signal: new AbortController().signal })).every(tool => tool.runtime === 'client')).toBe(true);
        adapter.capabilities = { canonicalChatHistory: 'v1' }; const summary = records.get('summary')!; records.delete('summary');
        expect(await (await request(new Request(endpoint, { headers: { authorization: 'fixture-owner' } }))).json()).toEqual({ ready: false });
        records.set('summary', summary); allowed = false; reads.length = 0;
        expect(await (await request(new Request(endpoint, { headers: { authorization: 'fixture-owner' } }))).json()).toEqual({ ready: false });
        expect(reads).toEqual([]); expect(getJobCount()).toBe(1);
    });
    it('rejects unavailable canonical execution before job creation and admits explicit browser placement', async () => {
        adapter.capabilities = { backgroundGenerationHistory: 'v1' };
        adapter.admitChatGeneration = async () => ({ status: 'admitted', replayed: false, serverVersion: 1 });
        adapter.finalizeChatGeneration = async () => ({ status: 'committed', replayed: false, serverVersion: 2 });
        const params = { userId: 'owner', workspaceId: 'workspace', threadId: 'current', messageId: 'new-assistant', apiKey: 'fixture-key', referer: 'http://localhost',
            body: { model: 'model', messages: [{ role: 'user', content: 'Read history' }], tools: historyToolDefinitions,
                _history: { version: 1, kind: 'new-turn', admissionId: 'new-assistant', generationId: 'new-generation', workspaceId: 'workspace', threadId: 'current', messageId: 'new-assistant',
                    thread: { id: 'current', clock: 1 }, userMessage: { id: 'new-user', clock: 1, thread_id: 'current', role: 'user', data: { content: 'Read history' } },
                    assistantMessage: { id: 'new-assistant', clock: 1, thread_id: 'current', role: 'assistant', data: { content: '' } } } } };
        const create = vi.spyOn(memoryJobProvider, 'createJob');
        await expect(startBackgroundStream(params)).rejects.toThrow(); expect(create).not.toHaveBeenCalled(); expect(getJobCount()).toBe(1);
        adapter.capabilities.canonicalChatHistory = 'v1'; records.delete('summary');
        await expect(startBackgroundStream(params)).rejects.toMatchObject({ name: 'BackgroundHistoryUnsupportedError' }); expect(create).not.toHaveBeenCalled();
        const fetch = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
        vi.stubGlobal('fetch', fetch); reads.length = 0;
        const accepted = await startBackgroundStream({ ...params, body: { ...params.body, _toolRuntime: { get_message: 'client', search_parent: 'client' } } });
        expect(create).toHaveBeenCalledTimes(1); expect(reads).toEqual([]);
        await vi.waitFor(async () => expect(await memoryJobProvider.getJob(accepted.jobId, 'owner')).toMatchObject({ status: 'complete', content: 'Done' }));
        expect(fetch).toHaveBeenCalledTimes(1);
        const saved = await memoryJobProvider.getJob(accepted.jobId, 'owner');
        expect(getChatJobExecution(saved!)?.body._toolRuntime).toEqual({ get_message: 'client', search_parent: 'client' });
    });
    it('preserves an existing historical tool and cleans a partially registered sibling on collision', () => {
        dispose();
        const existing = registerServerTool(historyToolDefinitions[1]!, () => 'existing owner', { runtime: 'hybrid' });
        const original = getServerTool('search_parent');
        try {
            expect(() => registerServerHistoryTools()).toThrow();
            expect(getServerTool('search_parent')).toBe(original);
            expect(getServerTool('get_message')).toBeUndefined();
        } finally { existing(); }
    });
});
