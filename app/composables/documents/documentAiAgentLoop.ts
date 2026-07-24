import { openRouterStreamWithRetry } from '~/utils/chat/openrouterStream';
import type { ToolChoice, ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';
import { createRuntimeUuid } from '~~/shared/runtime-id';
import {
    DOCUMENT_AI_AGENT_TOOLS,
    executeDocumentAiTool,
    isDocumentAiNativeTool,
    isDocumentAiToolEnabled,
    type DocumentAiToolContext,
} from '~/utils/documents/document-ai-tools';
import { executeDocumentAiRegistryTool } from '~/utils/documents/document-ai-registry-tools';
import type { DocumentAiOperation } from '~/utils/documents/document-ai-operations';
import {
    clampDocumentAiMaxIterations,
    DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
} from './useDocumentAiSettings';

type ORMessage = {
    role: string;
    content?: string | Array<{ type: string; [key: string]: unknown }>;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    [key: string]: unknown;
};

export type DocumentAiAgentStatusEvent =
    | { type: 'iteration'; iteration: number; maxIterations: number }
    | { type: 'tool_start'; name: string; iteration: number }
    | { type: 'tool_end'; name: string; iteration: number; ok: boolean; detail?: string }
    | { type: 'staged'; totalStaged: number; added: number }
    | { type: 'done'; totalStaged: number; iterations: number };

export interface DocumentAiAgentLoopParams {
    apiKey: string | null | undefined;
    modelId: string;
    orMessages: ORMessage[];
    signal?: AbortSignal;
    maxIterations?: number;
    /** Model context window; loop prunes older tool payloads to stay under this. */
    maxContextTokens?: number;
    toolContext: Omit<DocumentAiToolContext, 'stagedOperations' | 'onStageOperations'>;
    tools?: ToolDefinition[];
    /** Document AI allowlist; missing keys use native-on / registry-off defaults. */
    enabledTools?: Readonly<Record<string, boolean>>;
    toolChoice?: ToolChoice;
    reasoning?: OpenRouterReasoningConfig;
    onStatus?: (event: DocumentAiAgentStatusEvent) => void;
}

/** Reserve tokens for the next model turn + tool schemas. */
const DOCUMENT_AI_CONTEXT_RESERVE_TOKENS = 4_096;
const DOCUMENT_AI_TOOL_RESULT_SOFT_CAP_CHARS = 24_000;

function estimateMessageTokens(message: ORMessage): number {
    const chunks: string[] = [];
    if (typeof message.content === 'string') chunks.push(message.content);
    else if (Array.isArray(message.content)) {
        for (const part of message.content) {
            if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
                chunks.push(part.text);
            }
        }
    }
    if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
            chunks.push(call.function?.name ?? '', call.function?.arguments ?? '');
        }
    }
    // Cheap char≈token heuristic; exact tokenizer is too heavy for the hot loop.
    return Math.ceil(chunks.join('\n').length / 4);
}

function estimateConversationTokens(messages: readonly ORMessage[]): number {
    return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function truncateToolResultText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 48))}\n…[truncated for context budget]`;
}

/**
 * Drop/trim older tool payloads so the running transcript fits the model window.
 * Keeps system+user seeds and the newest tool turns intact when possible.
 */
export function enforceDocumentAiContextBudget(
    messages: ORMessage[],
    maxContextTokens: number,
): void {
    const budget = Math.max(2_048, maxContextTokens - DOCUMENT_AI_CONTEXT_RESERVE_TOKENS);
    if (estimateConversationTokens(messages) <= budget) return;

    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message || message.role !== 'tool') continue;
        const content = Array.isArray(message.content)
            ? message.content.find((part) => part?.type === 'text' && typeof part.text === 'string')
            : null;
        if (!content || typeof content.text !== 'string') continue;
        if (content.text.length <= 240) continue;
        content.text = JSON.stringify({
            truncated: true,
            note: 'Earlier tool output was pruned to stay within the model context window. Re-read only what you still need.',
            tool: message.name ?? 'tool',
        });
        if (estimateConversationTokens(messages) <= budget) return;
    }
}

function statusLabelForTool(name: string, tools: readonly ToolDefinition[]): string {
    switch (name) {
        case 'get_document_outline':
            return 'Reading outline';
        case 'list_document_chunks':
            return 'Listing chunks';
        case 'read_blocks':
            return 'Reading blocks';
        case 'search_document':
            return 'Searching document';
        case 'propose_edits':
            return 'Staging edits';
        case 'get_proposal_status':
            return 'Checking proposal';
        default: {
            const match = tools.find((tool) => tool.function.name === name);
            return match?.ui?.label || name.replace(/[_-]+/gu, ' ');
        }
    }
}

async function executeAgentToolCall(params: {
    name: string;
    argumentsJson: string;
    toolContext: DocumentAiToolContext;
    enabledTools: Readonly<Record<string, boolean>>;
    /** Tools advertised to the model for this run — execution is pinned to this set. */
    advertisedTools: readonly ToolDefinition[];
    signal?: AbortSignal;
}): Promise<string> {
    if (!isDocumentAiToolEnabled(params.name, params.enabledTools)) {
        throw new Error(`Tool "${params.name}" is disabled for Document AI.`);
    }
    const admitted = params.advertisedTools.find((tool) => tool.function.name === params.name);
    if (!admitted) {
        throw new Error(`Tool "${params.name}" was not advertised for this Document AI run.`);
    }
    if (isDocumentAiNativeTool(params.name)) {
        return executeDocumentAiTool(params.name, params.argumentsJson, params.toolContext);
    }
    const abortSignal = params.signal ?? new AbortController().signal;
    const context: ToolExecutionContext = {
        subject: null,
        workspaceId: null,
        threadId: null,
        messageId: null,
        callId: createRuntimeUuid(),
        requestId: createRuntimeUuid(),
        abortSignal,
    };
    return executeDocumentAiRegistryTool({
        name: params.name,
        argumentsJson: params.argumentsJson,
        context,
        admittedDefinition: admitted,
    });
}

export function documentAiToolStatusLabel(name: string): string {
    return statusLabelForTool(name, DOCUMENT_AI_AGENT_TOOLS);
}

/**
 * Moonshot/Kimi (and some other providers) reject `text: ""` parts.
 * Assistant tool-call turns often have no prose — omit content entirely.
 */
export function buildAssistantToolCallMessage(params: {
    assistantText: string;
    toolCalls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
}): ORMessage {
    const text = params.assistantText.trim();
    const message: ORMessage = {
        role: 'assistant',
        tool_calls: params.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function' as const,
            function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
            },
        })),
    };
    // Providers like Moonshot reject empty text parts; omit content when there is none.
    if (text) message.content = [{ type: 'text', text }];
    return message;
}

export function buildToolResultMessage(params: {
    toolCallId: string;
    name: string;
    resultText: string;
}): ORMessage {
    const text = params.resultText.trim() || '{"ok":true}';
    return {
        role: 'tool',
        tool_call_id: params.toolCallId,
        name: params.name,
        content: [{ type: 'text', text }],
    };
}

/**
 * Multi-tool Document AI loop. Uses tool_choice auto so the model can outline,
 * read large chunks, search, and stage edits across several turns.
 */
export async function runDocumentAiAgentLoop(
    params: DocumentAiAgentLoopParams,
): Promise<{ operations: DocumentAiOperation[]; iterations: number }> {
    const maxIterations = clampDocumentAiMaxIterations(
        params.maxIterations ?? DEFAULT_DOCUMENT_AI_MAX_ITERATIONS,
    );
    const enabledTools = params.enabledTools ?? {};
    const tools = params.tools ?? DOCUMENT_AI_AGENT_TOOLS;
    const maxContextTokens = params.maxContextTokens ?? 32_000;
    const messages: ORMessage[] = [...params.orMessages];
    const stagedOperations: DocumentAiOperation[] = [];
    const toolContext: DocumentAiToolContext = {
        ...params.toolContext,
        stagedOperations,
        onStageOperations: (operations) => {
            stagedOperations.push(...operations);
            params.onStatus?.({
                type: 'staged',
                totalStaged: stagedOperations.length,
                added: operations.length,
            });
        },
    };

    let iterations = 0;

    while (iterations < maxIterations) {
        iterations += 1;
        params.onStatus?.({ type: 'iteration', iteration: iterations, maxIterations });
        enforceDocumentAiContextBudget(messages, maxContextTokens);

        const pendingToolCalls: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
        }> = [];
        let assistantText = '';

        for await (const event of openRouterStreamWithRetry({
            apiKey: params.apiKey,
            model: params.modelId,
            signal: params.signal,
            maxRetries: 2,
            tools,
            toolChoice: params.toolChoice ?? 'auto',
            reasoning: params.reasoning,
            orMessages: messages,
        })) {
            if (event.type === 'text' && event.text) assistantText += event.text;
            if (event.type === 'tool_call') pendingToolCalls.push(event.tool_call);
        }

        if (!pendingToolCalls.length) {
            params.onStatus?.({
                type: 'done',
                totalStaged: stagedOperations.length,
                iterations,
            });
            break;
        }

        messages.push(buildAssistantToolCallMessage({
            assistantText,
            toolCalls: pendingToolCalls,
        }));

        for (const toolCall of pendingToolCalls) {
            const name = toolCall.function.name;
            params.onStatus?.({ type: 'tool_start', name, iteration: iterations });
            let resultText = '';
            let ok = true;
            try {
                resultText = await executeAgentToolCall({
                    name,
                    argumentsJson: toolCall.function.arguments,
                    toolContext,
                    enabledTools,
                    advertisedTools: tools,
                    signal: params.signal,
                });
                resultText = truncateToolResultText(
                    resultText,
                    DOCUMENT_AI_TOOL_RESULT_SOFT_CAP_CHARS,
                );
                params.onStatus?.({
                    type: 'tool_end',
                    name,
                    iteration: iterations,
                    ok: true,
                    detail: statusLabelForTool(name, tools),
                });
            } catch (caught) {
                ok = false;
                resultText = JSON.stringify({
                    error: caught instanceof Error ? caught.message : String(caught),
                });
                params.onStatus?.({
                    type: 'tool_end',
                    name,
                    iteration: iterations,
                    ok: false,
                    detail: caught instanceof Error ? caught.message : String(caught),
                });
            }
            void ok;
            messages.push(buildToolResultMessage({
                toolCallId: toolCall.id,
                name,
                resultText,
            }));
            enforceDocumentAiContextBudget(messages, maxContextTokens);
        }
    }

    if (iterations >= maxIterations && stagedOperations.length === 0) {
        throw new Error(
            `Document AI stopped after ${maxIterations} iterations without staging edits. Try a clearer request or raise max iterations.`,
        );
    }

    params.onStatus?.({
        type: 'done',
        totalStaged: stagedOperations.length,
        iterations,
    });

    return { operations: stagedOperations, iterations };
}
