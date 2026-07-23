import { openRouterStreamWithRetry } from '~/utils/chat/openrouterStream';
import type { ToolChoice, ToolDefinition, ToolExecutionContext } from '~/utils/chat/types';
import type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';
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
    toolContext: Omit<DocumentAiToolContext, 'stagedOperations' | 'onStageOperations'>;
    tools?: ToolDefinition[];
    /** Document AI allowlist; missing keys use native-on / registry-off defaults. */
    enabledTools?: Readonly<Record<string, boolean>>;
    toolChoice?: ToolChoice;
    reasoning?: OpenRouterReasoningConfig;
    onStatus?: (event: DocumentAiAgentStatusEvent) => void;
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
    signal?: AbortSignal;
}): Promise<string> {
    if (!isDocumentAiToolEnabled(params.name, params.enabledTools)) {
        throw new Error(`Tool "${params.name}" is disabled for Document AI.`);
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
        callId: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        abortSignal,
    };
    return executeDocumentAiRegistryTool({
        name: params.name,
        argumentsJson: params.argumentsJson,
        context,
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
                    signal: params.signal,
                });
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
