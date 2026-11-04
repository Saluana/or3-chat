import { createAiRuntime } from '~~/shared/ai/runtime';
import { createOpenRouterCompletionAdapter } from '~~/shared/openrouter/adapter';
import type { AiEvent } from '~~/shared/ai/events';
import type { AiCompletionRequest, ModelOptionDescriptor } from '~~/shared/ai/types';
import { beginNormalizedIteration, createNormalizedStreamState, reduceNormalizedStreamEvent } from '~~/shared/chat/normalized-stream-reducer';
import type { Or3DB } from '~/db/client';
import { appendMessageToDb } from '~/db/messages';
import type { ChatMessage } from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { makeAssistantPersister } from '~/utils/chat/useAi-internal/persistence';
import { ref } from 'vue';

/** Nonshipping router with an opaque identity and a deliberately different wire format. */
export async function exerciseAdapterConformance(db: Or3DB, threadId: string) {
    const bodies: unknown[] = [];
    const adapter = {
        id: 'fixture',
        options: [] as readonly ModelOptionDescriptor[],
        prepare(request: { model: { routerId: string; modelId: string }; routingOption?: string; searchOption?: string;
            messages?: AiCompletionRequest['messages']; maxOutputTokens?: number }) {
            if (request.model.routerId !== 'fixture' || request.routingOption || request.searchOption) throw new Error('Unsupported router option');
            return { id: request.model.modelId, ...(request.messages ? { input: request.messages, limit: request.maxOutputTokens } : {}) };
        },
        async *decodeStream(response: Response): AsyncGenerator<AiEvent> {
            const payload = await response.json() as { answer: string; operation: { id: string; name: string; arguments: string } };
            yield { type: 'text', text: payload.answer };
            yield { type: 'tool_call', tool_call: { id: payload.operation.id, type: 'function',
                function: { name: payload.operation.name, arguments: payload.operation.arguments } } };
            yield { type: 'done' };
        },
        async decodeCompletion(response: Response) {
            const payload = await response.json() as { answer: string };
            return { content: payload.answer };
        },
    };
    const runtime = createAiRuntime(adapter, async body => {
        bodies.push(body);
        return Response.json({ answer: 'Fixture response', operation: { id: 'call-1', name: 'fixture_tool', arguments: '{"value":1}' } });
    });
    let state = beginNormalizedIteration(createNormalizedStreamState());
    const events: string[] = [];
    for await (const event of runtime.stream({ model: { routerId: 'fixture', modelId: 'vendor/model:online:free' } })) {
        events.push(event.type);
        state = reduceNormalizedStreamEvent(state, event);
    }
    let unsupported = '';
    try {
        for await (const _event of runtime.stream({ model: { routerId: 'fixture', modelId: 'native:model' }, routingOption: 'nitro' })) { /* consume */ }
    } catch (error) { unsupported = error instanceof Error ? error.message : String(error); }
    let unsupportedSearch = '';
    try {
        for await (const _event of runtime.stream({ model: { routerId: 'fixture', modelId: 'native:model' }, searchOption: 'web' })) { /* consume */ }
    } catch (error) { unsupportedSearch = error instanceof Error ? error.message : String(error); }
    const fixtureRequest: AiCompletionRequest = { model: { routerId: 'fixture', modelId: 'vendor/model:online' },
        messages: [{ role: 'user', content: 'Fixture completion' }], maxOutputTokens: 12 };
    const fixtureCompletion = await runtime.complete(fixtureRequest);
    const completionBodies: unknown[] = [];
    const completionRuntime = createAiRuntime(createOpenRouterCompletionAdapter({ explicitStreamFalse: true }), async body => {
        completionBodies.push(body);
        return Response.json({ choices: [{ message: { content: 'Fixture title' }, finish_reason: 'stop' }] });
    });
    const completion = await completionRuntime.complete({
        model: { routerId: 'openrouter', modelId: 'vendor/model:free' },
        messages: [{ role: 'user', content: 'Title this' }],
        maxOutputTokens: 48,
        reasoning: { kind: 'disabled' },
    });
    let wrongRouter = '';
    try {
        await completionRuntime.complete({ model: { routerId: 'fixture', modelId: 'vendor/model:free' },
            messages: [{ role: 'user', content: 'Must not dispatch' }], maxOutputTokens: 48 });
    } catch (error) { wrongRouter = error instanceof Error ? error.message : String(error); }
    const foreground = await import('~/utils/chat/useAi-internal/foregroundStream');
    type FixtureRequest = { model: { routerId: string; modelId: string }; messages: readonly unknown[] };
    type ForegroundContext = Parameters<typeof foreground.runForegroundStreamLoop>[0];
    const createLoop = (foreground as unknown as { createForegroundStreamLoop?: (routerId: string,
        stream: (request: FixtureRequest) => AsyncIterable<AiEvent>) => (context: ForegroundContext) => Promise<void> }).createForegroundStreamLoop;
    if (!createLoop) return { bodies, events, text: state.cumulativeText, tool: state.tools['call-1'], options: adapter.options,
        unsupported, unsupportedSearch, fixtureCompletion, completion, completionBodies, wrongRouter,
        loopError: 'The foreground consumer cannot accept a selected adapter.' };
    const user = await appendMessageToDb(db, { thread_id: threadId, role: 'user', data: { content: 'Fixture prompt' } });
    const generationId = 'fixture-generation';
    const assistant = await appendMessageToDb(db, { thread_id: threadId, role: 'assistant', pending: true,
        stream_id: generationId, data: { content: '', generation_id: generationId } });
    const loopBodies: Array<{ id: string; input: readonly unknown[] }> = [];
    const loopRuntime = createAiRuntime({
        id: 'fixture',
        prepare(request: FixtureRequest) {
            if (request.model.routerId !== 'fixture') throw new Error('Wrong fixture router');
            return { id: request.model.modelId, input: structuredClone(request.messages) };
        },
        async *decodeStream(response: Response): AsyncGenerator<AiEvent> {
            const payload = await response.json() as { answer?: string; operation?: { id: string; name: string; arguments: string } };
            if (payload.operation) yield { type: 'tool_call', tool_call: { id: payload.operation.id, type: 'function',
                function: { name: payload.operation.name, arguments: payload.operation.arguments } } };
            if (payload.answer) yield { type: 'text', text: payload.answer };
            yield { type: 'done' };
        },
    }, async body => {
        loopBodies.push(body);
        return Response.json(loopBodies.length === 1
            ? { operation: { id: 'fixture-call', name: 'fixture_tool', arguments: '{}' } }
            : { answer: 'Fixture final answer' });
    });
    let toolExecutions = 0;
    let receiptBeforeExecution = '';
    const tailAssistant = ref<UiChatMessage | null>(null);
    const execute = createLoop('fixture', request => loopRuntime.stream(request));
    await execute({ apiKey: null, modelId: 'vendor/model:online:free',
        orMessages: [{ role: 'user', content: [{ type: 'text', text: 'Fixture prompt' }] }],
        modalities: ['text'], tools: [{ type: 'function', function: { name: 'fixture_tool', description: 'Fixture tool',
            parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
        abortSignal: new AbortController().signal, assistantId: assistant.id, parentTurnId: user.id,
        streamId: generationId, threadId, originDb: db, streamAcc: { append() {} },
        hooks: { async doAction() {} }, toolRegistry: { async executeTool() {
            toolExecutions++;
            const row = await db.messages.get(assistant.id);
            const calls = (row?.data as { tool_calls?: Array<{ executionReceipt?: { state?: string } }> } | null)?.tool_calls;
            receiptBeforeExecution = calls?.[0]?.executionReceipt?.state ?? '';
            return { result: 'fixture result', toolName: 'fixture_tool', timedOut: false };
        } }, persistAssistant: makeAssistantPersister(db, assistant, []), assistantFileHashes: [], activeToolCalls: new Map(),
        tailAssistant, rawMessages: ref<ChatMessage[]>([]) });
    const savedAssistant = await db.messages.get(assistant.id);
    const savedData = savedAssistant?.data as { content?: string; tool_calls?: Array<{ executionReceipt?: { state?: string } }> } | null;
    const toolRows = (await db.messages.where('thread_id').equals(threadId).toArray()).filter(row => row.role === 'tool');
    const loop = { models: loopBodies.map(body => body.id), toolExecutions, receiptBeforeExecution,
        assistantText: savedData?.content, toolResult: JSON.stringify(toolRows.at(-1)?.data),
        followup: JSON.stringify(loopBodies[1]?.input), savedToolState: savedData?.tool_calls?.[0]?.executionReceipt?.state };
    return { bodies, events, text: state.cumulativeText, tool: state.tools['call-1'], options: adapter.options,
        unsupported, unsupportedSearch, fixtureCompletion, completion, completionBodies, wrongRouter, loop };
}
