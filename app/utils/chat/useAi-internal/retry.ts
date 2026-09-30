/**
 * @module app/utils/chat/useAi-internal/retry.ts
 *
 * Purpose:
 * Implements message retry functionality for the AI chat system. Handles the
 * replacement and re-submission of user-assistant message pairs while preserving
 * message context (attachments, reasoning, file hashes).
 *
 * Responsibilities:
 * - Locate the user message associated with a retry target
 * - Supersede only the selected turn after the retry is durably accepted
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
 * - Later turns remain in context and in the conversation
 * - In-memory arrays are restored if the resend is rejected
 */

import type { Ref } from 'vue';
import type { ChatMessage, ContentPart, SendMessageParams, SendResult } from '~/utils/chat/types';
import { hasDurableSendAcceptance } from '~/utils/chat/types';
import { SUPERSEDED_BY_KEY, isSupersededMessage } from '~/utils/chat/transcript';
import { updateMessageRecord } from './persistence';
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
 * Internal helper. Stable turn identity for pairing without numeric indexes.
 * New rows carry `data.turn_id`; legacy rows fall back to the message id.
 */
const turnIdOf = (message: StoredMessage): string => {
    const data =
        message.data && typeof message.data === 'object'
            ? (message.data as Record<string, unknown>)
            : null;
    const turnId = data?.turn_id;
    return typeof turnId === 'string' && turnId ? turnId : message.id;
};

/**
 * Internal helper. Owning user turn for assistant/tool rows, when recorded.
 */
const parentTurnIdOf = (message: StoredMessage): string | undefined => {
    const data =
        message.data && typeof message.data === 'object'
            ? (message.data as Record<string, unknown>)
            : null;
    const parent = data?.parent_turn_id;
    return typeof parent === 'string' && parent ? parent : undefined;
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
 * Retries a message by moving its user-assistant turn to the bottom. The old
 * turn is superseded only after the replacement user row is durable.
 *
 * Behavior:
 * 1. Validates loading state and thread context
 * 2. Locates target message and associated user message
 * 3. Synchronizes in-memory state with IndexedDB if needed
 * 4. Emits `ai.chat.retry:action:before` hook
 * 5. Optimistically hides only the selected turn
 * 6. Re-sends the user message with all other turns as context
 * 7. Supersedes the old turn after the new user row is durable
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
 * - Does not hard-delete rows; synced histories retain superseded records
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
        const db = getDb();
        const threadId = ctx.threadIdRef.value;
        const target = await db.messages.get(messageId);
        if (!target || target.thread_id !== threadId) return undefined;

        const dbMessages =
            ((await messagesByThread(threadId, db)) as
                | StoredMessage[]
                | undefined) || [];
        const ordered = dbMessages
            .filter((message) => !message.deleted && !isSupersededMessage(message))
            .sort(compareMessageOrder);

        // Pair turns by persisted turn relationship first; fall back to
        // canonical position. Numeric `index` comparisons are wrong when rows
        // share an index — the real order is index, then order_key, then id,
        // which `ordered` already reflects.
        const positionById = new Map(ordered.map((message, position) => [message.id, position]));
        const targetPos = positionById.get(target.id) ?? -1;
        if (targetPos < 0) return undefined;

        let userMsg = target.role === 'user' ? target : undefined;
        if (!userMsg && target.role === 'assistant') {
            const parentTurnId = parentTurnIdOf(target as StoredMessage);
            userMsg =
                (parentTurnId
                    ? ordered.find(
                          (message) =>
                              message.role === 'user' &&
                              turnIdOf(message as StoredMessage) === parentTurnId
                      )
                    : undefined) ??
                [...ordered]
                    .reverse()
                    .find(
                        (message) =>
                            message.role === 'user' &&
                            (positionById.get(message.id) ?? -1) < targetPos
                    );
        }
        if (!userMsg || ctx.threadIdRef.value !== threadId) return undefined;

        const userPos = positionById.get(userMsg.id) ?? -1;
        const userTurnId = turnIdOf(userMsg as StoredMessage);
        const nextUserPos = ordered.find(
            (message) =>
                message.role === 'user' &&
                (positionById.get(message.id) ?? -1) > userPos
        )?.id;
        const nextUserPosition =
            nextUserPos !== undefined ? positionById.get(nextUserPos) : undefined;
        const inTurn = (message: StoredMessage) => {
            const pos = positionById.get(message.id) ?? -1;
            return (
                pos > userPos &&
                (nextUserPosition === undefined || pos < nextUserPosition)
            );
        };
        const selectedTurn = ordered.filter((message) => {
            if (message.id === userMsg.id) return true;
            if (message.role === 'user' || message.role === 'system') return false;
            const parentTurnId = parentTurnIdOf(message as StoredMessage);
            return parentTurnId ? parentTurnId === userTurnId : inTurn(message as StoredMessage);
        });
        const selectedIds = new Set(selectedTurn.map((message) => message.id));
        const assistant =
            target.role === 'assistant'
                ? target
                : selectedTurn.find((message) => message.role === 'assistant');

        await ctx.hooks.doAction('ai.chat.retry:action:before', {
            threadId,
            originalUserId: userMsg.id,
            originalAssistantId: assistant?.id,
            triggeredBy: target.role as 'user' | 'assistant',
        });

        // Store original text and hashes before hiding the selected turn.
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

        const toUiMessages = (rows: StoredMessage[]) =>
            rows
                .filter((message) => message.role !== 'tool')
                .map((message) => ensureUiMessage(toChatMessage(message)));
        const originalHistory = ordered.map(toChatMessage);
        const originalUi = toUiMessages(ordered);
        const retainedRows = ordered.filter((message) => !selectedIds.has(message.id));
        // The retry is a new turn at the end. Keep every unrelated turn in
        // both the visible conversation and the provider's model context.
        const retryHistory = retainedRows.map(toChatMessage);
        ctx.rawMessages.value = retryHistory;
        ctx.messages.value = toUiMessages(retainedRows);
        const previousTail = ctx.tailAssistant.value;
        if (previousTail && selectedIds.has(previousTail.id)) {
            ctx.tailAssistant.value = null;
        }

        const restoreOriginalTurn = () => {
            if (ctx.threadIdRef.value !== threadId) return;
            ctx.rawMessages.value = originalHistory;
            ctx.messages.value = originalUi;
            if (previousTail && selectedIds.has(previousTail.id)) {
                ctx.tailAssistant.value = previousTail;
            }
        };

        const supersededIds: string[] = [];
        const marked = new Set<string>();
        const markSelectedTurn = async (newUserId: string) => {
            for (const row of selectedTurn) {
                if (marked.has(row.id)) continue;
                try {
                    await updateMessageRecord(
                        db,
                        row.id,
                        {
                            data: {
                                [SUPERSEDED_BY_KEY]: newUserId,
                                generation_state: 'superseded',
                            },
                        },
                        row as StoredMessage
                    );
                    marked.add(row.id);
                    supersededIds.push(row.id);
                } catch (markError) {
                    reportError(
                        markError instanceof Error
                            ? markError
                            : err('ERR_INTERNAL', '[retryMessage] supersede failed', {
                                  tags: { domain: 'chat', op: 'retryMessage' },
                              }),
                        {
                            code: 'ERR_INTERNAL',
                            tags: { domain: 'chat', op: 'retryMessage' },
                        }
                    );
                }
            }
        };

        const textToSend = extractUserText(originalTextRaw);

        let result: SendResult;
        try {
            result = await ctx.sendMessage(textToSend, {
                model: modelOverride || ctx.defaultModelId,
                file_hashes: hashes,
                files: [],
                online: false,
                historyOverride: retryHistory,
                onUserPersisted: markSelectedTurn,
            });
        } catch (sendError) {
            restoreOriginalTurn();
            throw sendError;
        }

        if (hasDurableSendAcceptance(result) && 'userMessageId' in result && result.userMessageId) {
            // Also cover send implementations that return a durable ID without
            // invoking the early callback, and retry any failed row patches.
            await markSelectedTurn(result.userMessageId);
        } else {
            restoreOriginalTurn();
        }

        if ('userMessageId' in result && result.userMessageId) {
            try {
                await ctx.hooks.doAction('ai.chat.retry:action:after', {
                    threadId,
                    originalUserId: userMsg.id,
                    originalAssistantId: assistant?.id,
                    newUserId: result.userMessageId,
                    newAssistantId:
                        'assistantMessageId' in result
                            ? result.assistantMessageId
                            : undefined,
                    supersededIds,
                });
            } catch (hookError) {
                // A plugin failure cannot undo an accepted retry. Return the
                // durable result so the UI never reports a false no-op.
                reportError(
                    hookError instanceof Error
                        ? hookError
                        : err('ERR_INTERNAL', '[retryMessage] after hook failed', {
                              tags: { domain: 'chat', op: 'retryMessage' },
                          }),
                    {
                        code: 'ERR_INTERNAL',
                        tags: { domain: 'chat', op: 'retryMessage' },
                    }
                );
            }
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
