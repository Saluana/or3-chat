/**
 * Internal chat type definitions for composables and components.
 * These types extend the base chat types with internal implementation details.
 */

import type { Ref } from 'vue';
import type {
    UseMultiPaneApi,
    PaneState,
} from '~/composables/core/useMultiPane';
import type {
    ChatMessage,
    ChatRequestState,
    ToolCall,
    SendMessageParams,
    ContentPart,
    SendResult,
} from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';

/**
 * Multi-pane API types
 */
export type MultiPanePane = PaneState;

export type MultiPaneApi = UseMultiPaneApi;

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
    requestState: Ref<ChatRequestState>;
    tailAssistant?: Ref<UiChatMessage | null>;
    send: (params: SendMessageParams & { content: string }) => Promise<SendResult>;
    retryMessage: (messageId: string, model?: string, options?: { afterEdit?: boolean }) => Promise<SendResult | undefined>;
    continueMessage?: (messageId: string, model?: string) => Promise<void>;
    abort: () => void;
    clear: () => void;
    clearConversation?: (options?: { persistence?: 'preserve' }) => void;
    dispose?: () => void;
    ensureHistorySynced?: () => Promise<void>;
    switchThread?: (
        nextThreadId: string | undefined,
        options?: {
            seedMessages?: ChatMessage[];
            pendingPromptId?: string | null;
            historyAlreadyLoaded?: boolean;
        }
    ) => Promise<void>;
    setPendingPrompt?: (promptId: string | null | undefined) => void;
    applyLocalEdit?: (messageId: string, content: string) => void;
    replaceCanonicalHistory?: (messages: ChatMessage[]) => void;
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
    aborted: boolean;
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

/**
 * Image/File input types for send operations
 */
export interface ImageInput {
    url: string;
    type?: string;
    status?: 'ready' | 'pending';
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
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ContentPart[];
    name?: string;
    tool_call_id?: string;
    file_hashes?: string | null;
    tool_calls?: ToolCall[];
}
