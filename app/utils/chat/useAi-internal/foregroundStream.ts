/**
 * @module useAi/foregroundStream
 * @description Foreground streaming loop with tool execution and persistence cadence.
 *
 * Responsibilities:
 * - Run the OpenRouter streaming loop for foreground (non-background) requests
 * - Handle tool calls and append tool results for subsequent iterations
 * - Persist assistant content with a throttled cadence
 * - Update UI assistant state and tool call status
 *
 * Non-responsibilities:
 * - Hook orchestration (before/after) and higher-level flow control
 * - Background streaming job management
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

type StreamAccumulatorLike = {
    append: (text: string, opts: { kind: 'text' | 'reasoning' }) => void;
};

type HooksLike = {
    doAction: (name: string, ...args: unknown[]) => Promise<unknown>;
};

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

type RefLike<T> = { value: T };

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
