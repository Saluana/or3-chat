import Dexie from 'dexie';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getDb, setActiveWorkspaceDb, evictWorkspaceDb } from '~/db/client';
import { makeAssistantPersister } from '../persistence';
import { runForegroundStreamLoop, type ForegroundStreamContext } from '../foregroundStream';
import { assistantTranscriptData, storedMessagesToCanonicalTranscript } from '~/utils/chat/transcript';
import { captureUsagePrefix, attachRequestUsage } from '~~/shared/chat/request-usage';
import { countTokensApprox } from '~/utils/chat/tokens';
import { createHookEngine } from '~/core/hooks/hooks';
import { createTypedHookEngine } from '~/core/hooks/typed-hooks';
import { setHookEngine, useHooks } from '~/core/hooks/useHooks';
import type { StoredMessage } from '../types';
import type { openRouterStream } from '~/utils/chat/openrouterStream';
import type { ORStreamEvent } from '~~/shared/openrouter/parseOpenRouterSSE';
const provider = vi.hoisted(() => vi.fn());
vi.mock('~/utils/chat/openrouterStream', () => ({ openRouterStreamWithRetry: provider }));
let workspace: string;
beforeEach(async () => {
    workspace = `foreground-usage-${crypto.randomUUID()}`; await setActiveWorkspaceDb(workspace).open();
    setHookEngine(createTypedHookEngine(createHookEngine())); provider.mockReset();
    await getDb().threads.put({ id: 'thread', status: 'ready', clock: 1, created_at: 1, updated_at: 1, deleted: false, pinned: false, forked: false });
    // Match foreground admission: stream/generation identity differs from the
    // request lease used by the persister. A lease alone cannot authorize tools.
    await getDb().messages.put({ id: 'assistant', thread_id: 'thread', role: 'assistant', stream_id: 'generation', index: 1, clock: 1, created_at: 1, updated_at: 1, pending: true, deleted: false,
        data: { ...assistantTranscriptData({ turnId: 'turn', requestId: 'request-lease', generationId: 'generation', mode: 'foreground' }),
            content: '', plugin_owned: 'preserve', generation_lease_id: 'request-lease', generation_state: 'streaming' } });
});
afterEach(async () => { const db = getDb(); setActiveWorkspaceDb(null); evictWorkspaceDb(workspace); await Dexie.delete(db.name); setHookEngine(null); });
it.each([true, false])('persists the last measured request across the actual tool-loop and canonical reload (final usage %s)', async (finalUsage) => {
    const db = getDb(); const initial = (await db.messages.get('assistant'))! as StoredMessage; const persist = makeAssistantPersister(db, initial, [], 'request-lease');
    let requestNumber = 0;
    provider.mockImplementation(async function* (request: Parameters<typeof openRouterStream>[0]): AsyncGenerator<ORStreamEvent> {
        requestNumber += 1;
        const prefix = await captureUsagePrefix({ model: request.model, messages: request.orMessages, tools: request.tools, countText: countTokensApprox });
        if (requestNumber === 1) yield { type: 'tool_call', tool_call: { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } } };
        else yield { type: 'text', text: 'Completed answer' };
        if (requestNumber === 1 || finalUsage) {
            const usage = { prompt_tokens: requestNumber === 1 ? 100 : 150, completion_tokens: 20, response_id: `provider-${requestNumber}` };
            const event: ORStreamEvent = { type: 'usage', usage, requestUsage: attachRequestUsage(prefix, usage, { requestId: 'host', iteration: 1, measuredAt: 123 }) };
            yield event; yield event;
        }
        yield { type: 'done' };
    });
    const executeTool = vi.fn(async () => ({ result: 'Accepted tool result', toolName: 'lookup', timedOut: false }));
    const ctx: ForegroundStreamContext = { apiKey: 'scripted', modelId: 'model', orMessages: [{ role: 'user', content: [{ type: 'text', text: 'Task' }] }], modalities: ['text'],
        tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } } }],
        abortSignal: new AbortController().signal, assistantId: 'assistant', streamId: 'generation', threadId: 'thread', workspaceId: workspace, originDb: db,
        streamAcc: { append: vi.fn() }, hooks: useHooks(), toolRegistry: { executeTool }, persistAssistant: persist, assistantFileHashes: [], activeToolCalls: new Map(),
        tailAssistant: { value: null }, rawMessages: { value: [] } };
    await runForegroundStreamLoop(ctx); await persist({ finalize: true });
    const row = (await db.messages.get('assistant'))!; const canonical = storedMessagesToCanonicalTranscript([row])[0]!;
    expect(canonical.usage).toMatchObject({ prompt_tokens: finalUsage ? 150 : 100, completion_tokens: 20, iteration: finalUsage ? 2 : 1,
        request_id: finalUsage ? 'provider-2' : 'provider-1', prefix_message_count: finalUsage ? 3 : 1 });
    expect(canonical.content).toBe('Completed answer'); expect(row.data).toMatchObject({ plugin_owned: 'preserve', generation_id: 'generation', generation_lease_id: 'request-lease' });
    expect(row.stream_id).toBe('generation');
    expect(executeTool).toHaveBeenCalledOnce(); expect(provider).toHaveBeenCalledTimes(2);
    expect((await db.messages.where('thread_id').equals('thread').toArray()).filter((item) => item.role === 'tool')).toHaveLength(1);
});
it('flushes measured usage before a provider interruption without bypassing the generation lease', async () => {
    const db = getDb(); const initial = (await db.messages.get('assistant'))! as StoredMessage; const persist = makeAssistantPersister(db, initial, [], 'request-lease');
    provider.mockImplementation(async function* (request: Parameters<typeof openRouterStream>[0]): AsyncGenerator<ORStreamEvent> {
        const prefix = await captureUsagePrefix({ model: request.model, messages: request.orMessages, countText: countTokensApprox });
        const usage = { prompt_tokens: 77, completion_tokens: 0, response_id: 'interrupted' };
        yield { type: 'usage', usage, requestUsage: attachRequestUsage(prefix, usage, { requestId: 'host', iteration: 1, measuredAt: 123 }) };
        throw new Error('Scripted interruption after measurement');
    });
    const ctx: ForegroundStreamContext = { apiKey: 'scripted', modelId: 'model', orMessages: [{ role: 'user', content: [{ type: 'text', text: 'Task' }] }], modalities: ['text'], tools: [],
        abortSignal: new AbortController().signal, assistantId: 'assistant', streamId: 'generation', threadId: 'thread', workspaceId: workspace, originDb: db,
        streamAcc: { append: vi.fn() }, hooks: useHooks(), toolRegistry: { executeTool: vi.fn() }, persistAssistant: persist, assistantFileHashes: [], activeToolCalls: new Map(),
        tailAssistant: { value: null }, rawMessages: { value: [] } };
    await expect(runForegroundStreamLoop(ctx)).rejects.toThrow('Scripted interruption after measurement');
    const row = (await db.messages.get('assistant'))!;
    expect(storedMessagesToCanonicalTranscript([row])[0]?.usage).toMatchObject({ prompt_tokens: 77, completion_tokens: 0, request_id: 'interrupted' });
    expect(row.data).toMatchObject({ plugin_owned: 'preserve', generation_id: 'generation', generation_lease_id: 'request-lease' });
    expect(ctx.toolRegistry.executeTool).not.toHaveBeenCalled();
});
