import type { ToolDefinition, ToolChoice } from './types';
import type { ORContentPart, ORMessage as BuiltMessage } from '~/core/auth/openrouter-build';
import type { StreamedFieldMode } from '~~/shared/openrouter/parseOpenRouterSSE';
import type { OpenRouterReasoningConfig } from '~~/shared/openrouter/reasoning';
import { getAnthropicPromptCacheControl, type OpenRouterCacheControl } from '~~/shared/openrouter/request';
import { encodeProviderRequest } from '~~/shared/ai/provider-body';
import { PROJECT_MEMORY_HEADING } from '~~/shared/projects/workspace';
import { admitProviderRequest, ChatContextAdmissionError, type ContextRequestPolicy, type ContextRequestEnvelope } from '~~/shared/chat/context-budget';
import { estimateMeasuredChatRequest } from '~~/shared/chat/request-usage';
import { countTokensApprox } from './tokens';

type ORMessagePart = ORContentPart | { type: string; [key: string]: unknown };

// Permissive message type that accepts both strict ORMessage from openrouter-build
// and tool messages. Content is optional for tool role messages.
export type ORMessage = BuiltMessage | {
    role: string;
    content?: string | ORMessagePart[];
    name?: string;
    tool_call_id?: string;
    [key: string]: unknown;
};

export type OpenRouterRequestBody = {
    model: string;
    messages: ORMessage[];
    modalities?: string[];
    stream: true;
    max_tokens?: number;
    reasoning?: OpenRouterReasoningConfig;
    cache_control?: OpenRouterCacheControl;
    tools?: ToolDefinition[];
    tool_choice?: ToolChoice;
    _background?: true;
    _threadId?: string;
    _messageId?: string;
    _toolRuntime?: Record<string, string>;
    _clientDeviceId?: string;
    _streamedFieldMode?: StreamedFieldMode;
    _context?: ContextRequestEnvelope;
    _delegationDefaults?: import('~~/shared/chat/delegation-checkpoint').DelegationDefaults;
    _durableDelegation?: 1;
};

function stripUiMetadata(tool: ToolDefinition): ToolDefinition {
    const { ui: _ui, runtime: _runtime, ...rest } = tool as ToolDefinition & {
        ui?: Record<string, unknown>;
        runtime?: string;
    };
    return {
        ...rest,
        function: {
            ...tool.function,
            parameters: { ...tool.function.parameters },
        },
    };
}

export type OpenRouterStreamParams = {
    expectedProjectId?: string | null;
    onProjectContext?: (receipt: import('~~/shared/projects/workspace').ProjectContextReceipt, iterations: unknown[]) => void;
    projectContext?: import('~/utils/projects/types').ProjectContextSnapshot | null;
    apiKey?: string | null;
    model: string;
    orMessages: ORMessage[];
    modalities?: string[];
    threadId?: string;
    messageId?: string;
    tools?: ToolDefinition[];
    maxCompletionTokens?: number;
    toolChoice?: ToolChoice;
    signal?: AbortSignal;
    reasoning?: OpenRouterReasoningConfig;
    /** How the selected provider emits streamed tool name/argument fields. */
    streamedFieldMode?: StreamedFieldMode;
    /** Primarily configurable for deterministic tests and constrained runtimes. */
    responseTimeoutMs?: number;
    idleTimeoutMs?: number;
    contextPolicy?: ContextRequestPolicy;
    /** First valid provider event, after initial admission/error handling. */
    onProviderAccepted?: () => void;
};

/** Single provider-body constructor used by admission and dispatch. */
export function buildOpenRouterRequestBody(params: OpenRouterStreamParams): OpenRouterRequestBody {
    const body: OpenRouterRequestBody = { model: params.model, messages: params.orMessages, stream: true };
    if (params.modalities?.length) body.modalities = params.modalities;
    if (params.maxCompletionTokens !== undefined) body.max_tokens = params.maxCompletionTokens;
    if (params.reasoning) body.reasoning = params.reasoning;
    const cacheControl = getAnthropicPromptCacheControl(params.model);
    if (cacheControl) body.cache_control = cacheControl;
    if (params.tools) {
        body.tools = params.tools.map(stripUiMetadata);
        body.tool_choice = params.toolChoice ?? 'auto';
    }
    return JSON.parse(JSON.stringify(body)) as OpenRouterRequestBody;
}

/** Admit the exact detached provider projection while preserving the host envelope. */
export async function prepareOpenRouterDispatch(params: OpenRouterStreamParams): Promise<{
    hostBody: OpenRouterRequestBody; providerBody: OpenRouterRequestBody;
}> {
    const body = buildOpenRouterRequestBody(params);
    if (params.projectContext) {
        const { assertProjectContextIncluded } = await import('~/utils/projects/context');
        assertProjectContextIncluded(params.projectContext, body.messages);
    }
    if (!params.contextPolicy) {
        if (body.max_tokens !== undefined && (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0))
            throw new Error('Reply maximum must be a positive integer.');
        return { hostBody: body, providerBody: encodeProviderRequest({ ...body }) };
    }
    const policy = params.contextPolicy;
    const admit = async () => {
        // The host envelope retains the legacy model hint for server-side tool
        // validation. Count the provider projection that will actually be sent.
        const providerBody = encodeProviderRequest({ ...body });
        const admitted = await admitProviderRequest(providerBody, { ...policy,
            requestedCompletionTokens: policy.requestedCompletionTokens ?? params.maxCompletionTokens },
            countTokensApprox, params.signal, async (request) => {
            const { messages, ...configuration } = request;
            return estimateMeasuredChatRequest({ model: request.model, messages, tools: request.tools,
                modalities: request.modalities, configuration, usage: params.contextPolicy?.measuredUsage,
                countText: countTokensApprox });
        });
        body.max_tokens = admitted.max_tokens;
        return { hostBody: body, providerBody: admitted };
    };
    for (;;) {
        try { return await admit(); }
        catch (error) {
            if (!(error instanceof ChatContextAdmissionError) || error.code !== 'context_full' || !params.projectContext) throw error;
            const optional = [...(params.projectContext.receipt.chats ?? []).map(chat => chat.message_id),
                ...params.projectContext.receipt.sources.filter(source => !params.projectContext!.requiredSourceIds.includes(source.id)).map(source => source.id)];
            const index = body.messages.findLastIndex(message => {
                const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
                    ? message.content.map(part => 'text' in part ? part.text : '').filter(Boolean).join(' ') : '';
                return message.role === 'user' && params.projectContext!.messages.some(context => (typeof context.content === 'string' ? context.content === text
                    : Array.isArray(context.content) && context.content.some(part => part.type === 'text' && part.text === text)
                        && context.content.every(part => part.type !== 'image' || JSON.stringify(message.content).includes(String(part.image))))
                    && (text.startsWith(`${params.projectContext!.marker}\n${PROJECT_MEMORY_HEADING}`)
                        || optional.some(id => text.startsWith(`${params.projectContext!.marker} Source ${id}:`) || text.startsWith(`${params.projectContext!.marker} Source ${id} `)
                        || text.startsWith(`${params.projectContext!.marker} Previous chat `) && text.includes(`summary ${id}:`))));
            });
            if (index < 0) throw error;
            body.messages.splice(index, 1);
        }
    }
}

/** Compatibility entry point for host-side preparation and inspection. */
export async function prepareOpenRouterRequest(params: OpenRouterStreamParams): Promise<OpenRouterRequestBody> {
    return (await prepareOpenRouterDispatch(params)).hostBody;
}
