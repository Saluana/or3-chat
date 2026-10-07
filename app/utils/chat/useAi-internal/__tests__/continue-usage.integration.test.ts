import Dexie from 'dexie';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { continueMessageImpl, type ContinueMessageContext } from '../continue';
import { createChatRequest } from '../requestController';
import { storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { captureUsagePrefix, attachRequestUsage } from '~~/shared/chat/request-usage';
import { countTokensApprox } from '~/utils/chat/tokens';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import type { ORStreamEvent } from '~~/shared/openrouter/parseOpenRouterSSE';
const provider = vi.hoisted(() => vi.fn());
vi.mock('~/utils/chat/openrouterStream', async (original) => ({
    ...await original<typeof import('~/utils/chat/openrouterStream')>(),
    openRouterStreamWithRetry: provider, startBackgroundStream: vi.fn(),
}));
let workspace: string;
beforeEach(async () => {
    workspace = `continue-usage-${crypto.randomUUID()}`; await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine())); provider.mockReset();
    await getDb().threads.put({ id: 'thread', status: 'ready', clock: 1, created_at: 1, updated_at: 1, deleted: false, pinned: false, forked: false });
    await getDb().messages.bulkPut([
        { id: 'user', thread_id: 'thread', role: 'user', index: 0, clock: 1, created_at: 1, updated_at: 1, pending: false, deleted: false, data: { content: 'Continue this' } },
        { id: 'assistant', thread_id: 'thread', role: 'assistant', index: 1, clock: 1, created_at: 1, updated_at: 1, pending: false, deleted: false,
            data: { content: 'Hello', plugin_owned: 'preserve' } },
    ]);
});
afterEach(async () => { const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); setHookEngine(null); });
it.each([false, true])('persists measured continuation usage through canonical reload (provider interruption %s)', async (interrupted) => {
    provider.mockImplementation(async function* (input: Parameters<typeof captureUsagePrefix>[0] & { orMessages: Parameters<typeof captureUsagePrefix>[0]['messages'] }): AsyncGenerator<ORStreamEvent> {
        const prefix = await captureUsagePrefix({ model: input.model, messages: input.orMessages, countText: countTokensApprox });
        yield { type: 'text', text: '>> world' };
        const usage = { prompt_tokens: 456, completion_tokens: 12, response_id: 'continued-request' };
        yield { type: 'usage', usage, requestUsage: attachRequestUsage(prefix, usage, { requestId: 'host', iteration: 1, measuredAt: 123 }) };
        if (interrupted) throw new Error('Scripted interruption after measurement');
        yield { type: 'done' };
    });
    const db = getDb(); const accumulator = { reset: vi.fn(), append: vi.fn(), finalize: vi.fn(), state: { finalized: false } };
    const request = createChatRequest({ requestId: 'continue', kind: 'continue', originDb: db, workspaceId: workspace, threadId: 'thread', accumulator });
    request.ownsView = () => !request.cancelled;
    const ctx: ContinueMessageContext = { request, loading: ref(false), aborted: ref(false), abortController: ref(null),
        threadIdRef: ref('thread'), tailAssistant: ref(null), rawMessages: ref([]), messages: ref([]), streamId: ref(undefined),
        streamAcc: accumulator, streamState: accumulator.state, hooks: useHooks(),
        effectiveApiKey: ref('scripted'), hasInstanceKey: ref(false), defaultModelId: 'model', getSystemPromptContent: async () => null,
        useAiSettings: () => ({ settings: ref(undefined) }), resetStream: vi.fn(),
        resolveContextPolicy: async () => ({ model: { context_length: 1_000_000 },
            userMaxContextTokens: null, source: 'openrouter-live' }) };
    await continueMessageImpl(ctx, 'assistant');
    const stored = (await db.messages.get('assistant'))!; const canonical = storedMessagesToCanonicalTranscript([stored])[0]!;
    expect(canonical.content).toBe('Hello world');
    expect(canonical.usage).toMatchObject({ prompt_tokens: 456, completion_tokens: 12, request_id: 'continued-request', iteration: 1, prefix_message_count: 2 });
    expect(stored.data).toMatchObject({ plugin_owned: 'preserve' }); expect(stored.pending).toBe(false);
    expect(provider).toHaveBeenCalledOnce(); expect((await db.messages.toArray()).map((row) => row.id).sort()).toEqual(['assistant', 'user']);
    expect(request.phase.value).toBe('terminal');
});

it('refuses an unbound continuation without model policy before any target mutation or provider call', async () => {
    provider.mockImplementation(async function* () { yield { type: 'text', text: 'Must not run' }; yield { type: 'done' }; });
    const db = getDb(); const before = await db.messages.toArray();
    const accumulator = { reset: vi.fn(), append: vi.fn(), finalize: vi.fn(), state: { finalized: false } };
    const request = createChatRequest({ requestId: 'missing-policy', kind: 'continue', originDb: db,
        workspaceId: workspace, threadId: 'thread', accumulator });
    request.ownsView = () => !request.cancelled;
    const ctx: ContinueMessageContext = { request, loading: ref(false), aborted: ref(false), abortController: ref(null),
        threadIdRef: ref('thread'), tailAssistant: ref(null), rawMessages: ref([]), messages: ref([]), streamId: ref(undefined),
        streamAcc: accumulator, streamState: accumulator.state, hooks: useHooks(), effectiveApiKey: ref('scripted'),
        hasInstanceKey: ref(false), defaultModelId: 'model', getSystemPromptContent: async () => null,
        useAiSettings: () => ({ settings: ref(undefined) }), resetStream: vi.fn() };
    await continueMessageImpl(ctx, 'assistant');
    expect(await db.messages.toArray()).toEqual(before);
    expect(provider).not.toHaveBeenCalled();
    expect(request.publicState.value).toMatchObject({ status: 'terminal', result: { reason: 'model_metadata_unavailable' } });
});
