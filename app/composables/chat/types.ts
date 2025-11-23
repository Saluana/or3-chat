/**
 * Chat-specific type definitions
 * Consolidated types for chat composables to eliminate `any` usage
 */

import type { Ref } from 'vue';
import type { PaneState } from '~/composables/core/useMultiPane';
import type { Message } from '~/db/schema';
import type { ToolCall, ContentPart } from '~/utils/chat/types';

/**
 * Multi-pane API interface exposed on globalThis
 * Used for cross-pane communication and state management
 */
export interface MultiPaneApi {
    panes: Ref<PaneState[]>;
    activePaneIndex: Ref<number>;
    setPaneThread(index: number, threadId: string): Promise<void> | void;
}

/**
 * Database message with structured data field
 * Extends the base Message schema with typed data content
 */
export interface DbMessage extends Message {
    data: {
        content: string;
        attachments?: Array<{ type: string; url: string }>;
        reasoning_text?: string | null;
        tool_calls?: ToolCall[];
        tool_call_id?: string;
        tool_name?: string;
    } | null;
}

/**
 * Database assistant message (subset of DbMessage with assistant role)
 */
export interface DbAssistantMessage extends DbMessage {
    role: 'assistant';
}

/**
 * Model input message format
 * Used when preparing messages to send to AI model
 */
export interface ModelInputMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ContentPart[];
    id?: string;
    stream_id?: string;
    file_hashes?: string | null;
    reasoning_text?: string | null;
    data?: Record<string, unknown> | null;
    index?: number | null;
    created_at?: number | null;
}

/**
 * OpenRouter API message format (base message from openrouter-build)
 */
export interface ORBaseMessage {
    role: 'user' | 'assistant' | 'system';
    content: ContentPart[];
}

/**
 * Extended OpenRouter message format with tool support
 * Used for tool call and tool result messages in the chat flow
 */
export interface ORToolMessage {
    role: 'tool';
    tool_call_id: string;
    name: string;
    content: string;
}

/**
 * Assistant message with tool calls
 */
export interface ORAssistantWithToolsMessage {
    role: 'assistant';
    content: string | null | ContentPart[];
    tool_calls: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

/**
 * Complete OpenRouter message union type
 */
export type OpenRouterMessage = ORBaseMessage | ORToolMessage | ORAssistantWithToolsMessage;

/**
 * Toast notification options
 */
export interface ToastOptions {
    title: string;
    description?: string;
    timeout?: number;
    color?: 'error' | 'success' | 'info' | 'warning' | 'primary' | 'secondary' | 'neutral';
}

/**
 * Prompt content type
 * Can be a string or structured JSON object
 */
export type PromptContent = string | Record<string, unknown>;

/**
 * Tool call with loading/complete/error status
 * Used for UI display of tool execution state
 */
export interface ToolCallWithStatus {
    id: string;
    name: string;
    status: 'loading' | 'complete' | 'error';
    args: string;
    result?: string;
    error?: string;
}

/**
 * File reference for attachments
 */
export interface FileReference {
    type: string;
    url: string;
}

/**
 * Settings access type
 * Wraps settings in a reactive ref-like structure
 */
export interface SettingsWrapper<T> {
    value: T | null;
}

/**
 * Global singleton storage type
 * Used for HMR-safe module-level state
 */
export interface GlobalSingletonStorage {
    [key: string]: unknown;
}

/**
 * Message for retry context
 */
export interface RetryMessageContext {
    id: string;
    role: string;
    thread_id: string;
    index: number;
    data?: {
        content?: string;
    } | null;
    file_hashes?: string | null;
}
