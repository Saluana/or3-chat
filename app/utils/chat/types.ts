/**
 * @module app/utils/chat/types
 *
 * Purpose:
 * Shared chat type definitions used across UI and streaming utilities.
 */

export type TextPart = { type: 'text'; text: string };

export type ImagePart = {
    type: 'image';
    image: string | Uint8Array | Buffer;
    mediaType?: string;
};

export type FilePart = {
    type: 'file';
    data: string | Uint8Array | Buffer;
    mediaType: string;
    name?: string;
};

export type ContentPart = TextPart | ImagePart | FilePart;

/**
 * `ChatMessage`
 *
 * Purpose:
 * Canonical chat message shape used by UI and persistence layers.
 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ContentPart[];
    id?: string;
    stream_id?: string;
    file_hashes?: string | null;
    reasoning_text?: string | null;
    error?: string | null;
    pending?: boolean;
    data?: Record<string, unknown> | null;
    index?: number | null;
    order_key?: string | null;
    created_at?: number | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: ToolCall[];
}

export interface SendMessageParams {
    files?: { type: string; url: string }[];
    model?: string;
    file_hashes?: string[];
    extraTextParts?: string[];
    /**
     * @deprecated Use `modelVariant: 'online'` instead. When `modelVariant`
     * is set it takes precedence; otherwise `online: true` maps to the
     * `:online` model suffix for backward compatibility.
     */
    online?: boolean;
    /** OpenRouter routing variant suffix (`:online` / `:nitro` / `:floor`). */
    modelVariant?: import('~~/shared/openrouter/model-variants').OpenRouterModelVariant;
    thinking?: boolean;
    reasoningEffort?: string | null;
    // Optional hashes to include for model context without reattaching to the new UI message.
    context_hashes?: string[];
    /** Visible transcript used for retry; the new user turn is appended to it. */
    historyOverride?: ChatMessage[];
    /** Runs after the new user row is durable, before response generation. */
    onUserPersisted?: (userMessageId: string) => void | Promise<void>;
}

export function hasDurableSendAcceptance(result: SendResult): boolean {
    return 'userMessageId' in result && typeof result.userMessageId === 'string';
}

export type SendFailureReason =
    | 'busy'
    | 'missing_credentials'
    | 'filtered'
    | 'client_limit'
    | 'unavailable'
    | 'empty_context'
    | 'tool_iteration_limit'
    | 'stream_error'
    | 'aborted'
    | 'detached';

export type SendResult =
    | { status: 'accepted'; requestId: string; userMessageId?: string; assistantMessageId?: string }
    | { status: 'rejected'; requestId?: string; reason: SendFailureReason; error?: string }
    | { status: 'failed'; requestId: string; reason: SendFailureReason; error: string; userMessageId?: string; assistantMessageId?: string }
    | { status: 'aborted'; requestId: string; reason: 'aborted'; userMessageId?: string; assistantMessageId?: string }
    | { status: 'complete'; requestId: string; userMessageId: string; assistantMessageId: string }
    | { status: 'detached'; requestId: string; reason: 'detached'; userMessageId?: string; assistantMessageId?: string };

export type ChatRequestState =
    | { status: 'idle' }
    | { status: 'admitted'; requestId: string }
    | { status: 'persisted'; requestId: string; userMessageId: string }
    | { status: 'streaming'; requestId: string; userMessageId: string; assistantMessageId: string }
    | { status: 'terminal'; requestId: string; result: SendResult };

export type RegisterSendResult = (
    terminal: Promise<SendResult>,
    durableAcceptance?: Promise<SendResult>
) => void;

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string, parsed by consumer
    };
}

export type ToolRuntime = 'hybrid' | 'client' | 'server';

/** Request-scoped authority and cancellation passed to every tool handler. */
export interface ToolExecutionContext {
    subject: string | null;
    workspaceId: string | null;
    threadId: string | null;
    messageId: string | null;
    callId: string;
    requestId: string;
    abortSignal: AbortSignal;
}

/** Immutable admission decision associated with a provider-visible tool call. */
export interface ToolExecutionAdmission {
    definition: ToolDefinition;
    /**
     * When true, skip the chat-global enablement check.
     * Used by Document AI, which gates tools via its own `enabledTools` map.
     */
    ignoreGlobalEnabled?: boolean;
}

/**
 * `ToolDefinition`
 *
 * Purpose:
 * OpenRouter tool definition with optional UI metadata.
 */
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: import('~~/shared/chat/tool-schema').JsonSchemaObject;
    };
    ui?: {
        label?: string;
        icon?: string;
        descriptionHint?: string;
        defaultEnabled?: boolean;
        category?: string;
    };
    runtime?: ToolRuntime;
}

export type ToolChoice =
    | 'auto'
    | 'none'
    | {
          type: 'function';
          function: {
              name: string;
          };
      };

// Re-export from shared location (single source of truth)
export type { ORStreamEvent } from '~~/shared/openrouter/parseOpenRouterSSE';
