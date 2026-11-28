import type { Ref } from 'vue';
import type { ChatMessage, ContentPart, SendMessageParams, SendResult } from '~/utils/chat/types';
import { hasDurableSendAcceptance } from '~/utils/chat/types';
import { storedMessagesToCanonicalTranscript, projectTranscriptForOpenRouter } from '~/utils/chat/transcript';
import { resolveThreadProjection } from '~/utils/chat/compaction/history';
import { getDb, getWorkspaceGeneration } from '~/db/client';
import { compareMessageOrder, latestRetryUser, messagesByThread } from '~/db/messages';
import { parseFileHashes } from '~/db/files-util';
import { reportError, err } from '~/utils/errors';
import type { StoredMessage } from './types';
import { normalizeStreamingMessage } from '~/utils/chat/messages';
import { answerRevisionOf, rowsForUserTurn, selectedAnswerVersionRows } from '~/utils/chat/answer-revisions';

export type RetryMessageContext = {
    loading: Ref<boolean>;
    threadIdRef: Ref<string | undefined>;
    hooks: { doAction: (name: string, payload?: unknown) => Promise<unknown> };
    sendMessage: (text: string, params: SendMessageParams) => Promise<SendResult>;
    replaceCanonicalHistory: (history: ChatMessage[]) => void;
    defaultModelId: string;
    ownsView?: () => boolean;
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

/** Replaces the latest turn only after its revisions and replacement commit together. */
export async function retryMessageImpl(
    ctx: RetryMessageContext,
    messageId: string,
    modelOverride?: string
): Promise<SendResult | undefined> {
    if (ctx.loading.value || !ctx.threadIdRef.value) return undefined;

    try {
        const db = getDb();
        const generation = getWorkspaceGeneration();
        const threadId = ctx.threadIdRef.value;
        const ownsRetry = () => !ctx.loading.value &&
            ctx.threadIdRef.value === threadId && getDb() === db && getWorkspaceGeneration() === generation &&
            (ctx.ownsView?.() ?? true);
        const target = await db.messages.get(messageId);
        if (!target || target.thread_id !== threadId) return undefined;

        const dbMessages =
            ((await messagesByThread(threadId, db)) as
                | StoredMessage[]
                | undefined) || [];
        const ordered = selectedAnswerVersionRows(dbMessages.sort(compareMessageOrder));

        const userMsg = ordered.findLast(message => message.role === 'user');
        if (!userMsg || !ownsRetry()) return undefined;
        const selectedTurn = rowsForUserTurn(ordered, userMsg);
        if (target.id !== userMsg.id && (target.role !== 'assistant'
            || !selectedTurn.some(row => row.id === target.id))) return undefined;
        if (selectedTurn.some(message => message.pending)) return undefined;
        const selectedIds = new Set(selectedTurn.map((message) => message.id));
        const assistant =
            target.role === 'assistant'
                ? target
                : selectedTurn.findLast((message) => message.role === 'assistant');

        // Read saved execution evidence before hiding/superseding the turn.
        // A fresh request ledger cannot authorize repeating an uncertain write.
        const group = answerRevisionOf(userMsg)?.groupId;
        const evidence = group
            ? [...selectedTurn, ...dbMessages.filter(row => !row.deleted && answerRevisionOf(row)?.groupId === group)]
            : selectedTurn;
        const uncertain = evidence.some(message => message.role === 'assistant'
            && normalizeStreamingMessage({ data: message.data }).toolCalls.some(call =>
                call.outcome === 'unresolved' || call.executionReceipt?.state === 'running'
                || call.executionReceipt?.state === 'unresolved'));
        if (uncertain) return { status: 'rejected', reason: 'unavailable',
            error: 'This turn includes a tool whose outcome is uncertain. Retry is blocked to avoid repeating an operation. Continue chatting or verify the operation’s outcome first.' };

        await ctx.hooks.doAction('ai.chat.retry:action:before', {
            threadId,
            originalUserId: userMsg.id,
            originalAssistantId: assistant?.id,
            triggeredBy: target.role as 'user' | 'assistant',
        });

        // Read the saved text and attachments for the replacement.
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

        if (!ownsRetry()) return undefined;
        const projection = await resolveThreadProjection(threadId, db);
        // A peer can admit a newer turn while the retry hook or projection waits.
        const latest = await latestRetryUser(db, threadId);
        if (!ownsRetry() || latest?.id !== userMsg.id || latest.clock !== userMsg.clock || latest.hlc !== userMsg.hlc) return undefined;

        // Hydrate the complete current view, including reference ancestors. Only
        // durable replacement can remove any of the selected turn's rows.
        ctx.replaceCanonicalHistory(projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript(projection.messages)));
        const retainedRows = projection.messages.filter(message => !selectedIds.has(message.id));
        const retryHistory = projectTranscriptForOpenRouter(storedMessagesToCanonicalTranscript(retainedRows));

        const result = await ctx.sendMessage(extractUserText(originalTextRaw), {
            model: modelOverride || ctx.defaultModelId,
            file_hashes: hashes,
            files: [],
            online: false,
            historyOverride: retryHistory,
            retryExcludedMessageIds: [...selectedIds],
            retryReplacement: selectedTurn.map(row => ({ id: row.id, clock: row.clock, hlc: row.hlc })),
        });
        const supersededIds = hasDurableSendAcceptance(result) ? [...selectedIds] : [];

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
