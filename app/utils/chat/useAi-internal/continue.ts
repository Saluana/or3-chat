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
import { compareMessageOrder } from '~/db/messages';
import type { ChatMessage, ContentPart } from '~/utils/chat/types';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { getDb } from '~/db/client';
import { newId } from '~/db/util';
import { parseHashes } from '~/utils/files/attachments';
import { createOrRefFile } from '~/db/files';
import {
    shouldKeepAssistantMessage,
    getChatModalities,
    normalizeStreamingMessage,
} from '~/utils/chat/messages';
import { composeSystemPrompt } from '~/utils/chat/prompt-utils';
import { ensureUiMessage } from '~/utils/chat/uiMessages';
import {
    openRouterStreamWithRetry,
    startBackgroundStream,
} from '~/utils/chat/openrouterStream';
import { dataUrlToBlob, fetchImageBlob } from '~/utils/chat/files';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import { asAppError, reportError, err } from '~/utils/errors';
import type { StoredMessage, OpenRouterMessage } from './types';
import { makeAssistantPersister, updateMessageRecord } from './persistence';
import { createForegroundGenerationLease } from '~/utils/chat/generation-lease';
import {
    buildOpenRouterMessagesForSend,
    enforceOpenRouterMessageTokenBudget,
} from './messageBuild';
import { createStreamWriteCoalescer } from './streamWriteCoalescer';
import { utf8Bytes } from '~~/shared/chat/tool-limits';
import { DEFAULT_MAX_INPUT_TOKENS } from '~/utils/chat/constants';
import {
    CONTINUATION_PREFIX,
    CONTINUE_TAIL_CHARS,
    createContinuationDeltaNormalizer,
} from '~~/shared/chat/continuation';
import type { BackgroundJobTracker } from './types';
import { projectCanonicalBackgroundMessage } from './backgroundJobPersistence';
import { finalizeRequest, type ChatRequest } from './requestController';

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
    hydrate?: (seed: { text?: unknown; reasoningText?: unknown }) => void;
    finalize: (opts?: { error?: Error }) => void;
    state: { finalized: boolean };
};

/**
 * Context object required for continue operations.
 */
export type ContinueMessageContext = {
    request: ChatRequest;
    loading: Readonly<Ref<boolean>>;
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
    resolveInputTokenBudget?: (modelId: string) => number | Promise<number>;
    resetStream: () => void;
    backgroundStreamingAllowed?: boolean;
    workspaceId?: string;
    userId?: string;
    beginBackgroundAdmission?: (admissionId: string, messageId: string) => void;
    attachBackgroundJob?: (params: {
        jobId: string;
        messageId: string;
        threadId: string;
        originDb: ReturnType<typeof getDb>;
        workspaceId: string;
        generationId: string;
        initialContent: string;
        initialReasoning: string;
    }) => BackgroundJobTracker;
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
/** Thrown when the chat navigates away mid-continuation; handled quietly. */
export class ContinuationOwnershipLost extends Error {
    constructor() {
        super('Continuation superseded by thread navigation');
        this.name = 'ContinuationOwnershipLost';
    }
}

export async function continueMessageImpl(
    ctx: ContinueMessageContext,
    messageId: string,
    modelOverride?: string
): Promise<void> {
    if (ctx.request.phase.value !== 'admitted' || !ctx.threadIdRef.value)
        return;
    const hasKey = Boolean(ctx.effectiveApiKey.value) || ctx.hasInstanceKey.value;
    if (!hasKey) return;
    // Request scoping: capture ownership before the first await. Every later
    // stage re-verifies it so a thread switch during setup cannot resume the
    // continuation in the wrong chat.
    const request = ctx.request;
    const originDb = request.originDb;
    const originThreadId = request.threadId!;
    const ownsThread = () => !request.cancelled && request.ownsView();
    let activeCurrent: UiChatMessage | null = null;
    let targetMarkedPending = false;
    let continuationAbortController: AbortController | null = null;
    let innerStreamLifecycleStarted = false;
    let backgroundAdmissionStarted = false;

    try {
        const target = (await originDb.messages.get(messageId)) as StoredMessage | undefined;
        if (!ownsThread()) return;
        if (
            !target ||
            target.thread_id !== originThreadId ||
            target.role !== 'assistant'
        ) {
            return;
        }

        const inMemoryText =
            ctx.tailAssistant.value?.id === target.id ? ctx.tailAssistant.value.text : '';
        const normalizedTarget = normalizeStreamingMessage({
            ...target,
            text: inMemoryText || undefined,
            content: (target as {
                content?: string | ContentPart[] | null;
            }).content,
        });
        const existingText = normalizedTarget.text;
        if (!existingText) return;

        const DexieMod = (await import('dexie')).default;
        const all = await originDb.messages
            .where('[thread_id+index]')
            .between([ctx.threadIdRef.value, DexieMod.minKey], [ctx.threadIdRef.value, target.index])
            .filter((m: Message) => !m.deleted)
            .toArray();
        all.sort(compareMessageOrder);
        if (!ownsThread()) return;

        const toContent = (m: StoredMessage): string => {
            if (m.id === target.id) return existingText;
            return normalizeStreamingMessage({
                content: (m as { content?: string | ContentPart[] | null }).content,
                data: m.data,
                reasoning_text: m.reasoning_text,
            }).text;
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
                reasoning_text: normalizeStreamingMessage(storedMsg)
                    .reasoningText,
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
            Array.isArray(effectiveMessages)
                ? (effectiveMessages as unknown[])
                : []
        ).filter((message): message is ChatMessage => {
            if (!message || typeof message !== 'object') return false;
            const candidate = message as Partial<ChatMessage>;
            return (
                typeof candidate.role === 'string' &&
                shouldKeepAssistantMessage({
                    role: candidate.role,
                    content: candidate.content,
                })
            );
        });

        let orMessages = await buildOpenRouterMessagesForSend({
            effectiveMessages: sanitizedEffectiveMessages,
            assistantHashes: [],
            // Continue reuses the target assistant's own file hashes in context;
            // don't clear them. Context-hash injection is not wired for continue yet.
            contextHashes: [],
            fileHashes: [],
            maxImageInputs: 5,
            imageInclusionPolicy: 'all',
        });

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
        if (!ownsThread()) return;
        orMessages = await enforceOpenRouterMessageTokenBudget(
            orMessages,
            (await ctx.resolveInputTokenBudget?.(modelId)) ??
                DEFAULT_MAX_INPUT_TOKENS
        );
        // Last setup gate: never publish stream state into a new chat.
        if (!ownsThread()) return;
        if (orMessages.length === 0)
            throw new Error(
                'No model input remained after continuation filters.'
            );
        // modalities controls OUTPUT format, not input capability
        const modalities = getChatModalities(modelId);
        const useBackground =
            ctx.backgroundStreamingAllowed === true &&
            modalities.length === 1 &&
            modalities[0] === 'text' &&
            Boolean(ctx.workspaceId && ctx.userId && ctx.attachBackgroundJob);

        ctx.streamAcc.reset();
        const newStreamId = newId();
        ctx.streamId.value = newStreamId;
        request.phase.value = 'streaming';
        ctx.aborted.value = false;
        continuationAbortController = new AbortController();
        request.abortController = continuationAbortController;
        ctx.abortController.value = continuationAbortController;

        const existingReasoning = normalizedTarget.reasoningText;
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
        activeCurrent = current;
        request.message = current;
        request.assistantMessageId = messageId;
        request.assistantRecord = target;

        if (ctx.streamAcc.hydrate) {
            ctx.streamAcc.hydrate({
                text: existingText,
                reasoningText: existingReasoning,
            });
        } else {
            if (existingText) {
                ctx.streamAcc.append(existingText, { kind: 'text' });
            }
            if (existingReasoning) {
                ctx.streamAcc.append(existingReasoning, { kind: 'reasoning' });
            }
        }

        const assistantFileHashes = existingHashes.slice();
        const persistAssistant = makeAssistantPersister(
            originDb,
            target,
            assistantFileHashes,
            newStreamId
        );
        request.persistAssistant = persistAssistant;
        request.streamId = newStreamId;

        // Durable generation identity must precede the first continuation byte,
        // so reload can distinguish an active continuation from a stale row.
        // Stale background job identity is cleared atomically: otherwise the
        // old job ID makes foreground recovery skip this row and the new
        // generation cannot be reconciled.
        targetMarkedPending = true;
        target.pending = true;
        target.stream_id = newStreamId;
        target.error = null;
        const priorGenerationId =
            target.data && typeof target.data === 'object' &&
            typeof (target.data as Record<string, unknown>).generation_id === 'string'
                ? (target.data as Record<string, unknown>).generation_id as string
                : undefined;
        const backgroundAdmissionId = useBackground ? newId() : undefined;
        if (useBackground && backgroundAdmissionId) {
            request.backgroundAdmissionId = backgroundAdmissionId;
            backgroundAdmissionStarted = true;
            ctx.beginBackgroundAdmission?.(backgroundAdmissionId, messageId);
        }
        await updateMessageRecord(originDb, messageId, {
            pending: true,
            stream_id: newStreamId,
            error: null,
            data: {
                error: null,
                generation_state: 'streaming',
                generation_id: newStreamId,
                request_id: backgroundAdmissionId ?? newStreamId,
                generation_mode: useBackground ? 'background' : 'foreground',
                background_job_id: undefined,
                background_job_status: undefined,
                background_job_error: undefined,
                background_admission_id: backgroundAdmissionId,
                background_history_version: useBackground ? 1 : undefined,
                ...(useBackground ? {} : createForegroundGenerationLease(newStreamId)),
            },
        });

        if (useBackground) {
            const admittedAssistant = await originDb.messages.get(messageId);
            if (!admittedAssistant || !backgroundAdmissionId || !ctx.workspaceId) {
                throw new Error('Unable to capture continuation history');
            }
            const result = await startBackgroundStream({
                apiKey: ctx.effectiveApiKey.value,
                model: modelId,
                orMessages: orMessages as Parameters<typeof startBackgroundStream>[0]['orMessages'],
                modalities,
                threadId: originThreadId,
                messageId: target.id,
                admissionId: backgroundAdmissionId,
                history: {
                    version: 1,
                    kind: 'continuation',
                    admissionId: backgroundAdmissionId,
                    generationId: newStreamId,
                    workspaceId: ctx.workspaceId,
                    threadId: originThreadId,
                    messageId: target.id,
                    assistantMessage: admittedAssistant,
                    expectedAssistant: {
                        clock: target.clock,
                        ...(priorGenerationId
                            ? { generationId: priorGenerationId }
                            : {}),
                    },
                },
                signal: continuationAbortController.signal,
            });
            request.jobId = result.jobId;
            if (request.cancelled && request.stopConfirmation) {
                throw new DOMException('Admission cancelled', 'AbortError');
            }
            await projectCanonicalBackgroundMessage(originDb, messageId, {
                data: {
                    background_job_id: result.jobId,
                    background_job_status: 'streaming',
                },
            });
            const tracker = ctx.attachBackgroundJob!({
                jobId: result.jobId,
                messageId: target.id,
                threadId: originThreadId,
                originDb,
                workspaceId: ctx.workspaceId,
                generationId: newStreamId,
                initialContent: existingText,
                initialReasoning: existingReasoning ?? '',
            });
            request.jobId = result.jobId;
            innerStreamLifecycleStarted = true;
            try {
                const completion = await tracker.completion;
                if (completion.trackingInterrupted) {
                    request.attached.value = false;
                    return;
                }
                await finalizeRequest(request, {
                    outcome:
                        completion.status === 'complete'
                            ? 'completed'
                            : completion.status === 'aborted'
                              ? 'aborted'
                              : 'failed',
                    content: completion.content,
                    reasoning: completion.reasoning_text,
                    toolCalls: completion.tool_calls?.map((call) => ({
                        ...call,
                        status:
                            call.status === 'skipped' ? 'error' : call.status,
                    })),
                    messageError:
                        completion.status === 'complete'
                            ? null
                            : completion.status === 'aborted'
                              ? 'stopped'
                              : (completion.error ??
                                'Background continuation failed'),
                    persistence: 'tracker',
                    attempt: completion.attempt,
                });
            } finally {
                if (ctx.abortController.value === continuationAbortController) {
                    ctx.abortController.value = null;
                }
                setTimeout(() => {
                    if (ownsThread() && !ctx.loading.value && ctx.streamState.finalized) {
                        ctx.resetStream();
                    }
                }, 0);
            }
            return;
        }

        const stream = openRouterStreamWithRetry({
            apiKey: ctx.effectiveApiKey.value,
            model: modelId,
            orMessages: orMessages as Parameters<typeof openRouterStreamWithRetry>[0]['orMessages'],
            modalities,
            threadId: ctx.threadIdRef.value,
            messageId: target.id,
            signal: ctx.abortController.value.signal,
        });

        const continuationNormalizer = createContinuationDeltaNormalizer(
            existingText,
            CONTINUATION_PREFIX
        );

        const writeCoalescer = createStreamWriteCoalescer();

        const flushProgress = async () => {
            if (!writeCoalescer.hasDirty()) return;
            await persistAssistant({
                content: current.text,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? undefined,
            });
            if (assistantFileHashes.length) current.file_hashes = assistantFileHashes;
            writeCoalescer.flushed();
        };

        const appendTextDelta = (delta: string) => {
            if (!delta) return;
            ctx.streamAcc.append(delta, { kind: 'text' });
            current.text += delta;
            writeCoalescer.markDirty(utf8Bytes(delta));
        };

        innerStreamLifecycleStarted = true;
        try {
            for await (const ev of stream) {
                if (!ownsThread()) throw new ContinuationOwnershipLost();
                if (ev.type === 'reasoning') {
                    if (current.reasoning_text === null) current.reasoning_text = ev.text;
                    else current.reasoning_text += ev.text;
                    ctx.streamAcc.append(ev.text, { kind: 'reasoning' });
                    writeCoalescer.markDirty(utf8Bytes(ev.text));
                } else if (ev.type === 'text') {
                    if (current.pending) current.pending = false;
                    appendTextDelta(continuationNormalizer.push(ev.text));
                } else if (ev.type === 'image') {
                    if (current.pending) current.pending = false;
                    // Store image first, then use hash placeholder (not Base64)
                    if (assistantFileHashes.length < 6) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/')) blob = dataUrlToBlob(ev.url);
                        else if (/^https?:/.test(ev.url)) {
                            blob = await fetchImageBlob(ev.url);
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
                                current.file_hashes = assistantFileHashes;
                                writeCoalescer.markDirty(placeholder.length);
                            } catch {
                                /* intentionally empty */
                            }
                        } else {
                            // Fallback: couldn't convert to blob, use URL directly
                            const placeholder = `![generated image](${ev.url})`;
                            const already = current.text.includes(placeholder);
                            if (!already) {
                                current.text += (current.text ? '\n\n' : '') + placeholder;
                                writeCoalescer.markDirty(placeholder.length);
                            }
                        }
                    }
                }

                if (writeCoalescer.shouldFlush()) await flushProgress();
            }

            appendTextDelta(continuationNormalizer.finish());
            await flushProgress();

            const stopped =
                request.cancelled || continuationAbortController.signal.aborted;
            const finalization = await finalizeRequest(request, {
                outcome: stopped ? 'aborted' : 'completed',
                content: current.text,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                messageError: stopped ? 'stopped' : null,
            });
            if (finalization.persistenceError || finalization.effectError)
                reportError(
                    finalization.persistenceError ?? finalization.effectError,
                    {
                        code: 'ERR_DB_WRITE_FAILED',
                        tags: { domain: 'chat', stage: 'continue_finalize' },
                    }
                );
        } catch (streamError) {
            const ownershipLost = streamError instanceof ContinuationOwnershipLost;
            const e = asAppError(streamError, { code: 'ERR_STREAM_FAILURE' });
            const stopped =
                request.cancelled || continuationAbortController.signal.aborted;
            const finalization = await finalizeRequest(request, {
                outcome: stopped ? 'aborted' : 'failed',
                error: stopped ? undefined : e,
                messageError: stopped ? 'stopped' : 'stream_interrupted',
                generationState: stopped ? 'aborted' : 'interrupted',
            });
            if (finalization.persistenceError)
                reportError(finalization.persistenceError, {
                    code: 'ERR_DB_WRITE_FAILED',
                    tags: { domain: 'chat', stage: 'continue_finalize' },
                });
            if (!ownershipLost && !stopped)
                reportError(e, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: originThreadId,
                        streamId: newStreamId,
                        modelId,
                        stage: 'continue',
                    },
                    toast: true,
                });
        } finally {
            if (ctx.abortController.value === continuationAbortController) {
                ctx.abortController.value = null;
            }
            setTimeout(() => {
                if (
                    request.ownsView() &&
                    !ctx.loading.value &&
                    ctx.streamState.finalized
                )
                    ctx.resetStream();
            }, 0);
        }
    } catch (e) {
        const setupError =
            e instanceof Error ? e : new Error(String(e));
        const stopped =
            request.cancelled ||
            continuationAbortController?.signal.aborted === true;
        if (
            stopped &&
            request.stopConfirmation &&
            !(await request.stopConfirmation)
        ) {
            request.attached.value = false;
            return;
        }
        const finalization = await finalizeRequest(request, {
            outcome: stopped ? 'aborted' : 'failed',
            error: stopped ? undefined : setupError,
            messageError: stopped ? 'stopped' : 'stream_interrupted',
            generationState: stopped ? 'aborted' : 'interrupted',
            persistence:
                backgroundAdmissionStarted && stopped ? 'tracker' : 'request',
        });
        if (finalization.persistenceError)
            reportError(
                err(
                    'ERR_DB_WRITE_FAILED',
                    'Failed to finalize the continued assistant message.',
                    { cause: finalization.persistenceError }
                ),
                { silent: true }
            );
        if (!stopped)
            reportError(setupError, {
                code: 'ERR_INTERNAL',
                tags: { domain: 'chat', op: 'continueMessage' },
            });
    } finally {
        // Covers setup failures that happen before the inner stream finally.

        if (ctx.abortController.value === continuationAbortController) {
            ctx.abortController.value = null;
        }
        if (!innerStreamLifecycleStarted && (activeCurrent || targetMarkedPending)) {
            setTimeout(() => {
                if (
                    request.ownsView() &&
                    !ctx.loading.value &&
                    ctx.streamState.finalized
                ) {
                    ctx.resetStream();
                }
            }, 0);
        }
    }
}
