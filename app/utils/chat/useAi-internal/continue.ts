/**
 * @module app/utils/chat/useAi-internal/continue.ts
 *
 * Purpose:
 * Implements message continuation functionality for the AI chat system. Handles
 * resuming an incomplete assistant response by feeding it its own tail and
 * prompting the model to continue from where it left off.
 *
 * Responsibilities:
 * - Locate the target assistant message and its context
 * - Build a continuation prompt with tail snippet
 * - Stream continuation from OpenRouter
 * - Merge continuation text with existing content
 * - Handle boundary spacing between old and new text
 * - Persist final state to IndexedDB
 *
 * Non-responsibilities:
 * - Does not handle retry logic (see retry.ts)
 * - Does not manage thread lifecycle
 * - Does not validate user permissions
 *
 * Architecture:
 * - Operates within the useAi composable internal suite
 * - Uses Dexie for local-first IndexedDB operations
 * - Relies on hooks system for message filtering
 */

import type { Ref } from 'vue';
import type { Message } from '~/db';
import type { ChatMessage, ContentPart } from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { getDb } from '~/db/client';
import { newId } from '~/db/util';
import { parseHashes } from '~/utils/files/attachments';
import { createOrRefFile } from '~/db/files';
import { deriveMessageContent, trimOrMessagesImages } from '~/utils/chat/messages';
import { composeSystemPrompt } from '~/utils/chat/prompt-utils';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import { dataUrlToBlob } from '~/utils/chat/files';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import { reportError, err } from '~/utils/errors';
import type { StoredMessage, OpenRouterMessage } from './types';
import { makeAssistantPersister, updateMessageRecord } from './persistence';

/** Model input message for OpenRouter build */
type ModelInputMessage = {
    role: 'user' | 'assistant' | 'system';
    content: string | ContentPart[];
    id?: string;
    file_hashes?: string | null;
    name?: string;
    tool_call_id?: string;
};

/** Chat settings from useAiSettings */
type ChatSettings = {
    masterSystemPrompt?: string;
    [key: string]: unknown;
};

/**
 * Minimal hook interface required by continue operations.
 */
type HooksLike = {
    applyFilters: (name: string, value: unknown) => Promise<unknown>;
};

/**
 * Stream accumulator interface for tracking stream state.
 */
type StreamAccumulatorLike = {
    reset: () => void;
    append: (text: string, opts: { kind: 'text' | 'reasoning' }) => void;
    finalize: (opts?: { error?: Error }) => void;
    state: { finalized: boolean };
};

/**
 * Context object required for continue operations.
 */
export type ContinueMessageContext = {
    loading: Ref<boolean>;
    aborted: Ref<boolean>;
    abortController: Ref<AbortController | null>;
    threadIdRef: Ref<string | undefined>;
    tailAssistant: Ref<UiChatMessage | null>;
    rawMessages: Ref<ChatMessage[]>;
    messages: Ref<UiChatMessage[]>;
    streamId: Ref<string | undefined>;
    streamAcc: StreamAccumulatorLike;
    streamState: { finalized: boolean };
    hooks: HooksLike;
    effectiveApiKey: Ref<string | null>;
    hasInstanceKey: Ref<boolean>;
    defaultModelId: string;
    getSystemPromptContent: () => Promise<string | null>;
    useAiSettings: () => { settings: Ref<ChatSettings | undefined> };
    resetStream: () => void;
};

/** Number of tail characters to include in continuation prompt */
const CONTINUE_TAIL_CHARS = 1200;

/** Continuation prefix that model is instructed to emit */
const CONTINUATION_PREFIX = '>>';

/** Write interval for persistence during streaming */
const WRITE_INTERVAL_MS = 500;

/**
 * Internal helper. Extracts reasoning text from message data or legacy field.
 */
const toReasoning = (m: StoredMessage): string | null => {
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
 * Build the continuation system prompt prefix.
 */
const buildContinueSystemPrefix = (): string =>
    [
        'First and foremost, you are a text autocomplete engine.',
        'You will be given the end of a text stream.',
        'Output only the exact continuation with matching tone, voice, and formatting.',
        'Never repeat the provided context.',
        'Never add commentary, apologies, or meta statements.',
        'Assume the context ends at a valid character boundary.',
        'Do not extend or retype the final word unless it is clearly incomplete.',
        'Decide whether the very next character should be punctuation, a space, or a letter.',
        'If a sentence should end, start with the correct punctuation (e.g. ".", "?", "!") before continuing.',
    ].join(' ');

/**
 * Build the continuation user prompt.
 */
const buildContinuationText = (tailSnippet: string): string => {
    if (!tailSnippet) {
        return 'Please continue your previous response from where you left off.';
    }
    return [
        'You are a text recovery engine. Your only task is to continue the text stream seamlessly.',
        '',
        'CONTEXT (the previous assistant output ends exactly here):',
        '<<CONTEXT>>',
        tailSnippet,
        '<<END CONTEXT>>',
        '',
        'INSTRUCTIONS:',
        '1. Continue immediately from the last character in the context.',
        '2. Assume the context ends at a valid character boundary.',
        '3. Do not extend or retype the final word unless it is clearly incomplete.',
        '4. Decide whether the next character should be punctuation, a space, or a letter, and start with that.',
        '5. If a sentence should end, emit the punctuation first, then continue.',
        '6. Do not repeat any of the context.',
        '7. Do not add any conversational filler or meta commentary.',
        '8. Start your response with ">>" and then the continuation.',
        'Examples:',
        'A) Context ends with: "the" -> Response: ">> dog walked..."',
        'B) Context ends with: "revolu" -> Response: ">>tion..."',
        'C) Context ends with: "data warehouses" -> Response: ">>. Organizations..."',
    ].join('\n');
};

/**
 * Check if a space is needed between prev and next text at boundary.
 */
const needsBoundarySpace = (prev: string, next: string): boolean => {
    if (!prev || !next) return false;
    if (/\s$/.test(prev) || /^\s/.test(next)) return false;
    const last = prev.slice(-1);
    const first = next[0];
    const noSpaceAfter = new Set([
        '(',
        '[',
        '{',
        '<',
        '«',
        '“',
        '‘',
        '"',
        "'",
        '`',
        '/',
        '\\',
        '-',
        '–',
        '—',
    ]);
    const noSpaceBefore = new Set([
        ',',
        '.',
        '…',
        ';',
        ':',
        '!',
        '?',
        '%',
        ')',
        ']',
        '}',
        '>',
        '»',
        '”',
        '’',
        '"',
        "'",
        '`',
    ]);
    if (noSpaceAfter.has(last)) return false;
    if (!first || noSpaceBefore.has(first)) return false;
    const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);
    const isClosePunct = /[)\]}>"'»”’]/.test(last);
    const isSentencePunct = /[.!?;:…]/.test(last);
    if (isWordChar(last) && isWordChar(first)) return true;
    if ((isSentencePunct || isClosePunct) && isWordChar(first)) return true;
    return false;
};

/**
 * Check if a message should be kept (non-empty assistant messages).
 */
const shouldKeepAssistantMessage = (m: ChatMessage): boolean => {
    if (m.role !== 'assistant') return true;
    const c = m.content;
    if (typeof c === 'string') return c.trim().length > 0;
    if (Array.isArray(c)) {
        return c.some((p) => {
            if (p.type === 'text') return p.text.trim().length > 0;
            // image and file parts are always considered non-empty
            return true;
        });
    }
    return true;
};

/**
 * Check if message input has image content.
 */
const hasImageContent = (messages: ModelInputMessage[]): boolean =>
    messages.some((m) =>
        Array.isArray(m.content)
            ? m.content.some((p) => {
                  const part = p as { type?: string; mediaType?: string };
                  if (part.type === 'image' || part.type === 'image_url') return true;
                  if (part.mediaType) return /image\//.test(part.mediaType);
                  return false;
              })
            : false
    );

/**
 * `ai.chat.continue:action:*` (action)
 *
 * Purpose:
 * Continues an incomplete assistant message by feeding its tail to the model
 * and streaming the continuation, then merging with existing content.
 *
 * Behavior:
 * 1. Validates loading state, thread context, and API key availability
 * 2. Fetches target assistant message and all prior context
 * 3. Builds continuation prompt with tail snippet
 * 4. Applies message filters via hooks
 * 5. Streams continuation from OpenRouter
 * 6. Strips continuation prefix and applies boundary spacing
 * 7. Persists merged content to IndexedDB
 *
 * Constraints:
 * - Requires active thread context
 * - Target must be an assistant message in current thread
 * - Requires valid API key (user or instance)
 *
 * Errors:
 * - `ERR_INTERNAL`: Unexpected failure during continue operation
 * - `ERR_STREAM_FAILURE`: Stream interrupted during continuation
 */
export async function continueMessageImpl(
    ctx: ContinueMessageContext,
    messageId: string,
    modelOverride?: string
): Promise<void> {
    if (ctx.loading.value || !ctx.threadIdRef.value) return;
    const hasKey = Boolean(ctx.effectiveApiKey.value) || ctx.hasInstanceKey.value;
    if (!hasKey) return;

    try {
        const target = (await getDb().messages.get(messageId)) as StoredMessage | undefined;
        if (
            !target ||
            target.thread_id !== ctx.threadIdRef.value ||
            target.role !== 'assistant'
        ) {
            return;
        }

        const inMemoryText =
            ctx.tailAssistant.value?.id === target.id ? ctx.tailAssistant.value.text : '';
        const existingText =
            inMemoryText ||
            deriveMessageContent({
                content: (target as { content?: string | ContentPart[] | null }).content,
                data: target.data,
            });
        if (!existingText) return;

        const DexieMod = (await import('dexie')).default;
        const all = await getDb()
            .messages.where('[thread_id+index]')
            .between([ctx.threadIdRef.value, DexieMod.minKey], [ctx.threadIdRef.value, target.index])
            .filter((m: Message) => !m.deleted)
            .toArray();
        all.sort((a: Message, b: Message) => (a.index || 0) - (b.index || 0));

        const toContent = (m: StoredMessage): string => {
            if (m.id === target.id) return existingText;
            return deriveMessageContent({
                content: (m as { content?: string | ContentPart[] | null }).content,
                data: m.data,
            });
        };

        const baseMessages: ChatMessage[] = all.map((m): ChatMessage => {
            const storedMsg: StoredMessage = {
                ...m,
                data:
                    m.data && typeof m.data === 'object'
                        ? (m.data as StoredMessage['data'])
                        : null,
            };
            const rawData = storedMsg.data;
            const data: Record<string, unknown> | null = rawData
                ? (rawData as Record<string, unknown>)
                : null;
            const name =
                data && typeof (data as { tool_name?: unknown }).tool_name === 'string'
                    ? ((data as { tool_name: string }).tool_name as string)
                    : undefined;
            const toolCallId =
                data && typeof (data as { tool_call_id?: unknown }).tool_call_id === 'string'
                    ? ((data as { tool_call_id: string }).tool_call_id as string)
                    : undefined;
            return {
                role: m.role as ChatMessage['role'],
                content: toContent(storedMsg),
                id: m.id,
                stream_id: m.stream_id ?? undefined,
                file_hashes: m.file_hashes ?? undefined,
                reasoning_text: toReasoning(storedMsg),
                data,
                name,
                tool_call_id: toolCallId,
                error: m.error ?? null,
                index:
                    typeof m.index === 'number'
                        ? m.index
                        : typeof m.index === 'string'
                          ? Number(m.index) || null
                          : null,
                created_at: typeof m.created_at === 'number' ? m.created_at : null,
            };
        });

        const tailSnippet = existingText.slice(-CONTINUE_TAIL_CHARS);
        const continuationText = buildContinuationText(tailSnippet);
        baseMessages.push({
            role: 'user',
            content: [{ type: 'text', text: continuationText }],
            id: `continue-${newId()}`,
        });

        const threadSystemText = await ctx.getSystemPromptContent();
        let finalSystem: string | null = null;
        try {
            const { settings } = ctx.useAiSettings();
            const settingsValue = settings.value as ChatSettings | undefined;
            const master = settingsValue?.masterSystemPrompt ?? '';
            finalSystem = composeSystemPrompt(master, threadSystemText || null);
        } catch {
            finalSystem = (threadSystemText || '').trim() || null;
        }

        const continueSystemPrefix = buildContinueSystemPrefix();
        if (finalSystem && finalSystem.trim()) {
            finalSystem = `${continueSystemPrefix}\n\n${finalSystem.trim()}`;
        } else {
            finalSystem = continueSystemPrefix;
        }
        if (finalSystem && finalSystem.trim()) {
            baseMessages.unshift({
                role: 'system',
                content: finalSystem,
                id: `system-${newId()}`,
            });
        }

        const effectiveMessages = await ctx.hooks.applyFilters(
            'ai.chat.messages:filter:input',
            baseMessages
        );

        const sanitizedEffectiveMessages = (
            Array.isArray(effectiveMessages) ? effectiveMessages : []
        ).filter(shouldKeepAssistantMessage);

        const isModelMessage = (
            m: ChatMessage
        ): m is ChatMessage & { role: 'user' | 'assistant' | 'system' } => m.role !== 'tool';

        const modelInputMessages: ModelInputMessage[] = sanitizedEffectiveMessages
            .filter(isModelMessage)
            .map(
                (m): ModelInputMessage => ({
                    role: m.role,
                    content: m.content,
                    id: m.id,
                    file_hashes: m.file_hashes,
                    name: m.name,
                    tool_call_id: m.tool_call_id,
                })
            );

        const { buildOpenRouterMessages } = await import('~/core/auth/openrouter-build');
        let orMessages: OpenRouterMessage[] = await buildOpenRouterMessages(modelInputMessages, {
            maxImageInputs: 16,
            imageInclusionPolicy: 'all',
            debug: false,
        });
        trimOrMessagesImages(orMessages as Parameters<typeof trimOrMessagesImages>[0], 5);

        const filteredMessages = await ctx.hooks.applyFilters(
            'ai.chat.messages:filter:before_send',
            { messages: orMessages }
        );

        if (
            filteredMessages &&
            typeof filteredMessages === 'object' &&
            'messages' in filteredMessages
        ) {
            const candidate = (filteredMessages as { messages?: OpenRouterMessage[] })
                .messages;
            if (Array.isArray(candidate)) {
                orMessages = candidate;
            }
        }

        const modelCandidate = await ctx.hooks.applyFilters(
            'ai.chat.model:filter:select',
            modelOverride || ctx.defaultModelId
        );
        const modelId =
            (typeof modelCandidate === 'string' && modelCandidate) ||
            modelOverride ||
            ctx.defaultModelId;
        // modalities controls OUTPUT format, not input capability
        // Only request image output for actual image generation models
        const isImageGenerationModel = /dall-e|stable-diffusion|midjourney|imagen/i.test(modelId);
        const modalities = isImageGenerationModel ? ['image', 'text'] : ['text'];

        ctx.streamAcc.reset();
        const newStreamId = newId();
        ctx.streamId.value = newStreamId;
        ctx.loading.value = true;
        ctx.aborted.value = false;
        ctx.abortController.value = new AbortController();

        const existingReasoning = toReasoning(target);
        const existingHashes = target.file_hashes ? parseHashes(target.file_hashes) : [];
        let existingUiIndex = ctx.messages.value.findIndex((m) => m.id === target.id);
        let existingUi: UiChatMessage | null = null;
        if (existingUiIndex >= 0) {
            existingUi = ctx.messages.value[existingUiIndex] ?? null;
        }

        const current =
            (ctx.tailAssistant.value && ctx.tailAssistant.value.id === target.id
                ? ctx.tailAssistant.value
                : existingUi) ||
            ensureUiMessage({
                role: 'assistant',
                content: existingText,
                id: target.id,
                stream_id: target.stream_id ?? undefined,
                reasoning_text: existingReasoning,
                file_hashes: target.file_hashes ?? undefined,
                error: null,
            });
        current.text = existingText;
        current.reasoning_text = existingReasoning;
        current.pending = true;
        current.error = null;
        if (existingHashes.length) current.file_hashes = existingHashes;
        ctx.tailAssistant.value = current;

        if (existingText) {
            ctx.streamAcc.append(existingText, { kind: 'text' });
        }
        if (existingReasoning) {
            ctx.streamAcc.append(existingReasoning, { kind: 'reasoning' });
        }

        const assistantFileHashes = existingHashes.slice();
        const persistAssistant = makeAssistantPersister(target, assistantFileHashes);

        const stream = openRouterStream({
            apiKey: ctx.effectiveApiKey.value,
            model: modelId,
            orMessages: orMessages as Parameters<typeof openRouterStream>[0]['orMessages'],
            modalities,
            signal: ctx.abortController.value.signal,
        });

        let chunkIndex = 0;
        let stripPrefixPending = true;
        let prefixBuffer = '';
        let boundarySpacingApplied = false;

        const applyBoundarySpacing = (prev: string, next: string): string => {
            if (boundarySpacingApplied) return next;
            boundarySpacingApplied = true;
            return needsBoundarySpace(prev, next) ? ` ${next}` : next;
        };

        const consumeContinuationDelta = (delta: string): string => {
            if (!stripPrefixPending) return delta;
            prefixBuffer += delta;
            if (prefixBuffer.length < CONTINUATION_PREFIX.length) return '';
            if (prefixBuffer.startsWith(CONTINUATION_PREFIX)) {
                prefixBuffer = prefixBuffer.slice(CONTINUATION_PREFIX.length);
            }
            stripPrefixPending = false;
            const out = prefixBuffer;
            prefixBuffer = '';
            return out;
        };

        let lastPersistAt = 0;

        try {
            for await (const ev of stream) {
                if (ev.type === 'reasoning') {
                    if (current.reasoning_text === null) current.reasoning_text = ev.text;
                    else current.reasoning_text += ev.text;
                    ctx.streamAcc.append(ev.text, { kind: 'reasoning' });
                } else if (ev.type === 'text') {
                    if (current.pending) current.pending = false;
                    const rawDelta = consumeContinuationDelta(ev.text);
                    if (!rawDelta) continue;
                    const delta = applyBoundarySpacing(current.text, rawDelta);
                    if (!delta) continue;
                    ctx.streamAcc.append(delta, { kind: 'text' });
                    current.text += delta;
                    chunkIndex++;
                } else if (ev.type === 'image') {
                    if (current.pending) current.pending = false;
                    // Store image first, then use hash placeholder (not Base64)
                    if (assistantFileHashes.length < 6) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/')) blob = dataUrlToBlob(ev.url);
                        else if (/^https?:/.test(ev.url)) {
                            try {
                                blob = await $fetch<Blob>(ev.url, { responseType: 'blob' });
                            } catch {
                                /* intentionally empty */
                            }
                        }
                        if (blob) {
                            try {
                                const meta = await createOrRefFile(blob, 'gen-image');
                                assistantFileHashes.push(meta.hash);
                                const placeholder = `![file-hash:${meta.hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`;
                                const already = current.text.includes(placeholder);
                                if (!already) {
                                    current.text += (current.text ? '\n\n' : '') + placeholder;
                                }
                                const serialized = await persistAssistant({
                                    content: current.text,
                                    reasoning: current.reasoning_text ?? null,
                                });
                                current.file_hashes = serialized?.split(',') ?? [];
                            } catch {
                                /* intentionally empty */
                            }
                        } else {
                            // Fallback: couldn't convert to blob, use URL directly
                            const placeholder = `![generated image](${ev.url})`;
                            const already = current.text.includes(placeholder);
                            if (!already) {
                                current.text += (current.text ? '\n\n' : '') + placeholder;
                            }
                        }
                    }
                }

                const now = Date.now();
                const shouldPersist =
                    now - lastPersistAt >= WRITE_INTERVAL_MS || chunkIndex % 50 === 0;
                if (shouldPersist) {
                    await persistAssistant({
                        content: current.text,
                        reasoning: current.reasoning_text ?? null,
                        toolCalls: current.toolCalls ?? undefined,
                    });
                    if (assistantFileHashes.length) {
                        current.file_hashes = assistantFileHashes;
                    }
                    lastPersistAt = now;
                }
            }

            if (current.pending) current.pending = false;
            await persistAssistant({
                content: current.text,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                finalize: true, // Clear pending so sync captures this
            });
            await updateMessageRecord(messageId, { error: null });
            current.error = null;
            const rawIdx = ctx.rawMessages.value.findIndex((m) => m.id === messageId);
            if (rawIdx >= 0) {
                const existingRaw = ctx.rawMessages.value[rawIdx];
                if (existingRaw) {
                    ctx.rawMessages.value[rawIdx] = {
                        ...existingRaw,
                        role: existingRaw.role,
                        content: current.text,
                        reasoning_text: current.reasoning_text ?? null,
                        error: null,
                    };
                }
            }
            ctx.streamAcc.finalize();
        } catch (streamError) {
            const e = streamError instanceof Error ? streamError : new Error(String(streamError));
            ctx.streamAcc.finalize({ error: e });

            // Stream interrupted - aborted.value would be true for user stops but those don't throw
            const errorType = 'stream_interrupted';

            const tail = ctx.tailAssistant.value;
            const tailText = tail.text;
            const tailReasoning = tail.reasoning_text ?? null;
            const tailToolCalls = tail.toolCalls ?? null;
            tail.error = errorType;
            await persistAssistant({
                content: tailText,
                reasoning: tailReasoning,
                toolCalls: tailToolCalls,
                finalize: true, // Clear pending so sync captures this
            });
            const rawIdx = ctx.rawMessages.value.findIndex((m) => m.id === messageId);
            if (rawIdx >= 0) {
                const existingRaw = ctx.rawMessages.value[rawIdx];
                if (existingRaw) {
                    ctx.rawMessages.value[rawIdx] = {
                        ...existingRaw,
                        role: existingRaw.role,
                        content: tailText || existingRaw.content,
                        reasoning_text: tailReasoning ?? existingRaw.reasoning_text,
                        error: errorType,
                    };
                }
            }
            await updateMessageRecord(messageId, { error: errorType });

            // Show error toast for stream interruptions
            reportError(e, {
                code: 'ERR_STREAM_FAILURE',
                tags: {
                    domain: 'chat',
                    threadId: ctx.threadIdRef.value || '',
                    streamId: ctx.streamId.value || '',
                    modelId,
                    stage: 'continue',
                },
                toast: true,
            });
        } finally {
            ctx.loading.value = false;
            const tailRef = ctx.tailAssistant.value;
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- tailRef may be null if stream setup failed
            if (tailRef) tailRef.pending = false;
            ctx.abortController.value = null;
            setTimeout(() => {
                if (!ctx.loading.value && ctx.streamState.finalized) ctx.resetStream();
            }, 0);
        }
    } catch (e) {
        reportError(
            e instanceof Error
                ? e
                : err('ERR_INTERNAL', '[continueMessage] failed', {
                      tags: { domain: 'chat', op: 'continueMessage' },
                  }),
            {
                code: 'ERR_INTERNAL',
                tags: { domain: 'chat', op: 'continueMessage' },
            }
        );
    }
}
