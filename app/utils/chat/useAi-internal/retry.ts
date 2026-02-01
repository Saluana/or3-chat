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
import type { ChatMessage, ContentPart, SendMessageParams } from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { getDb } from '~/db/client';
import { messagesByThread } from '~/db/messages';
import { parseFileHashes } from '~/db/files-util';
import { deriveMessageContent } from '~/utils/chat/messages';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import type { Message } from '~/db';
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
    sendMessage: (text: string, params: SendMessageParams) => Promise<void>;
    defaultModelId: string;
    suppressNextTailFlush: (assistantId: string) => void;
};

/**
 * Internal helper. Extracts reasoning text from message data or legacy field.
 */
const toReasoning = (m: StoredMessage) => {
    if (
        m.data &&
        typeof m.data === 'object' &&
        'reasoning_text' in m.data &&
        typeof (m.data as { reasoning_text?: unknown }).reasoning_text === 'string'
    ) {
        return (m.data as { reasoning_text: string }).reasoning_text;
    }
    return typeof m.reasoning_text === 'string' ? m.reasoning_text : null;
};

/**
 * Internal helper. Derives displayable content from stored message fields.
 */
const toContent = (m: StoredMessage) =>
    deriveMessageContent({
        content: m.content,
        data: m.data,
    });

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
) {
    if (ctx.loading.value || !ctx.threadIdRef.value) return;

    try {
        const target = await getDb().messages.get(messageId);
        if (!target || target.thread_id !== ctx.threadIdRef.value) return;

        let userMsg = target.role === 'user' ? target : undefined;
        if (!userMsg && target.role === 'assistant') {
            const DexieMod = (await import('dexie')).default;
            userMsg = await getDb().messages
                .where('[thread_id+index]')
                .between(
                    [target.thread_id, DexieMod.minKey],
                    [target.thread_id, target.index]
                )
                .filter(
                    (m: Message) =>
                        m.role === 'user' &&
                        !m.deleted &&
                        m.index < target.index
                )
                .last();
        }
        if (!userMsg) return;

        const DexieMod2 = (await import('dexie')).default;
        const assistant = await getDb().messages
            .where('[thread_id+index]')
            .between(
                [
                    userMsg.thread_id,
                    (typeof userMsg.index === 'number' ? userMsg.index : 0) + 1,
                ],
                [userMsg.thread_id, DexieMod2.maxKey]
            )
            .filter((m: Message) => m.role === 'assistant' && !m.deleted)
            .first();

        // Suppress flushing of the previous tail assistant if it corresponds to the
        // assistant we are removing for retry.
        if (assistant && ctx.tailAssistant.value?.id === assistant.id) {
            ctx.suppressNextTailFlush(assistant.id);
            ctx.tailAssistant.value = null;
        } else if (target.role === 'assistant' && ctx.tailAssistant.value?.id === target.id) {
            ctx.suppressNextTailFlush(target.id);
            ctx.tailAssistant.value = null;
        }

        await ctx.hooks.doAction('ai.chat.retry:action:before', {
            threadId: ctx.threadIdRef.value,
            originalUserId: userMsg.id,
            originalAssistantId: assistant?.id,
            triggeredBy: target.role as 'user' | 'assistant',
        });

        // Store original text and hashes before deletion
        const originalText =
            typeof (userMsg as StoredMessage).content === 'string'
                ? (userMsg as StoredMessage).content
                : userMsg.data &&
                  typeof userMsg.data === 'object' &&
                  'content' in userMsg.data &&
                  typeof (userMsg.data as { content?: unknown }).content ===
                      'string'
                ? ((userMsg.data as { content?: string }).content as string)
                : '';

        let hashes: string[] = [];
        if (userMsg.file_hashes) {
            hashes = parseFileHashes(userMsg.file_hashes);
        }

        // Before deleting, ensure in-memory state matches DB state.
        const dbMessages =
            ((await messagesByThread(ctx.threadIdRef.value)) as
                | StoredMessage[]
                | undefined) || [];

        // If DB has more messages than our in-memory arrays, sync first.
        if (dbMessages.length > ctx.rawMessages.value.length) {
            if (import.meta.dev) {
                console.warn('[retry] Syncing messages from DB before retry', {
                    dbCount: dbMessages.length,
                    memoryCount: ctx.rawMessages.value.length,
                });
            }

            ctx.rawMessages.value = dbMessages.map(
                (m): ChatMessage => ({
                    role: m.role as ChatMessage['role'],
                    content: toContent(m),
                    id: m.id,
                    stream_id: m.stream_id ?? undefined,
                    file_hashes: m.file_hashes ?? undefined,
                    reasoning_text: toReasoning(m),
                    data: m.data || null,
                    error: m.error ?? null,
                    index:
                        typeof m.index === 'number'
                            ? m.index
                            : typeof m.index === 'string'
                            ? Number(m.index) || null
                            : null,
                    created_at: typeof m.created_at === 'number' ? m.created_at : null,
                })
            );

            const uiMessages = dbMessages.filter((m) => m.role !== 'tool');
            ctx.messages.value = uiMessages.map((m) =>
                ensureUiMessage({
                    role: m.role as 'user' | 'assistant' | 'system' | 'tool',
                    content: toContent(m),
                    id: m.id,
                    stream_id: m.stream_id ?? undefined,
                    file_hashes: m.file_hashes ?? undefined,
                    reasoning_text: toReasoning(m),
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
                })
            );
        }

        // Delete from database
        await getDb().transaction('rw', getDb().messages, async () => {
            await getDb().messages.delete(userMsg.id);
            if (assistant) await getDb().messages.delete(assistant.id);
        });

        // Remove deleted messages from in-memory arrays
        ctx.rawMessages.value = ctx.rawMessages.value.filter(
            (m) => m.id !== userMsg.id && m.id !== assistant?.id
        );
        ctx.messages.value = ctx.messages.value.filter(
            (m) => m.id !== userMsg.id && m.id !== assistant?.id
        );

        const textToSend = extractUserText(originalText);

        await ctx.sendMessage(textToSend, {
            model: modelOverride || ctx.defaultModelId,
            file_hashes: hashes,
            files: [],
            online: false,
        });

        const tail = ctx.messages.value.slice(-2);
        const newUser = tail.find((m) => m.role === 'user');
        const newAssistant = tail.find((m) => m.role === 'assistant');

        await ctx.hooks.doAction('ai.chat.retry:action:after', {
            threadId: ctx.threadIdRef.value,
            originalUserId: userMsg.id,
            originalAssistantId: assistant?.id,
            newUserId: newUser?.id,
            newAssistantId: newAssistant?.id,
        });
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
    }
}
