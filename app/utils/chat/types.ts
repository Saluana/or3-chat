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
    data?: Record<string, unknown> | null;
    index?: number | null;
    created_at?: number | null;
    name?: string;
    tool_call_id?: string;
}

export interface SendMessageParams {
    files?: { type: string; url: string }[];
    model?: string;
    file_hashes?: string[];
    extraTextParts?: string[];
    online: boolean;
    // Optional hashes to include for model context without reattaching to the new UI message.
    context_hashes?: string[];
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string, parsed by consumer
    };
}

export type ToolRuntime = 'hybrid' | 'client' | 'server';

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
        parameters: {
            type: 'object';
            properties: Record<string, unknown>;
            required?: string[];
        };
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
