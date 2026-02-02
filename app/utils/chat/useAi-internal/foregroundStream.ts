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

import { tx } from '~/db';
import { createOrRefFile } from '~/db/files';
import type { ChatMessage, ToolCall, ToolDefinition } from '~/utils/chat/types';
import { dataUrlToBlob } from '~/utils/chat/files';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import {
    ensureUiMessage,
    recordRawMessage,
    type UiChatMessage,
} from '~/utils/chat/uiMessages';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';
import type {
    AssistantPersister,
    OpenRouterMessage,
    ToolResultPayload,
} from './types';

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
        args: string
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
    tools?: ToolDefinition[];
    abortSignal: AbortSignal;
    assistantId: string;
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
    let continueLoop = true;
    let loopIteration = 0;
    const MAX_TOOL_ITERATIONS = 10; // Prevent infinite loops

    while (continueLoop && loopIteration < MAX_TOOL_ITERATIONS) {
        continueLoop = false;
        loopIteration++;

        const stream = openRouterStream({
            apiKey: ctx.apiKey,
            model: ctx.modelId,
            orMessages: ctx.orMessages as Parameters<
                typeof openRouterStream
            >[0]['orMessages'],
            modalities: ctx.modalities,
            tools: ctx.tools,
            signal: ctx.abortSignal,
        });

        const rawAssistant: ChatMessage = {
            role: 'assistant',
            content: '',
            id: ctx.assistantId,
            stream_id: ctx.streamId,
            reasoning_text: null,
        };

        if (loopIteration === 1) {
            recordRawMessage(rawAssistant);
            ctx.rawMessages.value.push(rawAssistant);
            const uiAssistant = ensureUiMessage(rawAssistant);
            uiAssistant.pending = true;
            ctx.tailAssistant.value = uiAssistant;
        }

        const current = ctx.tailAssistant.value || ensureUiMessage(rawAssistant);
        let chunkIndex = 0;
        const WRITE_INTERVAL_MS = 500;
        let lastPersistAt = 0;
        const pendingToolCalls: ToolCall[] = [];

        try {
            for await (const ev of stream) {
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
                    });

                    // Update UI with loading state
                    current.toolCalls = Array.from(
                        ctx.activeToolCalls.values()
                    );

                    // Persist current assistant state (function call request)
                    await ctx.persistAssistant({
                        content: current.text,
                        reasoning: current.reasoning_text ?? null,
                        toolCalls: current.toolCalls ?? undefined,
                    });

                    pendingToolCalls.push(toolCall);
                    continue;
                } else if (ev.type === 'reasoning') {
                    if (current.reasoning_text === null)
                        current.reasoning_text = ev.text;
                    else current.reasoning_text += ev.text;
                    ctx.streamAcc.append(ev.text, { kind: 'reasoning' });
                    try {
                        await ctx.hooks.doAction(
                            'ai.chat.stream:action:reasoning',
                            ev.text,
                            {
                                threadId: ctx.threadId,
                                assistantId: ctx.assistantId,
                                streamId: ctx.streamId,
                                reasoningLength:
                                    current.reasoning_text?.length || 0,
                            }
                        );
                    } catch {
                        /* intentionally empty */
                    }
                } else if (ev.type === 'text') {
                    if (current.pending) current.pending = false;
                    const delta = ev.text;
                    ctx.streamAcc.append(delta, { kind: 'text' });
                    await ctx.hooks.doAction(
                        'ai.chat.stream:action:delta',
                        delta,
                        {
                            threadId: ctx.threadId,
                            assistantId: ctx.assistantId,
                            streamId: ctx.streamId,
                            deltaLength: delta.length,
                            totalLength: current.text.length + delta.length,
                            chunkIndex: chunkIndex++,
                        }
                    );
                    current.text += delta;
                } else if (ev.type === 'image') {
                    if (current.pending) current.pending = false;
                    // Store image first, then use hash placeholder (not Base64)
                    if (ctx.assistantFileHashes.length < 6) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/'))
                            blob = dataUrlToBlob(ev.url);
                        else if (/^https?:/.test(ev.url)) {
                            try {
                                const resp = await fetch(ev.url);
                                if (resp.ok) {
                                    blob = await resp.blob();
                                }
                            } catch {
                                /* intentionally empty */
                            }
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
                                    current.text +=
                                        (current.text ? '\n\n' : '') +
                                        placeholder;
                                }
                                const serialized = await ctx.persistAssistant({
                                    content: current.text,
                                    reasoning: current.reasoning_text ?? null,
                                });
                                current.file_hashes =
                                    serialized?.split(',') ?? [];
                            } catch {
                                /* intentionally empty */
                            }
                        } else {
                            // Fallback: couldn't convert to blob, use URL directly
                            const placeholder = `![generated image](${ev.url})`;
                            const already = current.text.includes(placeholder);
                            if (!already) {
                                current.text +=
                                    (current.text ? '\n\n' : '') + placeholder;
                            }
                        }
                    }
                }

                // Batch writes: persist every 500ms OR every 50 chunks (whichever comes first)
                // to reduce DB pressure while maintaining progress safety
                const now = Date.now();
                const shouldPersist =
                    now - lastPersistAt >= WRITE_INTERVAL_MS ||
                    chunkIndex % 50 === 0;
                if (shouldPersist) {
                    await ctx.persistAssistant({
                        content: current.text,
                        reasoning: current.reasoning_text ?? null,
                    });
                    if (ctx.assistantFileHashes.length) {
                        current.file_hashes = ctx.assistantFileHashes;
                    }
                    lastPersistAt = now;
                }
            }

            if (pendingToolCalls.length > 0) {
                const toolResultsForNextLoop: ToolResultPayload[] = [];

                for (const toolCall of pendingToolCalls) {
                    const execution = await ctx.toolRegistry.executeTool(
                        toolCall.function.name,
                        toolCall.function.arguments
                    );

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

                    ctx.activeToolCalls.set(toolCall.id, {
                        id: toolCall.id,
                        name: toolCall.function.name,
                        status: toolStatus,
                        args: toolCall.function.arguments,
                        result:
                            toolStatus === 'complete'
                                ? toolResultText
                                : undefined,
                        error: toolStatus === 'error'
                            ? execution.error
                            : undefined,
                    });
                    current.toolCalls = Array.from(
                        ctx.activeToolCalls.values()
                    );

                    const SUMMARY_THRESHOLD = 500;
                    let uiSummary = toolResultText;
                    if (toolResultText.length > SUMMARY_THRESHOLD) {
                        uiSummary = `Tool result (${Math.round(
                            toolResultText.length / 1024
                        )}KB): ${toolResultText.slice(
                            0,
                            200
                        )}... [truncated for display]`;
                    }

                    await tx.appendMessage({
                        thread_id: ctx.threadId,
                        role: 'tool',
                        data: {
                            content: uiSummary,
                            tool_call_id: toolCall.id,
                            tool_name: toolCall.function.name,
                        },
                    });

                    toolResultsForNextLoop.push({
                        call: toolCall,
                        result: toolResultText,
                    });
                }

                ctx.orMessages.push({
                    role: 'assistant',
                    content: [{ type: 'text', text: current.text || '' }],
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
                continueLoop = true;
                continue;
            }
        } catch (streamError) {
            if (loopIteration > 1) {
                console.warn('[useChat] Stream error during tool loop', streamError);
                continueLoop = false;
            }
            throw streamError;
        }
    }
}
