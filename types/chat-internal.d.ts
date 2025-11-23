/**
 * Internal chat type definitions for composables and components.
 * These types extend the base chat types with internal implementation details.
 */

import type { Ref } from 'vue';
import type { UseMultiPaneApi, PaneState } from '~/composables/core/useMultiPane';
import type {
    ChatMessage,
    ToolCall,
    SendMessageParams,
    ContentPart,
} from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';

/**
 * Multi-pane API types
 */
export type MultiPanePane = PaneState;

export type MultiPaneApi = UseMultiPaneApi;

/**
 * Database message types
 */
export interface DbMessageData {
    content?: string;
    reasoning_text?: string | null;
    tool_calls?: ToolCall[];
    [key: string]: unknown;
}

export interface DbMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    data?: DbMessageData;
    file_hashes?: string | null;
    deleted?: boolean;
    created_at: number;
    updated_at?: number;
    thread_id?: string;
    content?: ChatMessage['content'];
    index?: number | string;
    clock?: number;
    stream_id?: string;
}

export interface DbUserMessage extends DbMessage {
    role: 'user';
}

export interface DbAssistantMessage extends DbMessage {
    role: 'assistant';
}

/**
 * Settings types
 */
export interface ChatSettings {
    defaultModelMode?: 'lastSelected' | 'fixed' | 'always-ask';
    fixedModelId?: string | null;
    masterSystemPrompt?: string | null;
}

/**
 * Model catalog types
 */
export interface ModelInfo {
    id: string;
    name?: string;
    [key: string]: unknown;
}

/**
 * Chat instance interface - return type of useChat
 */
export interface ChatInstance {
    messages: Ref<UiChatMessage[]>;
    rawMessages: Ref<ChatMessage[]>;
    loading: Ref<boolean>;
    streamState: StreamState;
    streamId: Ref<string | undefined>;
    threadId: Ref<string | undefined>;
    tailAssistant?: Ref<UiChatMessage | null>;
    send: (params: SendMessageParams & { content: string }) => Promise<void>;
    retryMessage: (messageId: string, model?: string) => Promise<void>;
    abort: () => void;
    clear: () => void;
    ensureHistorySynced?: () => Promise<void>;
    applyLocalEdit?: (messageId: string, content: string) => void;
    [key: string]: unknown;
}

/**
 * Stream state types
 */
export interface StreamState {
    text: string;
    reasoningText: string;
    isActive: boolean;
    finalized: boolean;
    error: Error | null;
    version: number;
    toolCalls?: ToolCall[];
}

/**
 * Component payload types
 */
export interface ImageAttachment {
    type: string;
    hash: string;
    url?: string;
    status: 'ready' | 'pending' | 'error';
    file?: { type?: string };
    mime?: string;
}

export interface LargeTextAttachment {
    text: string;
    name?: string;
}

export interface SendPayload {
    content: string;
    images?: ImageAttachment[];
    largeTexts?: LargeTextAttachment[];
    webSearchEnabled?: boolean;
}

/**
 * Image/File input types for send operations
 */
export interface ImageInput {
    url: string;
    type?: string;
    status?: 'ready' | 'pending';
}

export interface FileReference {
    type: string;
    url?: string;
    hash?: string;
}

/**
 * Settings overrides types
 */
export interface ChatSettingsOverrides {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    [key: string]: unknown;
}

/**
 * Thumbnail cache types for MessageAttachmentsGallery
 */
export interface ThumbCache {
    cache: Map<string, { status: 'loading' | 'ready' | 'error'; url?: string }>;
    inflight: Map<string, Promise<void>>;
    refCounts: Map<string, number>;
}

export interface FileMeta {
    width?: number;
    height?: number;
    size?: number;
    type?: string;
    kind?: string;
    name?: string;
}

/**
 * Extended SendMessageParams for internal use
 */
export interface ExtendedSendMessageParams extends SendMessageParams {
    content?: string;
    images?: (string | ImageInput)[];
}

/**
 * Pane context return type
 */
export interface PaneContext {
    mpApi: MultiPaneApi;
    pane: MultiPanePane;
    paneIndex: number;
}

/**
 * Model input message structure for API calls
 */
export interface ModelInputMessage {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string | ContentPart[];
    name?: string;
    tool_call_id?: string;
    file_hashes?: string | null;
}
