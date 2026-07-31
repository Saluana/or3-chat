/**
 * @module app/utils/chat/useAi-internal/foregroundStream.ts
 *
 * Purpose:
 * Foreground streaming loop for real-time AI responses. Manages the complete
 * streaming lifecycle including tool execution, multi-turn conversations,
 * and throttled persistence to balance responsiveness with database performance.
 *
 * Responsibilities:
 * - Execute OpenRouter streaming requests for foreground (non-background) mode
 * - Handle tool calls and execute them via ToolRegistry
 * - Support multi-turn tool loops (up to 10 iterations)
 * - Persist assistant content with throttled cadence (500ms or 50 chunks)
 * - Process reasoning text and image generation separately
 * - Update UI assistant state and track tool call status
 * - Convert generated images to hash references for storage
 *
 * Non-responsibilities:
 * - Hook orchestration before/after (handled by caller)
 * - Background job management (separate module)
 * - Message creation and initial setup
 * - Error reporting and retry logic
 *
 * Architecture:
 * - Single-threaded streaming with async iteration
 * - Tool results appended as separate messages for context window
 * - Throttled writes to reduce IndexedDB pressure
 * - Image blobs stored via createOrRefFile with hash placeholders
 *
 * Invariants:
 * - Tool execution capped at 10 iterations to prevent infinite loops
 * - Every 50 chunks or 500ms triggers a persist (whichever comes first)
 * - Generated images limited to 6 per response
 * - Tool calls always tracked in activeToolCalls Map
 */

import { createOrRefFile } from '~/db/files';
import type { ChatMessage, ToolCall, ToolDefinition } from '~/utils/chat/types';
import { dataUrlToBlob, fetchImageBlob } from '~/utils/chat/files';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import {
    ensureUiMessage,
    type UiChatMessage,
} from '~/utils/chat/uiMessages';
import {
    openRouterStreamWithRetry,
    type OpenRouterReasoningConfig,
} from '~/utils/chat/openrouterStream';
import { MAX_TOOL_ITERATIONS } from '~/utils/chat/constants';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import type {
    AssistantPersister,
    OpenRouterMessage,
    ToolResultPayload,
} from './types';
import type { ToolExecutionContext } from '~/utils/chat/types';
import { snapshotToolDefinitions } from '~~/shared/chat/tool-policy';
import {
    projectToolResult,
    utf8Bytes,
} from '~~/shared/chat/tool-limits';
import {
    decideToolCall,
    toolCallFingerprint,
    type ToolLedgerEntry,
} from '~~/shared/chat/tool-ledger';
import { appendForegroundToolResult } from '~/utils/chat/transcript-repository';
import { createStreamWriteCoalescer } from './streamWriteCoalescer';
import {
    appendNormalizedAssistantText,
    beginNormalizedIteration,
    createNormalizedStreamState,
    failNormalizedStream,
    finishNormalizedIteration,
    reduceNormalizedStreamEvent,
    settleNormalizedTool,
} from '~~/shared/chat/normalized-stream-reducer';

/**
 * Internal type. Stream accumulator interface for buffering text/reasoning.
 */
type StreamAccumulatorLike = {
    append: (text: string, opts: { kind: 'text' | 'reasoning' }) => void;
};

/**
 * Internal type. Minimal hook interface for emitting stream events.
 */
type HooksLike = {
    doAction: (name: string, ...args: unknown[]) => Promise<unknown>;
};

/**
 * Internal type. Tool execution interface from ToolRegistry.
 */
type ToolRegistryLike = {
    executeTool: (
        name: string,
        args: string,
        context?: ToolExecutionContext,
        admission?: { definition: ToolDefinition }
    ) => Promise<{
        result: string | null;
        toolName: string;
        error?: string;
        timedOut: boolean;
    }>;
};

/**
 * Internal type. Vue ref-like interface for reactive values.
 */
type RefLike<T> = { value: T };

type StreamHookDispatcher = {
    dispatch: (name: string, ...args: unknown[]) => void;
    flush: () => Promise<void>;
};

export const MAX_STREAM_HOOK_BACKLOG = 64;
export const STREAM_HOOK_FLUSH_TIMEOUT_MS = 2_000;

function createStreamHookDispatcher(hooks: HooksLike): StreamHookDispatcher {
    type HookJob = { name: string; args: unknown[] };
    const queue: HookJob[] = [];
    const idleWaiters = new Set<() => void>();
    let running = false;

    const resolveIdle = () => {
        if (running || queue.length > 0) return;
        for (const resolve of idleWaiters) resolve();
        idleWaiters.clear();
    };

    const pump = () => {
        if (running) return;
        const next = queue.shift();
        if (!next) {
            resolveIdle();
            return;
        }
        running = true;
        void Promise.resolve(hooks.doAction(next.name, ...next.args))
            .catch(() => {
                /* isolate hook failures from stream consumption */
            })
            .finally(() => {
                running = false;
                pump();
            });
    };

    return {
        dispatch(name: string, ...args: unknown[]) {
            // Bound retained per-token work. Once saturated, discard the oldest
            // queued (not currently executing) hook so recent progress wins.
            if (queue.length >= MAX_STREAM_HOOK_BACKLOG) queue.shift();
            queue.push({ name, args });
            pump();
        },
        async flush() {
            if (!running && queue.length === 0) return;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let idleResolve: (() => void) | undefined;
            await Promise.race([
                new Promise<void>((resolve) => {
                    idleResolve = resolve;
                    idleWaiters.add(resolve);
                }),
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, STREAM_HOOK_FLUSH_TIMEOUT_MS);
                }),
            ]);
            if (timer !== undefined) clearTimeout(timer);
            if (idleResolve) idleWaiters.delete(idleResolve);
            // A permanently slow consumer must not retain all queued payloads or
            // prevent terminal persistence. The active callback stays isolated.
            if (running || queue.length > 0) queue.length = 0;
        },
    };
}

/**
 * Context object required for foreground streaming operations.
 *
 * Purpose:
 * Encapsulates all dependencies for the streaming loop including API configuration,
 * UI state refs, persistence callbacks, and tool execution.
 *
 * Constraints:
 * - assistantId and streamId must be pre-generated
 * - threadId must reference existing thread
 * - abortSignal controls cancellation
 * - activeToolCalls is mutated during tool execution
 */
export type ForegroundStreamContext = {
    apiKey: string | null;
    modelId: string;
    orMessages: OpenRouterMessage[];
    modalities: string[];
    reasoning?: OpenRouterReasoningConfig;
    tools?: ToolDefinition[];
    abortSignal: AbortSignal;
    assistantId: string;
    parentTurnId?: string;
    streamId: string;
    threadId: string;
    streamAcc: StreamAccumulatorLike;
    hooks: HooksLike;
    toolRegistry: ToolRegistryLike;
    persistAssistant: AssistantPersister;
    assistantFileHashes: string[];
    activeToolCalls: Map<string, ToolCallInfo>;
    tailAssistant: RefLike<UiChatMessage | null>;
    rawMessages: RefLike<ChatMessage[]>;
    toolLedger?: Map<string, ToolLedgerEntry>;
};

/**
 * `ai.chat.stream:action:*` (action)
 *
 * Purpose:
 * Main foreground streaming loop that processes AI responses in real-time,
 * handling text, reasoning, images, and tool calls with support for multi-turn
 * tool execution.
 *
 * Behavior:
 * 1. Opens OpenRouter stream with provided context
 * 2. Processes stream events:
 *    - `text`: Appends to assistant content, emits `ai.chat.stream:action:delta`
 *    - `reasoning`: Tracks separately, emits `ai.chat.stream:action:reasoning`
 *    - `image`: Stores blob, creates hash placeholder, appends to content
 *    - `tool_call`: Queues for execution, updates UI with loading state
 * 3. Throttled persistence every 500ms or 50 chunks
 * 4. On tool calls: executes via ToolRegistry, appends results as tool messages
 * 5. Loops back for additional turns if tools returned results (max 10 iterations)
 *
 * Hook Emissions:
 * - `ai.chat.stream:action:delta` - Text chunk received
 *   Payload: `{ threadId, assistantId, streamId, deltaLength, totalLength, chunkIndex }`
 * - `ai.chat.stream:action:reasoning` - Reasoning chunk received
 *   Payload: `{ threadId, assistantId, streamId, reasoningLength }`
 *
 * Constraints:
 * - Max 10 tool iterations to prevent infinite loops
 * - Images capped at 6 per response
 * - Persists every 500ms OR every 50 chunks (whichever first)
 * - Tool results >500KB get UI summary with truncation notice
 * - Throws on stream error during first iteration
 *
 * Image Handling:
 * - Data URLs and HTTP URLs converted to blobs
 * - Stored via createOrRefFile with hash reference
 * - Uses transparent pixel placeholder in markdown with hash in alt text
 * - Prevents console errors from invalid image URLs
 *
 * Tool Execution Flow:
 * 1. Tool call detected in stream → added to activeToolCalls (loading state)
 * 2. Stream ends → executeTool called for each pending tool
 * 3. Result appended as tool role message via tx.appendMessage
 * 4. Tool result added to orMessages for context window
 * 5. If any tools executed, loop continues for assistant response
 *
 * Non-Goals:
 * - Does not handle background/offline streaming
 * - Does not retry failed streams
 * - Does not validate tool definitions
 *
 * @example
 * ```ts
 * const ctx: ForegroundStreamContext = {
 *   apiKey: 'sk-...',
 *   modelId: 'gpt-4',
 *   orMessages: [{ role: 'user', content: 'Hello' }],
 *   modalities: ['text'],
 *   tools: myToolDefinitions,
 *   abortSignal: controller.signal,
 *   assistantId: 'assistant-123',
 *   streamId: 'stream-456',
 *   threadId: 'thread-789',
 *   streamAcc: { append: (text, opts) => { ... } },
 *   hooks: { doAction: async () => {} },
 *   toolRegistry: { executeTool: async () => ({ result: '', toolName: '', timedOut: false }) },
 *   persistAssistant: async () => '',
 *   assistantFileHashes: [],
 *   activeToolCalls: new Map(),
 *   tailAssistant: { value: null },
 *   rawMessages: { value: [] }
 * };
 *
 * await runForegroundStreamLoop(ctx);
 * ```
 *
 * @see ai.chat.send:action:before for send initiation
 * @see backgroundJobs.ts for background streaming variant
 */
export async function runForegroundStreamLoop(
    ctx: ForegroundStreamContext
): Promise<void> {
    const admittedTools = snapshotToolDefinitions(ctx.tools);
    const admittedByName = new Map(
        (admittedTools ?? []).map((definition) => [definition.function.name, definition])
    );
    let normalizedState = createNormalizedStreamState();
    const toolLedger = ctx.toolLedger ?? new Map<string, ToolLedgerEntry>();

    while (normalizedState.terminal === 'active') {
        normalizedState = beginNormalizedIteration(normalizedState);
        const streamHooks = createStreamHookDispatcher(ctx.hooks);

        const stream = openRouterStreamWithRetry({
            apiKey: ctx.apiKey,
            model: ctx.modelId,
            orMessages: ctx.orMessages as Parameters<
                typeof openRouterStreamWithRetry
            >[0]['orMessages'],
            modalities: ctx.modalities,
            reasoning: ctx.reasoning,
            threadId: ctx.threadId,
            messageId: ctx.assistantId,
            tools: admittedTools,
            signal: ctx.abortSignal,
        });

        const rawAssistant: ChatMessage = {
            role: 'assistant',
            content: '',
            id: ctx.assistantId,
            stream_id: ctx.streamId,
            reasoning_text: null,
        };

        if (normalizedState.iteration === 1) {
            ctx.rawMessages.value.push(rawAssistant);
            const uiAssistant = ensureUiMessage(rawAssistant);
            uiAssistant.pending = true;
            ctx.tailAssistant.value = uiAssistant;
        }

        const current = ctx.tailAssistant.value || ensureUiMessage(rawAssistant);
        // Provider context is iteration-local. `current.text` remains cumulative
        // for the UI and durable assistant row across the whole tool loop.
        const writeCoalescer = createStreamWriteCoalescer();
        const pendingToolCalls: ToolCall[] = [];

        const flushProgress = async () => {
            if (!writeCoalescer.hasDirty()) return;
            await ctx.persistAssistant({
                content: current.text,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? undefined,
            });
            if (ctx.assistantFileHashes.length) {
                current.file_hashes = ctx.assistantFileHashes;
            }
            writeCoalescer.flushed();
        };

        try {
            for await (const ev of stream) {
                normalizedState = reduceNormalizedStreamEvent(normalizedState, ev);
                if (ev.type === 'tool_call') {
                    // Tool call detected - enqueue for execution after stream closes
                    if (current.pending) current.pending = false;

                    const toolCall = ev.tool_call;

                    // Add tool call to tracking with loading status
                    ctx.activeToolCalls.set(toolCall.id, {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        status: 'loading',
                        args: toolCall.function.arguments,
                        fingerprint: toolCallFingerprint(
                            toolCall.function.name,
                            toolCall.function.arguments
                        ),
                    });

                    // Update UI with loading state
                    current.toolCalls = Array.from(
                        ctx.activeToolCalls.values()
                    );

                    pendingToolCalls.push(toolCall);
                    writeCoalescer.markDirty(
                        toolCall.function.name.length +
                            toolCall.function.arguments.length
                    );
                } else if (ev.type === 'reasoning') {
                    current.reasoning_text = normalizedState.reasoningText;
                    ctx.streamAcc.append(ev.text, { kind: 'reasoning' });
                    streamHooks.dispatch(
                        'ai.chat.stream:action:reasoning',
                        ev.text,
                        {
                            threadId: ctx.threadId,
                            assistantId: ctx.assistantId,
                            streamId: ctx.streamId,
                            reasoningLength: current.reasoning_text?.length || 0,
                        }
                    );
                    writeCoalescer.markDirty(utf8Bytes(ev.text));
                } else if (ev.type === 'text') {
                    if (current.pending) current.pending = false;
                    const delta = ev.text;
                    ctx.streamAcc.append(delta, { kind: 'text' });
                    streamHooks.dispatch(
                        'ai.chat.stream:action:delta',
                        delta,
                        {
                            threadId: ctx.threadId,
                            assistantId: ctx.assistantId,
                            streamId: ctx.streamId,
                            deltaLength: delta.length,
                            totalLength: normalizedState.cumulativeText.length,
                            chunkIndex: normalizedState.chunks - 1,
                        }
                    );
                    current.text = normalizedState.cumulativeText;
                    writeCoalescer.markDirty(utf8Bytes(delta));
                } else if (ev.type === 'image') {
                    if (current.pending) current.pending = false;
                    // Store image first, then use hash placeholder (not Base64)
                    if (ctx.assistantFileHashes.length < 6) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/'))
                            blob = dataUrlToBlob(ev.url);
                        else if (/^https?:/.test(ev.url)) {
                            blob = await fetchImageBlob(ev.url);
                        }
                        if (blob) {
                            try {
                                const meta = await createOrRefFile(
                                    blob,
                                    'gen-image'
                                );
                                ctx.assistantFileHashes.push(meta.hash);
                                // Use valid 1x1 transparent pixel and store hash in alt text to eliminate console errors
                                const placeholder = `![file-hash:${meta.hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`;
                                const already = current.text.includes(placeholder);
                                if (!already) {
                                    const separator = current.text ? '\n\n' : '';
                                    const iterationSeparator = normalizedState.iterationText
                                        ? '\n\n'
                                        : '';
                                    normalizedState = appendNormalizedAssistantText(
                                        normalizedState,
                                        separator + placeholder,
                                        { iterationText: iterationSeparator + placeholder }
                                    );
                                    current.text = normalizedState.cumulativeText;
                                }
                                current.file_hashes = ctx.assistantFileHashes;
                                writeCoalescer.markDirty(placeholder.length);
                            } catch {
                                /* intentionally empty */
                            }
                        } else {
                            // Fallback: couldn't convert to blob, use URL directly
                            const placeholder = `![generated image](${ev.url})`;
                            const already = current.text.includes(placeholder);
                            if (!already) {
                                const separator = current.text ? '\n\n' : '';
                                const iterationSeparator = normalizedState.iterationText
                                    ? '\n\n'
                                    : '';
                                normalizedState = appendNormalizedAssistantText(
                                    normalizedState,
                                    separator + placeholder,
                                    { iterationText: iterationSeparator + placeholder }
                                );
                                current.text = normalizedState.cumulativeText;
                                writeCoalescer.markDirty(placeholder.length);
                            }
                        }
                    }
                }

                // Batch writes: persist every 500ms OR every 50 chunks (whichever comes first)
                // to reduce DB pressure while maintaining progress safety
                if (writeCoalescer.shouldFlush()) await flushProgress();
            }

            // A short or non-text-only stream still reaches durable storage.
            await flushProgress();

            await streamHooks.flush();

            if (pendingToolCalls.length > 0) {
                const toolResultsForNextLoop: ToolResultPayload[] = [];

                for (const toolCall of pendingToolCalls) {
                    const admittedDefinition = admittedByName.get(toolCall.function.name);
                    if (!admittedDefinition) {
                        const error = `Tool "${toolCall.function.name}" was not advertised for this request.`;
                        const fingerprint = toolCallFingerprint(
                            toolCall.function.name,
                            toolCall.function.arguments
                        );
                        ctx.activeToolCalls.set(toolCall.id, {
                            id: toolCall.id,
                            name: toolCall.function.name,
                            status: 'error',
                            args: toolCall.function.arguments,
                            error,
                            fingerprint,
                            completedAt: Date.now(),
                        });
                        current.toolCalls = Array.from(ctx.activeToolCalls.values());
                        const projectedError = projectToolResult(error);
                        await appendForegroundToolResult({
                            threadId: ctx.threadId,
                            turnId: ctx.parentTurnId ?? ctx.assistantId,
                            parentAssistantId: ctx.assistantId,
                            call: toolCall,
                            fingerprint,
                            status: 'error',
                            durableResult: projectedError.durable,
                            error,
                        });
                        await ctx.persistAssistant({
                            content: current.text,
                            reasoning: current.reasoning_text ?? null,
                            toolCalls: current.toolCalls,
                        });
                        toolResultsForNextLoop.push({ call: toolCall, result: error });
                        normalizedState = settleNormalizedTool(
                            normalizedState,
                            toolCall.id,
                            { status: 'error', error }
                        );
                        continue;
                    }
                    const decision = decideToolCall(toolLedger.get(toolCall.id), {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments,
                    });
                    let execution: Awaited<ReturnType<ToolRegistryLike['executeTool']>>;
                    if (decision.action === 'replay') {
                        execution = { result: decision.result, toolName: toolCall.function.name, timedOut: false };
                    } else if (decision.action !== 'execute') {
                        execution = {
                            result: null, toolName: toolCall.function.name, timedOut: false,
                            error: decision.action === 'conflict'
                                ? `Tool call ID "${toolCall.id}" was reused with different arguments.`
                                : decision.action === 'running'
                                ? `Tool call "${toolCall.id}" may already have executed; refusing replay.`
                                : decision.error,
                        };
                    } else {
                        toolLedger.set(toolCall.id, {
                            callId: toolCall.id,
                            name: toolCall.function.name,
                            argumentFingerprint: decision.fingerprint,
                            state: 'running',
                        });
                        execution = await ctx.toolRegistry.executeTool(
                            toolCall.function.name,
                            toolCall.function.arguments,
                            {
                                subject: null,
                                workspaceId: null,
                                threadId: ctx.threadId,
                                messageId: ctx.assistantId,
                                callId: toolCall.id,
                                requestId: ctx.streamId,
                                abortSignal: ctx.abortSignal,
                            },
                            { definition: admittedDefinition }
                        );
                        toolLedger.set(toolCall.id, {
                            callId: toolCall.id,
                            name: toolCall.function.name,
                            argumentFingerprint: decision.fingerprint,
                            state: execution.error ? 'failed' : 'completed',
                            result: execution.result ?? undefined,
                            error: execution.error,
                        });
                    }

                    let toolResultText: string;
                    let toolStatus: 'complete' | 'error' = 'complete';
                    if (execution.error) {
                        toolStatus = 'error';
                        toolResultText = `Error executing tool "${toolCall.function.name}": ${execution.error}`;
                        console.warn('[useChat] tool execution error', {
                            tool: toolCall.function.name,
                            error: execution.error,
                            timedOut: execution.timedOut,
                        });
                    } else {
                        toolResultText = execution.result || '';
                    }
                    const projectedResult = projectToolResult(toolResultText);

                    ctx.activeToolCalls.set(toolCall.id, {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        status: toolStatus,
                        args: toolCall.function.arguments,
                        result:
                            toolStatus === 'complete'
                                ? projectedResult.ui
                                : undefined,
                        error: toolStatus === 'error'
                            ? execution.error
                            : undefined,
                        fingerprint: decision.fingerprint,
                        completedAt: Date.now(),
                    });
                    current.toolCalls = Array.from(
                        ctx.activeToolCalls.values()
                    );

                    // Persist the FULL tool result so reload / sync / retry keep the
                    // real context. The UI already truncates via ToolCallIndicator.formatResult.
                    await appendForegroundToolResult({
                        threadId: ctx.threadId,
                        turnId: ctx.parentTurnId ?? ctx.assistantId,
                        parentAssistantId: ctx.assistantId,
                        call: toolCall,
                        fingerprint: decision.fingerprint,
                        status: toolStatus,
                        durableResult: projectedResult.durable,
                        error: execution.error,
                    });

                    // The next provider request is not issued until both the
                    // result row and completed assistant ledger state are durable.
                    await ctx.persistAssistant({
                        content: current.text,
                        reasoning: current.reasoning_text ?? null,
                        toolCalls: current.toolCalls,
                    });

                    toolResultsForNextLoop.push({
                        call: toolCall,
                        result: projectedResult.model,
                    });
                    normalizedState = settleNormalizedTool(
                        normalizedState,
                        toolCall.id,
                        toolStatus === 'complete'
                            ? { status: 'complete', result: projectedResult.durable }
                            : { status: 'error', error: execution.error }
                    );
                }

                ctx.orMessages.push({
                    role: 'assistant',
                    content: [{ type: 'text', text: normalizedState.iterationText }],
                    tool_calls: pendingToolCalls.map((toolCall) => ({
                        id: toolCall.id,
                        type: 'function' as const,
                        function: {
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments,
                        },
                    })),
                });

                for (const payload of toolResultsForNextLoop) {
                    ctx.orMessages.push({
                        role: 'tool',
                        tool_call_id: payload.call.id,
                        name: payload.call.function.name,
                        content: [{ type: 'text', text: payload.result }],
                    });
                }

                pendingToolCalls.length = 0;
                const iterationResult = finishNormalizedIteration(
                    normalizedState,
                    MAX_TOOL_ITERATIONS
                );
                normalizedState = iterationResult.state;
                continue;
            }
            normalizedState = finishNormalizedIteration(
                normalizedState,
                MAX_TOOL_ITERATIONS
            ).state;
        } catch (streamError) {
            normalizedState = failNormalizedStream(normalizedState, streamError);
            await streamHooks.flush();
            if (normalizedState.iteration > 1) {
                console.warn('[useChat] Stream error during tool loop', streamError);
            }
            throw streamError;
        }
    }
}
