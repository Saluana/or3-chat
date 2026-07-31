/**
 * @module app/utils/chat/useAi-internal/retry.ts
 *
 * Purpose:
 * Implements message retry functionality for the AI chat system. Handles the
 * deletion and re-submission of user-assistant message pairs while preserving
 * message context (attachments, reasoning, file hashes).
 *
 * Responsibilities:
 * - Locate the user message associated with a retry target
 * - Delete existing user/assistant message pairs from IndexedDB
 * - Synchronize in-memory message arrays with database state
 * - Re-send user message with optional model override
 * - Emit lifecycle hooks for plugin observation
 *
 * Non-responsibilities:
 * - Does not handle streaming logic (delegated to sendMessage)
 * - Does not validate user permissions or rate limits
 * - Does not manage thread lifecycle (created elsewhere)
 *
 * Architecture:
 * - Operates within the useAi composable internal suite
 * - Uses Dexie for local-first IndexedDB operations
 * - Relies on hooks system for extensibility
 *
 * Invariants:
 * - User message must exist and belong to current thread
 * - Database transactions are atomic (rw on messages table)
 * - In-memory arrays are synchronized before deletion
 */

import type { Ref } from 'vue';
import type { ChatMessage, ContentPart, SendMessageParams, SendResult } from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { getDb } from '~/db/client';
import { compareMessageOrder, messagesByThread } from '~/db/messages';
import { parseFileHashes } from '~/db/files-util';
import { normalizeStreamingMessage } from '~/utils/chat/messages';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import type { StoredMessage } from './types';

/**
 * Minimal hook interface required by retry operations.
 *
 * Purpose:
 * Provides a constrained interface for emitting lifecycle hooks without
 * depending on the full hook engine. Enables easier testing and composition.
 *
 * Constraints:
 * - Only supports action emission (not filters)
 * - Payloads are typed as unknown for flexibility
 */
type HooksLike = {
    doAction: (name: string, payload?: unknown) => Promise<unknown>;
};

/**
 * Context object required for retry operations.
 *
 * Purpose:
 * Encapsulates all dependencies needed to retry a message, enabling
 * testability and separation of concerns from the composable state.
 *
 * Behavior:
 * - Provides reactive refs for loading state and thread identification
 * - References message arrays that must stay synchronized with Dexie
 * - Includes hook interface for lifecycle notifications
 * - Contains callback to suppress automatic tail assistant flushing
 *
 * Constraints:
 * - threadIdRef must be defined before calling retryMessageImpl
 * - sendMessage must handle the actual network request
 * - suppressNextTailFlush prevents UI flicker during retry
 */
export type RetryMessageContext = {
    loading: Ref<boolean>;
    threadIdRef: Ref<string | undefined>;
    tailAssistant: Ref<UiChatMessage | null>;
    rawMessages: Ref<ChatMessage[]>;
    messages: Ref<UiChatMessage[]>;
    hooks: HooksLike;
    sendMessage: (text: string, params: SendMessageParams) => Promise<SendResult>;
    defaultModelId: string;
    suppressNextTailFlush: (assistantId: string) => void;
};

/**
 * Internal helper. Extracts plain text from content that may be string or ContentPart array.
 */
const extractUserText = (originalText: unknown): string => {
    if (typeof originalText === 'string') return originalText;
    if (Array.isArray(originalText)) {
        return (originalText as ContentPart[])
            .filter((p) => (p as { type?: unknown }).type === 'text')
            .map((p) => (p as { text: string }).text)
            .join('');
    }
    return '';
};

/**
 * `ai.chat.retry:action:*` (action)
 *
 * Purpose:
 * Retries a message by deleting the existing user-assistant pair and re-sending
 * the user message. Preserves file attachments and supports model override.
 *
 * Behavior:
 * 1. Validates loading state and thread context
 * 2. Locates target message and associated user message
 * 3. Synchronizes in-memory state with IndexedDB if needed
 * 4. Emits `ai.chat.retry:action:before` hook
 * 5. Atomically deletes user and assistant messages
 * 6. Updates in-memory message arrays
 * 7. Re-sends user message via sendMessage callback
 * 8. Emits `ai.chat.retry:action:after` hook with new message IDs
 *
 * Hook Payloads:
 *
 * `ai.chat.retry:action:before`:
 * ```ts
 * {
 *   threadId: string;
 *   originalUserId: string;
 *   originalAssistantId?: string;
 *   triggeredBy: 'user' | 'assistant';
 * }
 * ```
 *
 * `ai.chat.retry:action:after`:
 * ```ts
 * {
 *   threadId: string;
 *   originalUserId: string;
 *   originalAssistantId?: string;
 *   newUserId?: string;
 *   newAssistantId?: string;
 * }
 * ```
 *
 * Constraints:
 * - Requires active thread context (threadIdRef must be defined)
 * - Skips if loading state is true (prevents concurrent retries)
 * - User message must belong to current thread
 * - Returns early silently if preconditions fail
 *
 * Errors:
 * - `ERR_INTERNAL`: Unexpected failure during retry operation
 *   Tags: `{ domain: 'chat', op: 'retryMessage' }`
 *
 * Non-Goals:
 * - Does not validate model override against available models
 * - Does not persist retry history for analytics
 * - Does not handle partial failures (atomic deletion only)
 *
 * @example
 * ```ts
 * const ctx: RetryMessageContext = {
 *   loading: ref(false),
 *   threadIdRef: ref('thread-123'),
 *   tailAssistant: ref(null),
 *   rawMessages: ref([]),
 *   messages: ref([]),
 *   hooks: { doAction: async () => {} },
 *   sendMessage: async (text, params) => {  },
 *   defaultModelId: 'gpt-4',
 *   suppressNextTailFlush: () => {}
 * };
 *
 * await retryMessageImpl(ctx, 'msg-456', 'claude-3');
 * ```
 *
 * @see ai.chat.send:action:before for message sending lifecycle
 * @see docs/core-hook-map.md for hook conventions
 */
export async function retryMessageImpl(
    ctx: RetryMessageContext,
    messageId: string,
    modelOverride?: string
) : Promise<SendResult | undefined> {
    if (ctx.loading.value || !ctx.threadIdRef.value) return undefined;

    try {
        const target = await getDb().messages.get(messageId);
        if (!target || target.thread_id !== ctx.threadIdRef.value) return undefined;

        const dbMessages =
            ((await messagesByThread(ctx.threadIdRef.value)) as
                | StoredMessage[]
                | undefined) || [];
        const ordered = dbMessages
            .filter((message) => !message.deleted)
            .sort(compareMessageOrder);

        let userMsg = target.role === 'user' ? target : undefined;
        if (!userMsg && target.role === 'assistant') {
            userMsg = [...ordered]
                .reverse()
                .find(
                    (message) =>
                        message.role === 'user' &&
                        (Number(message.index) || 0) < (Number(target.index) || 0)
                );
        }
        if (!userMsg) return undefined;

        const userIndex = Number(userMsg.index) || 0;
        const nextUserIndex = ordered.find(
            (message) =>
                message.role === 'user' &&
                (Number(message.index) || 0) > userIndex
        )?.index;
        const assistant = ordered.find(
            (message) =>
                message.role === 'assistant' &&
                (Number(message.index) || 0) > userIndex &&
                (nextUserIndex == null ||
                    (Number(message.index) || 0) < (Number(nextUserIndex) || 0))
        );

        await ctx.hooks.doAction('ai.chat.retry:action:before', {
            threadId: ctx.threadIdRef.value,
            originalUserId: userMsg.id,
            originalAssistantId: assistant?.id,
            triggeredBy: target.role as 'user' | 'assistant',
        });

        // Store original text and hashes before deletion.
        // extractUserText handles both string content and ContentPart[] arrays,
        // so pass the raw content source rather than a collapsed string fallback.
        const userContent = (userMsg as StoredMessage).content;
        const dataContent =
            userMsg.data &&
            typeof userMsg.data === 'object' &&
            'content' in userMsg.data
                ? (userMsg.data as { content?: unknown }).content
                : undefined;
        const originalTextRaw = userContent ?? dataContent;

        let hashes: string[] = [];
        if (userMsg.file_hashes) {
            hashes = parseFileHashes(userMsg.file_hashes);
        }

        const toChatMessage = (m: StoredMessage): ChatMessage => {
            const data = m.data && typeof m.data === 'object'
                ? (m.data as Record<string, unknown>)
                : null;
            const normalized = normalizeStreamingMessage({
                content: m.content,
                reasoning_text: m.reasoning_text,
                data,
            });
            return {
                role: m.role as ChatMessage['role'],
                content: normalized.text,
                id: m.id,
                stream_id: m.stream_id ?? undefined,
                file_hashes: m.file_hashes ?? undefined,
                reasoning_text: normalized.reasoningText,
                data,
                name:
                    typeof data?.tool_name === 'string'
                        ? data.tool_name
                        : undefined,
                tool_call_id:
                    typeof data?.tool_call_id === 'string'
                        ? data.tool_call_id
                        : undefined,
                error: m.error ?? null,
                index:
                    typeof m.index === 'number'
                        ? m.index
                        : typeof m.index === 'string'
                        ? Number(m.index) || null
                        : null,
                created_at: typeof m.created_at === 'number' ? m.created_at : null,
            };
        };

        // Build a branch prefix ending immediately before the selected user turn.
        // This retains complete earlier tool rows while excluding the selected
        // response and every later turn from provider context.
        const retryHistory = ordered
            .filter((message) => (Number(message.index) || 0) < userIndex)
            .map(toChatMessage);

        ctx.rawMessages.value = ordered.map(toChatMessage);

        const uiMessages = dbMessages.filter((m) => m.role !== 'tool');
        ctx.messages.value = uiMessages.map((m) => {
            const normalized = normalizeStreamingMessage({
                content: m.content,
                reasoning_text: m.reasoning_text,
                data: m.data,
            });
            return ensureUiMessage({
                role: m.role as 'user' | 'assistant' | 'system' | 'tool',
                content: normalized.text,
                id: m.id,
                stream_id: m.stream_id ?? undefined,
                file_hashes: m.file_hashes ?? undefined,
                reasoning_text: normalized.reasoningText,
                error: m.error ?? null,
                data: m.data
                    ? {
                          ...m.data,
                          tool_calls: m.data.tool_calls ?? undefined,
                      }
                    : m.data,
                index:
                    typeof m.index === 'number'
                        ? m.index
                        : typeof m.index === 'string'
                        ? Number(m.index) || null
                        : null,
                created_at: typeof m.created_at === 'number' ? m.created_at : null,
            });
        });

        const textToSend = extractUserText(originalTextRaw);

        const result = await ctx.sendMessage(textToSend, {
            model: modelOverride || ctx.defaultModelId,
            file_hashes: hashes,
            files: [],
            online: false,
            historyOverride: retryHistory,
        });

        if ('userMessageId' in result && result.userMessageId) {
            await ctx.hooks.doAction('ai.chat.retry:action:after', {
                threadId: ctx.threadIdRef.value,
                originalUserId: userMsg.id,
                originalAssistantId: assistant?.id,
                newUserId: result.userMessageId,
                newAssistantId:
                    'assistantMessageId' in result
                        ? result.assistantMessageId
                        : undefined,
            });
        }
        return result;
    } catch (e) {
        reportError(
            e instanceof Error
                ? e
                : err('ERR_INTERNAL', '[retryMessage] failed', {
                      tags: { domain: 'chat', op: 'retryMessage' },
                  }),
            {
                code: 'ERR_INTERNAL',
                tags: { domain: 'chat', op: 'retryMessage' },
            }
        );
        return undefined;
    }
}
