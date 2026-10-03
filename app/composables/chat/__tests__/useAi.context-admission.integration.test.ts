import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import Dexie from 'dexie';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { useAiSettings } from '../useAiSettings';
import { useModelStore } from '../useModelStore';
import { createThreadInDb } from '~/db/threads';
import { userTranscriptData } from '~/utils/chat/transcript';
import { consumeChatSendHandled } from '~/utils/chat/send-interception';
import { useToolRegistry } from '~/utils/chat/tool-registry';

const external = vi.hoisted(() => ({ capacity: 1_000_000, bodies: [] as Record<string, unknown>[],
    catalogGate: undefined as Promise<void> | undefined, catalogEntered: undefined as (() => void) | undefined,
    toolCall: false }));
vi.unmock('~/composables/chat/useAi');
vi.mock('#imports', async (original) => ({
    ...await original<typeof import('#imports')>(),
    useRuntimeConfig: () => ({ public: { ssrAuthEnabled: false, sync: { enabled: false },
        backgroundStreaming: { enabled: false }, limits: { enabled: false },
        openRouter: { allowUserOverride: true, hasInstanceKey: false, requireUserKey: false } } }),
    useToast: () => ({ add() {} }), useAppConfig: () => ({}),
    useUserApiKey: () => ({ apiKey: ref('scripted-key'), setKey() {} }),
    useActivePrompt: () => ({ activePromptContent: ref(null) }),
    useHooks: () => useHooks(),
}));
vi.mock('~/core/auth/useOpenrouter', () => ({ useOpenRouterAuth: () => ({ startLogin() {} }) }));
vi.mock('~/composables/auth/useSessionContext', () => ({ useSessionContext: () => ({ data: ref(null) }) }));
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
    workspace = `native-context-${crypto.randomUUID()}`;
    await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine()));
    localStorage.clear(); external.capacity = 1_000_000; external.bodies = [];
    external.catalogGate = undefined; external.catalogEntered = undefined;
    external.toolCall = false;
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
