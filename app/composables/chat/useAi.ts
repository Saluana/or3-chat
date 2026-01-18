import { ref } from 'vue';
import { useToast, useAppConfig } from '#imports';
import { nowSec, newId } from '~/db/util';
import { create, tx, upsert, type Message } from '~/db';
import { getDb } from '~/db/client';
import { createOrRefFile } from '~/db/files';
import {
    serializeFileHashes,
    parseFileHashes,
    MAX_MESSAGE_FILE_HASHES,
} from '~/db/files-util';
import {
    parseHashes,
    mergeAssistantFileHashes,
} from '~/utils/files/attachments';
import { getThreadSystemPrompt } from '~/db/threads';
import { messagesByThread } from '~/db/messages';
import { getPrompt } from '~/db/prompts';
import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
    ToolCall,
} from '~/utils/chat/types';
import { ensureUiMessage, recordRawMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import { TRANSPARENT_PIXEL_GIF_DATA_URI } from '~/utils/chat/imagePlaceholders';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import {
    buildParts,
    deriveMessageContent,
    trimOrMessagesImages,
} from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import { openRouterStream } from '../../utils/chat/openrouterStream';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { dataUrlToBlob, inferMimeFromUrl } from '~/utils/chat/files';
import {
    promptJsonToString,
    composeSystemPrompt,
} from '~/utils/chat/prompt-utils';
import { createStreamAccumulator } from '~/composables/chat/useStreamAccumulator';
import { useAiSettings } from '~/composables/chat/useAiSettings';
import { useModelStore } from '~/composables/chat/useModelStore';
import { resolveDefaultModel } from '~/core/auth/models-service';
import { state } from '~/state/global';
// Import paths aligned with tests' vi.mock targets
import { useUserApiKey } from '#imports';
import { useActivePrompt } from '#imports';
import { getDefaultPromptId } from '#imports';
import { useHooks } from '#imports';
import { consumeWorkflowHandlingFlag } from '~/plugins/workflow-slash-commands.client';
// settings/model store are provided elsewhere at runtime; keep dynamic access guards
import type {
    ChatSettings,
    ModelInfo,
    PaneContext,
    ExtendedSendMessageParams,
    ModelInputMessage,
} from '../../../types/chat-internal';
import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { ORMessage } from '~/core/auth/openrouter-build';
import type { ToolCallInfo } from '~/utils/chat/uiMessages';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

type GlobalWithPaneApi = typeof globalThis & {
    __or3MultiPaneApi?: UseMultiPaneApi;
};

type StoredMessage = Message & {
    data?: {
        content?: string;
        reasoning_text?: string | null;
        tool_calls?: ToolCallInfo[] | null;
        [key: string]: unknown;
    } | null;
    content?: string | ContentPart[];
    file_hashes?: string | null;
    reasoning_text?: string | null;
    stream_id?: string | null;
};

type OpenRouterMessage =
    | ORMessage
    | {
          role: 'tool';
          [key: string]: unknown;
      };

// Per-instance streaming tail state

export function useChat(
    msgs: ChatMessage[] = [],
    initialThreadId?: string,
    pendingPromptId?: string
) {
    // Messages and basic state
    const messages = ref<UiChatMessage[]>(msgs.map((m) => ensureUiMessage(m)));
    const rawMessages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const abortController = ref<AbortController | null>(null);
    const aborted = ref(false);
    const { apiKey, setKey } = useUserApiKey();
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    const historyLoadedFor = ref<string | null>(null);
    const cleanupFns: Array<() => void> = [];

    if (import.meta.dev) {
        if (state.value.openrouterKey && apiKey.value) {
            setKey(state.value.openrouterKey);
        }
    }

    const streamAcc = createStreamAccumulator();
    const streamState = streamAcc.state;
    const streamId = ref<string | undefined>(undefined);
    function resetStream() {
        streamAcc.reset();
        streamId.value = undefined;
    }

    async function getSystemPromptContent(): Promise<string | null> {
        if (!threadIdRef.value) return null;
        try {
            const promptId = await getThreadSystemPrompt(threadIdRef.value);
            if (promptId) {
                const prompt = await getPrompt(promptId);
                if (prompt) return promptJsonToString(prompt.content);
            }
        } catch (e) {
            console.warn('Failed to load thread system prompt', e);
        }
        return activePromptContent.value
            ? promptJsonToString(
                  activePromptContent.value as Parameters<
                      typeof promptJsonToString
                  >[0]
              )
            : null;
    }

    // Helpers to reduce duplication and improve clarity/perf
    function getActivePaneContext(): PaneContext | null {
        try {
            const mpApi = (globalThis as GlobalWithPaneApi).__or3MultiPaneApi;
            if (!mpApi?.panes.value) return null;
            const pane = mpApi.panes.value.find(
                (p) => p.mode === 'chat' && p.threadId === threadIdRef.value
            );
            if (!pane) return null;
            const paneIndex = mpApi.panes.value.indexOf(pane);
            return { mpApi, pane, paneIndex };
        } catch {
            return null;
        }
    }

    async function updateMessageRecord(
        id: string,
        patch: Partial<StoredMessage>,
        existing?: StoredMessage | null
    ): Promise<void> {
        const base =
            existing ??
            ((await getDb().messages.get(id)) as StoredMessage | undefined);
        if (!base) return;

        // If error is being updated, also update data.error for reliable sync
        // (data uses v.any() and syncs reliably; top-level error may not)
        let finalPatch = patch;
        if ('error' in patch) {
            const baseData = base.data && typeof base.data === 'object'
                ? (base.data as Record<string, unknown>)
                : {};
            const patchData = patch.data && typeof patch.data === 'object'
                ? (patch.data as Record<string, unknown>)
                : {};
            finalPatch = {
                ...patch,
                data: {
                    ...baseData,
                    ...patchData,
                    error: patch.error, // Sync error to data.error
                },
            };
        }

        await upsert.message({
            ...base,
            ...finalPatch,
            updated_at: finalPatch.updated_at ?? nowSec(),
        });
    }

    function makeAssistantPersister(
        assistantDbMsg: StoredMessage,
        assistantFileHashes: string[]
    ) {
        // Cache last serialized file hashes to avoid recomputing on each write
        let lastSerialized: string | null = assistantDbMsg.file_hashes || null;
        return async function persist({
            content,
            reasoning,
            toolCalls,
            finalize = false, // When true, clears pending flag to trigger sync
        }: {
            content?: string;
            reasoning?: string | null;
            toolCalls?: ToolCallInfo[] | null;
            finalize?: boolean;
        }) {
            const baseData =
                assistantDbMsg.data && typeof assistantDbMsg.data === 'object'
                    ? (assistantDbMsg.data as Record<string, unknown>)
                    : {};
            const serialized = assistantFileHashes.length
                ? serializeFileHashes(assistantFileHashes)
                : lastSerialized;
            if (
                serialized !== lastSerialized ||
                content != null ||
                reasoning != null ||
                toolCalls != null ||
                finalize
            ) {
                const payload: StoredMessage = {
                    ...assistantDbMsg,
                    pending: finalize ? false : assistantDbMsg.pending, // Clear pending on finalize
                    data: {
                        ...baseData,
                        content:
                            content ??
                            (typeof baseData.content === 'string'
                                ? baseData.content
                                : ''),
                        reasoning_text:
                            reasoning ??
                            (typeof baseData.reasoning_text === 'string'
                                ? baseData.reasoning_text
                                : null),
                        ...(toolCalls
                            ? {
                                  tool_calls: toolCalls.map((t) => ({ ...t })),
                              }
                            : {}),
                    },
                    file_hashes: serialized,
                    updated_at: nowSec(),
                };
                await upsert.message(payload);
                lastSerialized = serialized ?? null;
            }
            return lastSerialized;
        };
    }

    function shouldKeepAssistantMessage(m: ChatMessage): boolean {
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
    }

    async function applyWorkflowResultToMessages(
        messageId: string,
        finalOutput: string
    ) {
        if (!messageId || !finalOutput) return;
        let updated = false;

        const rawIdx = rawMessages.value.findIndex((m) => m.id === messageId);
        const existingRaw = rawIdx !== -1 ? rawMessages.value[rawIdx] : null;
        if (existingRaw) {
            const next: ChatMessage = {
                ...existingRaw,
                role: existingRaw.role,
                content: finalOutput,
            };
            rawMessages.value.splice(rawIdx, 1, next);
            updated = true;
        }

        const uiIdx = messages.value.findIndex((m) => m.id === messageId);
        const existingUi = uiIdx !== -1 ? messages.value[uiIdx] : null;
        if (existingUi) {
            const next: UiChatMessage = { ...existingUi, text: finalOutput };
            messages.value.splice(uiIdx, 1, next);
            updated = true;
        }

        if (!updated && threadIdRef.value) {
            try {
                const row = await getDb().messages.get(messageId);
                if (row && row.thread_id === threadIdRef.value) {
                    const data =
                        (row.data as Record<string, unknown> | null) || null;
                    const content =
                        deriveMessageContent({
                            content: (
                                row as {
                                    content?: string | ContentPart[] | null;
                                }
                            ).content,
                            data,
                        }) || finalOutput;
                    const chatMsg: ChatMessage = {
                        role: row.role as ChatMessage['role'],
                        content,
                        id: row.id,
                        stream_id: row.stream_id ?? undefined,
                        file_hashes: row.file_hashes ?? undefined,
                        reasoning_text:
                            data &&
                            typeof data === 'object' &&
                            typeof (data as { reasoning_text?: unknown })
                                .reasoning_text === 'string'
                                ? (data as { reasoning_text: string })
                                      .reasoning_text
                                : null,
                        data: data || null,
                        index:
                            typeof row.index === 'number'
                                ? row.index
                                : typeof row.index === 'string'
                                ? Number(row.index) || null
                                : null,
                        created_at:
                            typeof row.created_at === 'number'
                                ? row.created_at
                                : null,
                    };
                    rawMessages.value.push(chatMsg);
                    messages.value.push(
                        ensureUiMessage({
                            ...chatMsg,
                            data,
                        })
                    );
                }
            } catch {
                /* intentionally empty */
            }
        }
    }

    cleanupFns.push(
        hooks.on(
            'workflow.execution:action:state_update',
            (payload: {
                messageId: string;
                state?: { executionState?: string; finalOutput?: string };
            }) => {
                const state = payload.state || {};
                const executionState = state.executionState;
                const isDone =
                    executionState &&
                    executionState !== 'running' &&
                    executionState !== 'idle';
                const finalOutput =
                    typeof state.finalOutput === 'string'
                        ? state.finalOutput
                        : '';
                if (!isDone || !finalOutput) return;
                void applyWorkflowResultToMessages(
                    payload.messageId,
                    finalOutput
                );
            }
        )
    );

    async function ensureHistorySynced() {
        if (threadIdRef.value && historyLoadedFor.value !== threadIdRef.value) {
            const { ensureThreadHistoryLoaded } = await import(
                '~/utils/chat/history'
            );
            await ensureThreadHistoryLoaded(
                threadIdRef,
                historyLoadedFor,
                rawMessages
            );
            messages.value = rawMessages.value
                .filter((m: ChatMessage) => m.role !== 'tool')
                .map((m) => ensureUiMessage(m));
        }
    }

    const tailAssistant = ref<UiChatMessage | null>(null);
    let lastSuppressedAssistantId: string | null = null;
    function flushTailAssistant() {
        if (!tailAssistant.value) return;
        if (!messages.value.find((m) => m.id === tailAssistant.value!.id)) {
            messages.value.push(tailAssistant.value);
        }
        tailAssistant.value = null;
    }

    async function sendMessage(
        contentOrParams: string | (SendMessageParams & { content: string }),
        maybeParams?: SendMessageParams
    ) {
        let content: string;
        let sendMessagesParams: SendMessageParams;

        if (typeof contentOrParams === 'string') {
            content = contentOrParams;
            sendMessagesParams = maybeParams || {
                files: [],
                model: DEFAULT_AI_MODEL,
                file_hashes: [],
                online: false,
                context_hashes: [],
            };
        } else {
            content = contentOrParams.content;
            sendMessagesParams = contentOrParams;
        }

        if (!apiKey.value) return;

        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        if (
            !outgoing ||
            typeof outgoing !== 'string' ||
            outgoing.trim() === ''
        ) {
            useToast().add({
                title: 'Message blocked',
                description: 'Your message was filtered out.',
                duration: 3000,
            });
            return;
        }

        if (!threadIdRef.value) {
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {
                    /* intentionally empty */
                }
            }
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                const { catalog } = useModelStore();
                let lastSelected: string | null = null;
                const defaultModelMode: 'lastSelected' | 'fixed' =
                    settingsValue?.defaultModelMode === 'fixed'
                        ? 'fixed'
                        : 'lastSelected';
                try {
                    if (typeof window !== 'undefined')
                        lastSelected = localStorage.getItem(
                            'last_selected_model'
                        );
                } catch {
                    /* intentionally empty */
                }
                const chosen = resolveDefaultModel(
                    {
                        defaultModelMode,
                        fixedModelId: settingsValue?.fixedModelId ?? null,
                    },
                    {
                        isAvailable: (id: string) =>
                            catalog.value.some((m: ModelInfo) => m.id === id),
                        lastSelectedModelId: () => lastSelected,
                        recommendedDefault: () => DEFAULT_AI_MODEL,
                    }
                );
                if (!sendMessagesParams.model) {
                    sendMessagesParams.model = chosen.id;
                }
                if (
                    settingsValue?.defaultModelMode === 'fixed' &&
                    chosen.reason !== 'fixed'
                ) {
                    try {
                        useToast().add({
                            title: 'Model fallback in effect',
                            description:
                                'Your fixed model was not used. Falling back to last selected or default.',
                            duration: 3500,
                        });
                    } catch {
                        /* intentionally empty */
                    }
                }
            } catch {
                /* intentionally empty */
            }
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
            threadIdRef.value = newThread.id;
            // Bind thread to active pane immediately (before first user message hook) if multi-pane present.
            try {
                const mpApi = (globalThis as GlobalWithPaneApi)
                    .__or3MultiPaneApi;
                if (mpApi?.panes.value && mpApi.activePaneIndex.value >= 0) {
                    const pane = mpApi.panes.value[mpApi.activePaneIndex.value];
                    if (pane && pane.mode === 'chat' && !pane.threadId) {
                        if (typeof mpApi.setPaneThread === 'function') {
                            try {
                                await mpApi.setPaneThread(
                                    mpApi.activePaneIndex.value,
                                    newThread.id
                                );
                            } catch {
                                pane.threadId = newThread.id;
                            }
                        } else {
                            pane.threadId = newThread.id;
                        }
                    }
                }
            } catch {
                /* intentionally empty */
            }
        } // END create-new-thread block

        if (
            tailAssistant.value &&
            lastSuppressedAssistantId &&
            tailAssistant.value.id === lastSuppressedAssistantId
        ) {
            tailAssistant.value = null;
            lastSuppressedAssistantId = null;
        } else {
            flushTailAssistant();
            lastSuppressedAssistantId = null; // clear in normal path too
        }

        const prevAssistantRaw = [...rawMessages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        const prevAssistant = prevAssistantRaw
            ? messages.value.find((m) => m.id === prevAssistantRaw.id)
            : null;
        const assistantHashes = prevAssistantRaw?.file_hashes
            ? parseHashes(prevAssistantRaw.file_hashes)
            : [];

        streamAcc.reset();
        let { files, model, file_hashes } = sendMessagesParams;
        const { extraTextParts, online, context_hashes } = sendMessagesParams;
        const extendedParams = sendMessagesParams as ExtendedSendMessageParams;
        if (
            (!files || files.length === 0) &&
            Array.isArray(extendedParams.images)
        ) {
            files = extendedParams.images
                .map((img) => {
                    const url = typeof img === 'string' ? img : img.url;
                    if (!url) return null;
                    const provided =
                        typeof img === 'object' ? img.type : undefined;
                    const type =
                        inferMimeFromUrl(url, provided) ||
                        provided ||
                        'application/octet-stream';
                    return { type, url };
                })
                .filter(
                    (
                        f
                    ): f is {
                        type: string;
                        url: string;
                    } => Boolean(f && f.url && f.type)
                );
        }
        if (!model) model = DEFAULT_AI_MODEL;
        if (online === true) model = model + ':online';

        file_hashes = mergeAssistantFileHashes(assistantHashes, file_hashes);

        // Helper: convert a Blob to a data URL (used only for API preparation)
        const blobToDataUrl = (blob: Blob): Promise<string> =>
            new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onerror = () =>
                    reject(fr.error ?? new Error('FileReader error'));
                fr.onload = () => resolve(fr.result as string);
                fr.readAsDataURL(blob);
            });

        // UI path: verify blob exists, return hash reference without Base64 conversion
        // This keeps UI state lean - Base64 conversion happens just-in-time for API
        const normalizeFileUrl = async (f: { type: string; url: string }) => {
            if (typeof FileReader === 'undefined') return f; // SSR safeguard
            const mime = f.type || '';
            // Only process images; leave other files (e.g., PDFs) untouched for now.
            if (!mime.startsWith('image/')) return f;
            let url = f.url || '';
            // Already a data URL - pass through (for pasted images not yet stored)
            if (url.startsWith('data:image/')) return { ...f, url };
            try {
                // Local hash -> verify blob exists, return hash reference
                if (!/^https?:|^data:|^blob:/i.test(url)) {
                    const { getFileBlob } = await import('~/db/files');
                    const blob = await getFileBlob(url);
                    if (blob) {
                        // Return hash reference - verified blob exists
                        // UI will use createObjectURL when needed, API will convert later
                        return { ...f, url, _verified: true };
                    }
                }
                // blob: object URL - pass through (already efficient)
                if (url.startsWith('blob:')) {
                    return { ...f, url, _verified: true };
                }
            } catch {
                // fall through to original url
            }
            return { ...f, url };
        };

        // API path: convert hash references and blob URLs to Base64 for model input
        // This is called just-in-time before buildOpenRouterMessages
        const prepareFilesForModel = async (
            files: Array<{ type: string; url: string }>
        ): Promise<ContentPart[]> => {
            const parts: ContentPart[] = [];
            for (const f of files) {
                if (!f.url) continue;
                const mime = f.type || '';

                try {
                    // Hash reference -> load from IndexedDB and convert to Base64
                    if (!/^https?:|^data:|^blob:/i.test(f.url)) {
                        const { getFileMeta, getFileBlob } = await import(
                            '~/db/files'
                        );
                        const blob = await getFileBlob(f.url);
                        if (!blob) continue;

                        const dataUrl = await blobToDataUrl(blob);
                        if (mime.startsWith('image/')) {
                            parts.push({
                                type: 'image',
                                image: dataUrl,
                                mediaType: mime,
                            });
                        } else if (mime === 'application/pdf') {
                            const meta = await getFileMeta(f.url).catch(
                                () => null
                            );
                            parts.push({
                                type: 'file',
                                data: dataUrl,
                                mediaType: mime,
                                name: meta?.name || 'document.pdf',
                            });
                        }
                        continue;
                    }

                    // blob: URL -> fetch and convert to Base64
                    if (f.url.startsWith('blob:')) {
                        try {
                            const blob = await $fetch<Blob>(f.url, {
                                responseType: 'blob',
                            });
                            const dataUrl = await blobToDataUrl(blob);
                            if (mime.startsWith('image/')) {
                                parts.push({
                                    type: 'image',
                                    image: dataUrl,
                                    mediaType: mime,
                                });
                            }
                        } catch {
                            // ignore fetch error
                        }
                        continue;
                    }

                    // Already Base64 data URL -> use directly
                    if (f.url.startsWith('data:')) {
                        if (mime.startsWith('image/')) {
                            parts.push({
                                type: 'image',
                                image: f.url,
                                mediaType: mime,
                            });
                        }
                    }
                } catch {
                    // Skip files that fail to convert
                }
            }
            return parts;
        };

        // Convert hash to ContentPart for context injection (just-in-time for API)
        const hashToContentPart = async (
            hash: string
        ): Promise<ContentPart | null> => {
            try {
                const { getFileMeta, getFileBlob } = await import('~/db/files');
                const meta = await getFileMeta(hash).catch(() => null);
                const blob = await getFileBlob(hash);
                if (!blob) return null;
                // Only include images/PDFs to avoid bloating text-only contexts
                const mime = meta?.mime_type || blob.type || '';
                if (mime === 'application/pdf') {
                    const dataUrl = await blobToDataUrl(blob);
                    return {
                        type: 'file',
                        data: dataUrl,
                        mediaType: mime,
                        name: meta?.name || 'document.pdf',
                    };
                }
                if (!mime.startsWith('image/')) return null;
                const dataUrl = await blobToDataUrl(blob);
                return {
                    type: 'image',
                    image: dataUrl,
                    mediaType: mime,
                };
            } catch {
                return null;
            }
        };

        // Verify files exist (no Base64 conversion - that happens in buildOpenRouterMessages)
        const hydratedFiles = await Promise.all(
            Array.isArray(files) ? files.map(normalizeFileUrl) : []
        );

        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes: file_hashes.length
                ? serializeFileHashes(file_hashes)
                : undefined,
        });
        const parts: ContentPart[] = buildParts(
            outgoing,
            hydratedFiles,
            extraTextParts
        );
        const rawUser: ChatMessage = {
            role: 'user',
            content: parts,
            id: userDbMsg.id,
            file_hashes: userDbMsg.file_hashes,
        };
        recordRawMessage(rawUser);
        rawMessages.value.push(rawUser);
        messages.value.push(ensureUiMessage(rawUser));

        try {
            const ctx = getActivePaneContext();
            if (ctx) {
                void hooks.doAction('ui.pane.msg:action:sent', {
                    pane: ctx.pane,
                    paneIndex: ctx.paneIndex,
                    message: {
                        id: userDbMsg.id,
                        threadId: threadIdRef.value,
                        length: outgoing.length,
                        fileHashes: userDbMsg.file_hashes || null,
                    },
                });
            }
        } catch (e) {
            if (import.meta.dev) {
                console.warn('[useChat] pane hook failed', e);
            }
        }

        loading.value = true;
        streamId.value = undefined;

        let currentModelId: string | undefined;
        try {
            const startedAt = Date.now();
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );
            currentModelId = modelId;

            const messagesWithSystemRaw = [...rawMessages.value];
            const threadSystemText = await getSystemPromptContent();
            let finalSystem: string | null = null;
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                const master = settingsValue?.masterSystemPrompt ?? '';
                finalSystem = composeSystemPrompt(
                    master,
                    threadSystemText || null
                );
            } catch {
                finalSystem = (threadSystemText || '').trim() || null;
            }
            if (finalSystem && finalSystem.trim()) {
                messagesWithSystemRaw.unshift({
                    role: 'system',
                    content: finalSystem,
                    id: `system-${newId()}`,
                });
            }

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messagesWithSystemRaw
            );

            // Remove prior empty assistant placeholder messages
            const sanitizedEffectiveMessages = (
                Array.isArray(effectiveMessages) ? effectiveMessages : []
            ).filter(shouldKeepAssistantMessage);

            const isModelMessage = (
                m: ChatMessage
            ): m is ChatMessage & { role: 'user' | 'assistant' | 'system' } =>
                m.role !== 'tool';

            const { buildOpenRouterMessages } = await import(
                '~/core/auth/openrouter-build'
            );

            // Load thread history if not already loaded
            await ensureHistorySynced();

            const modelInputMessages: ModelInputMessage[] =
                sanitizedEffectiveMessages.filter(isModelMessage).map(
                    (m): ModelInputMessage => ({
                        role: m.role,
                        content: m.content,
                        id: m.id,
                        file_hashes: m.file_hashes,
                        name: m.name,
                        tool_call_id: m.tool_call_id,
                    })
                );
            if (assistantHashes.length && prevAssistant?.id) {
                const target = modelInputMessages.find(
                    (m) => m.id === prevAssistant.id
                );
                if (target) target.file_hashes = null;
            }
            const contextHashesList = Array.isArray(context_hashes)
                ? context_hashes.slice(0, MAX_MESSAGE_FILE_HASHES)
                : [];
            if (contextHashesList.length) {
                const seenContext = new Set<string>(
                    Array.isArray(file_hashes) ? file_hashes : []
                );
                const contextParts: ContentPart[] = [];
                for (const h of contextHashesList) {
                    if (!h || seenContext.has(h)) continue;
                    if (contextParts.length >= MAX_MESSAGE_FILE_HASHES) break;
                    const part = await hashToContentPart(h);
                    if (part) {
                        contextParts.push(part);
                        seenContext.add(h);
                    }
                }
                if (contextParts.length) {
                    const lastUserIdx = [...modelInputMessages]
                        .map((m, idx: number) => (m.role === 'user' ? idx : -1))
                        .filter((idx) => idx >= 0)
                        .pop();
                    if (lastUserIdx != null && lastUserIdx >= 0) {
                        const target = modelInputMessages[lastUserIdx];
                        if (target) {
                            if (!Array.isArray(target.content)) {
                                if (typeof target.content === 'string') {
                                    target.content = [
                                        { type: 'text', text: target.content },
                                    ];
                                } else {
                                    target.content = [];
                                }
                            }
                            target.content.push(...contextParts);
                        }
                    }
                }
            }
            let orMessages: OpenRouterMessage[] = await buildOpenRouterMessages(
                modelInputMessages,
                {
                    maxImageInputs: 16,
                    imageInclusionPolicy: 'all',
                    debug: false,
                }
            );
            trimOrMessagesImages(
                orMessages as Parameters<typeof trimOrMessagesImages>[0],
                5
            );
            if (orMessages.length === 0) return;

            const hasImageInput = modelInputMessages.some((m) =>
                Array.isArray(m.content)
                    ? m.content.some((p) => {
                          const part = p as {
                              type?: string;
                              mediaType?: string;
                          };
                          if (
                              part.type === 'image' ||
                              part.type === 'image_url'
                          )
                              return true;
                          if (part.mediaType)
                              return /image\//.test(part.mediaType);
                          return false;
                      })
                    : false
            );
            const modelImageHint = /image|vision|flash/i.test(modelId);
            const modalities =
                hasImageInput || modelImageHint ? ['image', 'text'] : ['text'];

            const newStreamId = newId();
            streamId.value = newStreamId;
            const assistantDbMsg = (await tx.appendMessage({
                thread_id: threadIdRef.value,
                role: 'assistant',
                stream_id: newStreamId,
                pending: true, // Mark as streaming - HookBridge will skip sync until finalized
                data: { content: '', attachments: [], reasoning_text: null },
            })) as StoredMessage;
            // Track file hashes across loop iterations
            const assistantFileHashes: string[] = [];
            const persistAssistant = makeAssistantPersister(
                assistantDbMsg,
                assistantFileHashes
            );

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? effectiveMessages.length
                    : undefined,
            });

            const toolRegistry = useToolRegistry();
            const enabledToolDefs = toolRegistry.getEnabledDefinitions();

            // Track tool calls across all loop iterations (persists state)
            const activeToolCalls = new Map<string, ToolCallInfo>();

            aborted.value = false;
            abortController.value = new AbortController();

            let continueLoop = true;
            let loopIteration = 0;
            const MAX_TOOL_ITERATIONS = 10; // Prevent infinite loops

            const filteredMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:before_send',
                { messages: orMessages }
            );

            if (
                typeof filteredMessages === 'object' &&
                'messages' in filteredMessages
            ) {
                const candidate = (
                    filteredMessages as {
                        messages?: OpenRouterMessage[];
                    }
                ).messages;
                if (Array.isArray(candidate)) {
                    orMessages = candidate;
                }
            }

            // Check if a workflow is handling this request - skip AI call
            if (consumeWorkflowHandlingFlag()) {
                if (import.meta.dev) {
                    console.log(
                        '[useAi] Workflow is handling request, skipping AI call'
                    );
                }
                // Seed UI with assistant placeholder so workflow state can render immediately
                const workflowAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };
                recordRawMessage(workflowAssistant);
                rawMessages.value.push(workflowAssistant);
                const uiAssistant = ensureUiMessage(workflowAssistant);
                uiAssistant.pending = true;
                messages.value.push(uiAssistant);
                loading.value = false;
                abortController.value = null;
                return;
            }

            // Also skip if messages array is empty (e.g., workflow returned empty)
            if (orMessages.length === 0) {
                if (import.meta.dev) {
                    console.log(
                        '[useAi] No messages to send, skipping AI call'
                    );
                }
                loading.value = false;
                return;
            }

            while (continueLoop && loopIteration < MAX_TOOL_ITERATIONS) {
                continueLoop = false;
                loopIteration++;

                const stream = openRouterStream({
                    apiKey: apiKey.value,
                    model: modelId,
                    orMessages: orMessages as Parameters<
                        typeof openRouterStream
                    >[0]['orMessages'],
                    modalities,
                    tools:
                        enabledToolDefs.length > 0
                            ? enabledToolDefs
                            : undefined,
                    signal: abortController.value.signal,
                });

                const rawAssistant: ChatMessage = {
                    role: 'assistant',
                    content: '',
                    id: assistantDbMsg.id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                };

                if (loopIteration === 1) {
                    recordRawMessage(rawAssistant);
                    rawMessages.value.push(rawAssistant);
                    const uiAssistant = ensureUiMessage(rawAssistant);
                    uiAssistant.pending = true;
                    tailAssistant.value = uiAssistant;
                }

                const current =
                    tailAssistant.value || ensureUiMessage(rawAssistant);
                let chunkIndex = 0;
                const WRITE_INTERVAL_MS = 500;
                let lastPersistAt = 0;
                const pendingToolCalls: ToolCall[] = [];

                try {
                    for await (const ev of stream) {
                        if (ev.type === 'tool_call') {
                            // Tool call detected - enqueue for execution after stream closes
                            if (current.pending) current.pending = false;

                            const toolCall = ev.tool_call;

                            // Add tool call to tracking with loading status
                            activeToolCalls.set(toolCall.id, {
                                id: toolCall.id,
                                name: toolCall.function.name,
                                status: 'loading',
                                args: toolCall.function.arguments,
                            });

                            // Update UI with loading state
                            current.toolCalls = Array.from(
                                activeToolCalls.values()
                            );

                            // Persist current assistant state (function call request)
                            await persistAssistant({
                                content: current.text,
                                reasoning: current.reasoning_text ?? null,
                                toolCalls: current.toolCalls ?? undefined,
                            });

                            pendingToolCalls.push(toolCall);
                            continue;
                        } else if (ev.type === 'reasoning') {
                            if (current.reasoning_text === null)
                                current.reasoning_text = ev.text;
                            else current.reasoning_text += ev.text;
                            streamAcc.append(ev.text, { kind: 'reasoning' });
                            try {
                                await hooks.doAction(
                                    'ai.chat.stream:action:reasoning',
                                    ev.text,
                                    {
                                        threadId: threadIdRef.value,
                                        assistantId: assistantDbMsg.id,
                                        streamId: newStreamId,
                                        reasoningLength:
                                            current.reasoning_text?.length || 0,
                                    }
                                );
                            } catch {
                                /* intentionally empty */
                            }
                        } else if (ev.type === 'text') {
                            if (current.pending) current.pending = false;
                            const delta = ev.text;
                            streamAcc.append(delta, { kind: 'text' });
                            await hooks.doAction(
                                'ai.chat.stream:action:delta',
                                delta,
                                {
                                    threadId: threadIdRef.value,
                                    assistantId: assistantDbMsg.id,
                                    streamId: newStreamId,
                                    deltaLength: delta.length,
                                    totalLength:
                                        current.text.length + delta.length,
                                    chunkIndex: chunkIndex++,
                                }
                            );
                            current.text += delta;
                        } else if (ev.type === 'image') {
                            if (current.pending) current.pending = false;
                            // Store image first, then use hash placeholder (not Base64)
                            if (assistantFileHashes.length < 6) {
                                let blob: Blob | null = null;
                                if (ev.url.startsWith('data:image/'))
                                    blob = dataUrlToBlob(ev.url);
                                else if (/^https?:/.test(ev.url)) {
                                    try {
                                        // Use $fetch with responseType: 'blob'
                                        blob = await $fetch<Blob>(ev.url, {
                                            responseType: 'blob',
                                        });
                                    } catch {
                                        /* intentionally empty */
                                    }
                                }
                                if (blob) {
                                    try {
                                        const meta = await createOrRefFile(
                                            blob,
                                            'gen-image'
                                        );
                                        assistantFileHashes.push(meta.hash);
                                        // Use valid 1x1 transparent pixel and store hash in alt text to eliminate console errors
                                        const placeholder = `![file-hash:${meta.hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`;
                                        const already =
                                            current.text.includes(placeholder);
                                        if (!already) {
                                            current.text +=
                                                (current.text ? '\n\n' : '') +
                                                placeholder;
                                        }
                                        const serialized =
                                            await persistAssistant({
                                                content: current.text,
                                                reasoning:
                                                    current.reasoning_text ??
                                                    null,
                                            });
                                        current.file_hashes =
                                            serialized?.split(',') ?? [];
                                    } catch {
                                        /* intentionally empty */
                                    }
                                } else {
                                    // Fallback: couldn't convert to blob, use URL directly
                                    const placeholder = `![generated image](${ev.url})`;
                                    const already =
                                        current.text.includes(placeholder);
                                    if (!already) {
                                        current.text +=
                                            (current.text ? '\n\n' : '') +
                                            placeholder;
                                    }
                                }
                            }
                        }

                        // Batch writes: persist every 500ms OR every 50 chunks (whichever comes first)
                        // to reduce DB pressure while maintaining progress safety
                        const now = Date.now();
                        const shouldPersist =
                            now - lastPersistAt >= WRITE_INTERVAL_MS ||
                            chunkIndex % 50 === 0;
                        if (shouldPersist) {
                            await persistAssistant({
                                content: current.text,
                                reasoning: current.reasoning_text ?? null,
                            });
                            if (assistantFileHashes.length) {
                                current.file_hashes = assistantFileHashes;
                            }
                            lastPersistAt = now;
                        }
                    }

                    if (pendingToolCalls.length > 0) {
                        const toolResultsForNextLoop: Array<{
                            call: ToolCall;
                            result: string;
                        }> = [];

                        for (const toolCall of pendingToolCalls) {
                            const execution = await toolRegistry.executeTool(
                                toolCall.function.name,
                                toolCall.function.arguments
                            );

                            let toolResultText: string;
                            let toolStatus: 'complete' | 'error' = 'complete';
                            if (execution.error) {
                                toolStatus = 'error';
                                toolResultText = `Error executing tool "${toolCall.function.name}": ${execution.error}`;
                                console.warn('[useChat] tool execution error', {
                                    tool: toolCall.function.name,
                                    error: execution.error,
                                    timedOut: execution.timedOut,
                                });
                            } else {
                                toolResultText = execution.result || '';
                            }

                            activeToolCalls.set(toolCall.id, {
                                id: toolCall.id,
                                name: toolCall.function.name,
                                status: toolStatus,
                                args: toolCall.function.arguments,
                                result:
                                    toolStatus === 'complete'
                                        ? toolResultText
                                        : undefined,
                                error:
                                    toolStatus === 'error'
                                        ? execution.error
                                        : undefined,
                            });
                            current.toolCalls = Array.from(
                                activeToolCalls.values()
                            );

                            const SUMMARY_THRESHOLD = 500;
                            let uiSummary = toolResultText;
                            if (toolResultText.length > SUMMARY_THRESHOLD) {
                                uiSummary = `Tool result (${Math.round(
                                    toolResultText.length / 1024
                                )}KB): ${toolResultText.slice(
                                    0,
                                    200
                                )}... [truncated for display]`;
                            }

                            await tx.appendMessage({
                                thread_id: threadIdRef.value,
                                role: 'tool',
                                data: {
                                    content: uiSummary,
                                    tool_call_id: toolCall.id,
                                    tool_name: toolCall.function.name,
                                },
                            });

                            toolResultsForNextLoop.push({
                                call: toolCall,
                                result: toolResultText,
                            });
                        }

                        orMessages.push({
                            role: 'assistant',
                            content: [
                                { type: 'text', text: current.text || '' },
                            ],
                            tool_calls: pendingToolCalls.map((toolCall) => ({
                                id: toolCall.id,
                                type: 'function' as const,
                                function: {
                                    name: toolCall.function.name,
                                    arguments: toolCall.function.arguments,
                                },
                            })),
                        });

                        for (const payload of toolResultsForNextLoop) {
                            orMessages.push({
                                role: 'tool',
                                tool_call_id: payload.call.id,
                                name: payload.call.function.name,
                                content: [
                                    { type: 'text', text: payload.result },
                                ],
                            });
                        }

                        pendingToolCalls.length = 0;
                        continueLoop = true;
                        continue;
                    }
                } catch (streamError) {
                    if (loopIteration > 1) {
                        console.warn(
                            '[useChat] Stream error during tool loop',
                            streamError
                        );
                        continueLoop = false;
                    }
                    throw streamError;
                }
            }

            const current = tailAssistant.value!;
            const fullText = current.text;
            const hookName = 'ui.chat.message:filter:incoming';
            const errorsBefore = hooks._diagnostics.errors[hookName] ?? 0;
            const incoming = await hooks.applyFilters(
                hookName,
                fullText,
                threadIdRef.value
            );
            const errorsAfter = hooks._diagnostics.errors[hookName] ?? 0;
            if (errorsAfter > errorsBefore) {
                throw new Error('Incoming filter threw an exception');
            }
            if (current.pending) current.pending = false;
            current.text = incoming;
            await persistAssistant({
                content: incoming,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
                finalize: true, // Clear pending flag to trigger sync
            });
            const finalized: StoredMessage = {
                ...assistantDbMsg,
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : assistantDbMsg.file_hashes,
            };
            await hooks.doAction('ai.chat.stream:action:complete', {
                threadId: threadIdRef.value,
                assistantId: assistantDbMsg.id,
                streamId: newStreamId,
                totalLength: incoming.length,
                reasoningLength: (current.reasoning_text || '').length,
                fileHashes: finalized.file_hashes || null,
            });
            try {
                const ctx = getActivePaneContext();
                if (ctx) {
                    void hooks.doAction('ui.pane.msg:action:received', {
                        pane: ctx.pane,
                        paneIndex: ctx.paneIndex,
                        message: {
                            id: finalized.id,
                            threadId: threadIdRef.value,
                            length: incoming.length,
                            fileHashes: finalized.file_hashes || null,
                            reasoningLength: (current.reasoning_text || '')
                                .length,
                        },
                    });
                }
            } catch {
                /* intentionally empty */
            }
            const endedAt = Date.now();
            await hooks.doAction('ai.chat.send:action:after', {
                threadId: threadIdRef.value,
                request: { modelId, userId: userDbMsg.id },
                response: {
                    assistantId: assistantDbMsg.id,
                    length: incoming.length,
                },
                timings: {
                    startedAt,
                    endedAt,
                    durationMs: endedAt - startedAt,
                },
                aborted: false,
            });
            streamAcc.finalize();
        } catch (err) {
            if (aborted.value) {
                if (tailAssistant.value?.pending)
                    tailAssistant.value.pending = false;
                try {
                    await hooks.doAction('ai.chat.send:action:after', {
                        threadId: threadIdRef.value,
                        aborted: true,
                    });
                } catch (e) {
                    if (import.meta.dev) {
                        console.warn('[useChat] abort hook failed', e);
                    }
                }
                // Only delete if there's no text; otherwise preserve with 'stopped' status
                if (tailAssistant.value?.id && !tailAssistant.value.text) {
                    try {
                        await getDb().messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch (e) {
                        if (import.meta.dev) {
                            console.warn(
                                '[useChat] failed to delete empty assistant',
                                e
                            );
                        }
                    }
                    tailAssistant.value = null;
                } else if (
                    tailAssistant.value?.id &&
                    tailAssistant.value.text
                ) {
                    // Preserve partial message with 'stopped' status for continue functionality
                    tailAssistant.value.pending = false;
                    tailAssistant.value.error = 'stopped';

                    // Add to messages array if not already there (flush before nulling)
                    if (
                        !messages.value.find(
                            (m) => m.id === tailAssistant.value!.id
                        )
                    ) {
                        messages.value.push(tailAssistant.value);
                    } else {
                        // Update existing message in array
                        const msgIdx = messages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (msgIdx >= 0) {
                            messages.value[msgIdx] = { ...tailAssistant.value };
                        }
                    }

                    const rawIdx = rawMessages.value.findIndex(
                        (m) => m.id === tailAssistant.value!.id
                    );
                    if (rawIdx >= 0) {
                        const existingRaw = rawMessages.value[rawIdx];
                        if (existingRaw) {
                            rawMessages.value[rawIdx] = {
                                ...existingRaw,
                                content: tailAssistant.value.text,
                                error: 'stopped',
                            };
                        }
                    }
                    try {
                        const existing = (await getDb().messages.get(
                            tailAssistant.value.id
                        )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            tailAssistant.value.id,
                            {
                                pending: false, // Clear pending so sync captures this
                                data: {
                                    ...baseData,
                                    content: tailAssistant.value.text,
                                    reasoning_text:
                                        tailAssistant.value.reasoning_text ??
                                        null,
                                    error: 'stopped', // Store in data for reliable sync
                                },
                                error: 'stopped', // Also at top-level for local reads
                            },
                            existing
                        );
                    } catch {
                        /* intentionally empty */
                    }
                    tailAssistant.value = null;
                }
            } else {
                const lastUser = [...messages.value]
                    .reverse()
                    .find((m) => m.role === 'user');
                const retryFn = lastUser
                    ? () => {
                          void retryMessage(lastUser.id);
                      }
                    : undefined;
                // Inline tag object (Req 18.1) for clarity & tree-shaking
                reportError(err, {
                    code: 'ERR_STREAM_FAILURE',
                    tags: {
                        domain: 'chat',
                        threadId: threadIdRef.value || '',
                        streamId: streamId.value || '',
                        modelId: currentModelId || '',
                        stage: 'stream',
                    },
                    retry: retryFn,
                    toast: true,
                    retryable: !!retryFn,
                });
                const e = err instanceof Error ? err : new Error(String(err));
                streamAcc.finalize({ error: e });
                await hooks.doAction('ai.chat.stream:action:error', {
                    threadId: threadIdRef.value,
                    streamId: streamId.value,
                    error: e,
                    aborted: false,
                });
                if (!tailAssistant.value?.text && tailAssistant.value?.id) {
                    try {
                        await getDb().messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch {
                        /* intentionally empty */
                    }
                    tailAssistant.value = null;
                } else if (
                    tailAssistant.value?.id &&
                    tailAssistant.value.text
                ) {
                    tailAssistant.value.pending = false;
                    tailAssistant.value.error = 'stream_interrupted';
                    const rawIdx = rawMessages.value.findIndex(
                        (m) => m.id === tailAssistant.value!.id
                    );
                    if (rawIdx >= 0) {
                        const existingRaw = rawMessages.value[rawIdx];
                        if (existingRaw) {
                            rawMessages.value[rawIdx] = {
                                ...existingRaw,
                                error: 'stream_interrupted',
                            };
                        }
                    }
                    try {
                        const existing = (await getDb().messages.get(
                            tailAssistant.value.id
                        )) as StoredMessage | undefined;
                        const baseData =
                            existing?.data && typeof existing.data === 'object'
                                ? (existing.data as Record<string, unknown>)
                                : {};
                        await updateMessageRecord(
                            tailAssistant.value.id,
                            {
                                pending: false, // Clear pending so sync captures this
                                data: {
                                    ...baseData,
                                    content: tailAssistant.value.text,
                                    reasoning_text:
                                        tailAssistant.value.reasoning_text ??
                                        null,
                                    error: 'stream_interrupted', // Store in data for reliable sync
                                },
                                error: 'stream_interrupted', // Also at top-level for local reads
                            },
                            existing
                        );
                    } catch {
                        /* intentionally empty */
                    }
                } else if (tailAssistant.value?.pending) {
                    tailAssistant.value.pending = false;
                }
            }
        } finally {
            loading.value = false;
            // CRITICAL: Ensure abort controller is cleaned up to prevent memory leak
            if (abortController.value) {
                abortController.value = null;
            }
            setTimeout(() => {
                if (!loading.value && streamState.finalized) resetStream();
            }, 0);
        }
    }

    // END sendMessage

    async function retryMessage(messageId: string, modelOverride?: string) {
        if (loading.value || !threadIdRef.value) return;
        try {
            const target = await getDb().messages.get(messageId);
            if (!target || target.thread_id !== threadIdRef.value) return;
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
                        (typeof userMsg.index === 'number'
                            ? userMsg.index
                            : 0) + 1,
                    ],
                    [userMsg.thread_id, DexieMod2.maxKey]
                )
                .filter((m: Message) => m.role === 'assistant' && !m.deleted)
                .first();

            // Suppress flushing of the previous tail assistant if it corresponds to the
            // assistant we are removing for retry. We cannot rely solely on clearing the ref
            // because sendMessage() calls flushTailAssistant() unconditionally; instead we
            // record the id and skip a single flush on next send.
            if (assistant && tailAssistant.value?.id === assistant.id) {
                lastSuppressedAssistantId = assistant.id;
                tailAssistant.value = null;
            } else if (
                target.role === 'assistant' &&
                tailAssistant.value?.id === target.id
            ) {
                lastSuppressedAssistantId = target.id;
                tailAssistant.value = null;
            }

            await hooks.doAction('ai.chat.retry:action:before', {
                threadId: threadIdRef.value,
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

            // CRITICAL: Before deleting, ensure in-memory state matches DB state
            // This handles edge cases where messages exist in DB but not in memory
            const dbMessages =
                ((await messagesByThread(threadIdRef.value)) as
                    | StoredMessage[]
                    | undefined) || [];

            // If DB has more messages than our in-memory arrays, we need to sync first
            if (dbMessages.length > rawMessages.value.length) {
                console.warn('[retry] Syncing messages from DB before retry', {
                    dbCount: dbMessages.length,
                    memoryCount: rawMessages.value.length,
                });
                const toReasoning = (m: StoredMessage) => {
                    if (
                        m.data &&
                        typeof m.data === 'object' &&
                        'reasoning_text' in m.data &&
                        typeof (m.data as { reasoning_text?: unknown })
                            .reasoning_text === 'string'
                    ) {
                        return (m.data as { reasoning_text: string })
                            .reasoning_text;
                    }
                    return typeof m.reasoning_text === 'string'
                        ? m.reasoning_text
                        : null;
                };
                const toContent = (m: StoredMessage) =>
                    deriveMessageContent({
                        content: m.content,
                        data: m.data,
                    });
                rawMessages.value = dbMessages.map(
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
                        created_at:
                            typeof m.created_at === 'number'
                                ? m.created_at
                                : null,
                    })
                );
                const uiMessages = dbMessages.filter((m: StoredMessage) => m.role !== 'tool');
                messages.value = uiMessages.map((m) =>
                    ensureUiMessage({
                        role: m.role as
                            | 'user'
                            | 'assistant'
                            | 'system'
                            | 'tool',
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
                        created_at:
                            typeof m.created_at === 'number'
                                ? m.created_at
                                : null,
                    })
                );
            }

            // Delete from database
            await getDb().transaction('rw', getDb().messages, async () => {
                await getDb().messages.delete(userMsg.id);
                if (assistant) await getDb().messages.delete(assistant.id);
            });

            // Remove deleted messages from in-memory arrays
            rawMessages.value = rawMessages.value.filter(
                (m) => m.id !== userMsg.id && m.id !== assistant?.id
            );
            messages.value = messages.value.filter(
                (m) => m.id !== userMsg.id && m.id !== assistant?.id
            );

            let textToSend = '';
            if (typeof originalText === 'string') {
                textToSend = originalText;
            } else if (Array.isArray(originalText)) {
                textToSend = originalText
                    .filter((p) => p.type === 'text')
                    .map((p) => (p as { text: string }).text)
                    .join('');
            }

            await sendMessage(textToSend, {
                model: modelOverride || DEFAULT_AI_MODEL,
                file_hashes: hashes,
                files: [],
                online: false,
            });
            const tail = messages.value.slice(-2);
            const newUser = tail.find((m) => m.role === 'user');
            const newAssistant = tail.find((m) => m.role === 'assistant');
            await hooks.doAction('ai.chat.retry:action:after', {
                threadId: threadIdRef.value,
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

    async function continueMessage(messageId: string, modelOverride?: string) {
        if (loading.value || !threadIdRef.value) return;
        if (!apiKey.value) return;
        try {
            const target = (await getDb().messages.get(messageId)) as
                | StoredMessage
                | undefined;
            if (
                !target ||
                target.thread_id !== threadIdRef.value ||
                target.role !== 'assistant'
            )
                return;

            const inMemoryText =
                tailAssistant.value?.id === target.id
                    ? tailAssistant.value.text
                    : '';
            const existingText =
                inMemoryText ||
                deriveMessageContent({
                    content: (
                        target as {
                            content?: string | ContentPart[] | null;
                        }
                    ).content,
                    data: target.data,
                });
            if (!existingText) return;

            const DexieMod = (await import('dexie')).default;
            const all = await getDb().messages
                .where('[thread_id+index]')
                .between(
                    [threadIdRef.value, DexieMod.minKey],
                    [threadIdRef.value, target.index]
                )
                .filter((m: Message) => !m.deleted)
                .toArray();
            all.sort((a: Message, b: Message) => (a.index || 0) - (b.index || 0));

            const toReasoning = (m: StoredMessage) => {
                if (
                    m.data &&
                    typeof m.data === 'object' &&
                    'reasoning_text' in m.data &&
                    typeof (m.data as { reasoning_text?: unknown })
                        .reasoning_text === 'string'
                ) {
                    return (m.data as { reasoning_text: string })
                        .reasoning_text;
                }
                return typeof m.reasoning_text === 'string'
                    ? m.reasoning_text
                    : null;
            };
            const toContent = (m: StoredMessage) => {
                if (m.id === target.id) return existingText;
                return deriveMessageContent({
                    content: (
                        m as {
                            content?: string | ContentPart[] | null;
                        }
                    ).content,
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
                    data &&
                    typeof (data as { tool_name?: unknown }).tool_name ===
                        'string'
                        ? ((data as { tool_name: string }).tool_name as string)
                        : undefined;
                const toolCallId =
                    data &&
                    typeof (data as { tool_call_id?: unknown }).tool_call_id ===
                        'string'
                        ? ((data as { tool_call_id: string })
                              .tool_call_id as string)
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
                    created_at:
                        typeof m.created_at === 'number' ? m.created_at : null,
                };
            });

            const CONTINUE_TAIL_CHARS = 1200;
            const tailSnippet = existingText.slice(-CONTINUE_TAIL_CHARS);
            const continuationText = tailSnippet
                ? [
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
                  ].join('\n')
                : 'Please continue your previous response from where you left off.';
            baseMessages.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: continuationText,
                    },
                ],
                id: `continue-${newId()}`,
            });

            const threadSystemText = await getSystemPromptContent();
            let finalSystem: string | null = null;
            try {
                const { settings } = useAiSettings();
                const settingsValue = settings.value as
                    | ChatSettings
                    | undefined;
                const master = settingsValue?.masterSystemPrompt ?? '';
                finalSystem = composeSystemPrompt(
                    master,
                    threadSystemText || null
                );
            } catch {
                finalSystem = (threadSystemText || '').trim() || null;
            }
            const continueSystemPrefix = [
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

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                baseMessages
            );

            const sanitizedEffectiveMessages = (
                Array.isArray(effectiveMessages) ? effectiveMessages : []
            ).filter(shouldKeepAssistantMessage);

            const isModelMessage = (
                m: ChatMessage
            ): m is ChatMessage & { role: 'user' | 'assistant' | 'system' } =>
                m.role !== 'tool';

            const modelInputMessages: ModelInputMessage[] =
                sanitizedEffectiveMessages.filter(isModelMessage).map(
                    (m): ModelInputMessage => ({
                        role: m.role,
                        content: m.content,
                        id: m.id,
                        file_hashes: m.file_hashes,
                        name: m.name,
                        tool_call_id: m.tool_call_id,
                    })
                );

            const { buildOpenRouterMessages } = await import(
                '~/core/auth/openrouter-build'
            );
            let orMessages: OpenRouterMessage[] = await buildOpenRouterMessages(
                modelInputMessages,
                {
                    maxImageInputs: 16,
                    imageInclusionPolicy: 'all',
                    debug: false,
                }
            );
            trimOrMessagesImages(
                orMessages as Parameters<typeof trimOrMessagesImages>[0],
                5
            );

            const filteredMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:before_send',
                { messages: orMessages }
            );

            if (
                typeof filteredMessages === 'object' &&
                'messages' in filteredMessages
            ) {
                const candidate = (
                    filteredMessages as {
                        messages?: OpenRouterMessage[];
                    }
                ).messages;
                if (Array.isArray(candidate)) {
                    orMessages = candidate;
                }
            }

            const hasImageInput = modelInputMessages.some((m) =>
                Array.isArray(m.content)
                    ? m.content.some((p) => {
                          const part = p as {
                              type?: string;
                              mediaType?: string;
                          };
                          if (
                              part.type === 'image' ||
                              part.type === 'image_url'
                          )
                              return true;
                          if (part.mediaType)
                              return /image\//.test(part.mediaType);
                          return false;
                      })
                    : false
            );
            const modelId =
                (await hooks.applyFilters(
                    'ai.chat.model:filter:select',
                    modelOverride || DEFAULT_AI_MODEL
                )) ||
                modelOverride ||
                DEFAULT_AI_MODEL;
            const modelImageHint = /image|vision|flash/i.test(modelId);
            const modalities =
                hasImageInput || modelImageHint ? ['image', 'text'] : ['text'];

            streamAcc.reset();
            const newStreamId = newId();
            streamId.value = newStreamId;
            loading.value = true;
            aborted.value = false;
            abortController.value = new AbortController();

            const existingReasoning = toReasoning(target);
            const existingHashes = target.file_hashes
                ? parseHashes(target.file_hashes)
                : [];
            let existingUiIndex = messages.value.findIndex(
                (m) => m.id === target.id
            );
            let existingUi: UiChatMessage | null = null;
            if (existingUiIndex >= 0) {
                existingUi = messages.value[existingUiIndex] ?? null;
                messages.value.splice(existingUiIndex, 1);
                messages.value = [...messages.value];
            }

            const current =
                (tailAssistant.value && tailAssistant.value.id === target.id
                    ? tailAssistant.value
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
            tailAssistant.value = current;

            if (existingText) {
                streamAcc.append(existingText, { kind: 'text' });
            }
            if (existingReasoning) {
                streamAcc.append(existingReasoning, { kind: 'reasoning' });
            }

            const assistantFileHashes = existingHashes.slice();
            const persistAssistant = makeAssistantPersister(
                target,
                assistantFileHashes
            );

            const stream = openRouterStream({
                apiKey: apiKey.value,
                model: modelId,
                orMessages: orMessages as Parameters<
                    typeof openRouterStream
                >[0]['orMessages'],
                modalities,
                signal: abortController.value.signal,
            });

            let chunkIndex = 0;
            let stripPrefixPending = true;
            let prefixBuffer = '';
            const CONTINUATION_PREFIX = '>>';
            let boundarySpacingApplied = false;
            const needsBoundarySpace = (prev: string, next: string) => {
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
                if ((isSentencePunct || isClosePunct) && isWordChar(first))
                    return true;
                return false;
            };
            const applyBoundarySpacing = (prev: string, next: string) => {
                if (boundarySpacingApplied) return next;
                boundarySpacingApplied = true;
                return needsBoundarySpace(prev, next) ? ` ${next}` : next;
            };
            const consumeContinuationDelta = (delta: string) => {
                if (!stripPrefixPending) return delta;
                prefixBuffer += delta;
                if (prefixBuffer.length < CONTINUATION_PREFIX.length) return '';
                if (prefixBuffer.startsWith(CONTINUATION_PREFIX)) {
                    prefixBuffer = prefixBuffer.slice(
                        CONTINUATION_PREFIX.length
                    );
                }
                stripPrefixPending = false;
                const out = prefixBuffer;
                prefixBuffer = '';
                return out;
            };
            const WRITE_INTERVAL_MS = 500;
            let lastPersistAt = 0;

            try {
                for await (const ev of stream) {
                    if (ev.type === 'reasoning') {
                        if (current.reasoning_text === null)
                            current.reasoning_text = ev.text;
                        else current.reasoning_text += ev.text;
                        streamAcc.append(ev.text, { kind: 'reasoning' });
                    } else if (ev.type === 'text') {
                        if (current.pending) current.pending = false;
                        const rawDelta = consumeContinuationDelta(ev.text);
                        if (!rawDelta) continue;
                        const delta = applyBoundarySpacing(
                            current.text,
                            rawDelta
                        );
                        if (!delta) continue;
                        streamAcc.append(delta, { kind: 'text' });
                        current.text += delta;
                        chunkIndex++;
                    } else if (ev.type === 'image') {
                        if (current.pending) current.pending = false;
                        // Store image first, then use hash placeholder (not Base64)
                        if (assistantFileHashes.length < 6) {
                            let blob: Blob | null = null;
                            if (ev.url.startsWith('data:image/'))
                                blob = dataUrlToBlob(ev.url);
                            else if (/^https?:/.test(ev.url)) {
                                try {
                                    blob = await $fetch<Blob>(ev.url, {
                                        responseType: 'blob',
                                    });
                                } catch {
                                    /* intentionally empty */
                                }
                            }
                            if (blob) {
                                try {
                                    const meta = await createOrRefFile(
                                        blob,
                                        'gen-image'
                                    );
                                    assistantFileHashes.push(meta.hash);
                                    // Use valid 1x1 transparent pixel and store hash in alt text to eliminate console errors
                                    const placeholder = `![file-hash:${meta.hash}](${TRANSPARENT_PIXEL_GIF_DATA_URI})`;
                                    const already =
                                        current.text.includes(placeholder);
                                    if (!already) {
                                        current.text +=
                                            (current.text ? '\n\n' : '') +
                                            placeholder;
                                    }
                                    const serialized = await persistAssistant({
                                        content: current.text,
                                        reasoning:
                                            current.reasoning_text ?? null,
                                    });
                                    current.file_hashes =
                                        serialized?.split(',') ?? [];
                                } catch {
                                    /* intentionally empty */
                                }
                            } else {
                                // Fallback: couldn't convert to blob, use URL directly
                                const placeholder = `![generated image](${ev.url})`;
                                const already =
                                    current.text.includes(placeholder);
                                if (!already) {
                                    current.text +=
                                        (current.text ? '\n\n' : '') +
                                        placeholder;
                                }
                            }
                        }
                    }

                    const now = Date.now();
                    const shouldPersist =
                        now - lastPersistAt >= WRITE_INTERVAL_MS ||
                        chunkIndex % 50 === 0;
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
                const rawIdx = rawMessages.value.findIndex(
                    (m) => m.id === messageId
                );
                if (rawIdx >= 0) {
                    const existingRaw = rawMessages.value[rawIdx];
                    if (existingRaw) {
                        rawMessages.value[rawIdx] = {
                            ...existingRaw,
                            role: existingRaw.role,
                            content: current.text,
                            reasoning_text: current.reasoning_text ?? null,
                            error: null,
                        };
                    }
                }
                streamAcc.finalize();
            } catch (streamError) {
                const e =
                    streamError instanceof Error
                        ? streamError
                        : new Error(String(streamError));
                streamAcc.finalize({ error: e });
                
                // Check if this was an intentional abort (user clicked stop)
                const wasAborted = aborted.value;
                const errorType = wasAborted ? 'stopped' : 'stream_interrupted';
                
                if (tailAssistant.value.text) {
                    await persistAssistant({
                        content: tailAssistant.value.text,
                        reasoning: tailAssistant.value.reasoning_text ?? null,
                        toolCalls: tailAssistant.value.toolCalls ?? null,
                        finalize: true, // Clear pending so sync captures this
                    });
                    tailAssistant.value.error = errorType;
                }
                const rawIdx = rawMessages.value.findIndex(
                    (m) => m.id === messageId
                );
                if (rawIdx >= 0) {
                    const existingRaw = rawMessages.value[rawIdx];
                    if (existingRaw) {
                        rawMessages.value[rawIdx] = {
                            ...existingRaw,
                            role: existingRaw.role,
                            content:
                                tailAssistant.value.text || existingRaw.content,
                            reasoning_text:
                                tailAssistant.value.reasoning_text ??
                                existingRaw.reasoning_text,
                            error: errorType,
                        };
                    }
                }
                await updateMessageRecord(messageId, {
                    error: errorType,
                });
                
                // Only show error toast for unintentional interruptions, not manual stops
                if (!wasAborted) {
                    reportError(e, {
                        code: 'ERR_STREAM_FAILURE',
                        tags: {
                            domain: 'chat',
                            threadId: threadIdRef.value || '',
                            streamId: streamId.value || '',
                            modelId,
                            stage: 'continue',
                        },
                        toast: true,
                    });
                }
            } finally {
                loading.value = false;
                if (tailAssistant.value.pending) {
                    tailAssistant.value.pending = false;
                }
                abortController.value = null;
                setTimeout(() => {
                    if (!loading.value && streamState.finalized) resetStream();
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

    function clear() {
        // CRITICAL: Abort any active stream before clearing to prevent memory leaks
        if (abortController.value) {
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch (e) {
                if (import.meta.dev) {
                    console.warn(
                        '[useChat] abort controller cleanup failed',
                        e
                    );
                }
            }
            streamAcc.finalize({ aborted: true });
            abortController.value = null;
        }

        // Clean up any registered hooks to avoid leaking listeners across threads
        if (cleanupFns.length) {
            for (const dispose of cleanupFns.splice(0, cleanupFns.length)) {
                try {
                    dispose();
                } catch {
                    /* intentionally empty */
                }
            }
        }

        rawMessages.value = [];
        messages.value = [];
        streamAcc.reset();
    }

    // Keep in-memory history in sync when a message is edited elsewhere (e.g., inline edit UI)
    function applyLocalEdit(id: string, text: string) {
        let updated = false;
        const rawIdx = rawMessages.value.findIndex((m) => m.id === id);
        const raw = rawIdx !== -1 ? rawMessages.value[rawIdx] : undefined;
        if (raw) {
            if (Array.isArray(raw.content)) {
                raw.content = raw.content.map((p) =>
                    p.type === 'text' ? { ...p, text } : p
                );
            } else {
                raw.content = text;
            }
            rawMessages.value = [...rawMessages.value];
            updated = true;
        }
        const uiIdx = messages.value.findIndex((m) => m.id === id);
        if (uiIdx !== -1) {
            const uiMsg = messages.value[uiIdx];
            if (uiMsg) {
                uiMsg.text = text;
                messages.value = [...messages.value];
                updated = true;
            }
        }
        if (tailAssistant.value?.id === id) {
            tailAssistant.value.text = text;
            updated = true;
        }
        return updated;
    }

    return {
        messages,
        rawMessages,
        sendMessage,
        send: sendMessage,
        retryMessage,
        continueMessage,
        loading,
        threadId: threadIdRef,
        streamId,
        resetStream,
        streamState,
        tailAssistant,
        flushTailAssistant,
        applyLocalEdit,
        ensureHistorySynced,
        abort: () => {
            if (!loading.value || !abortController.value) return;
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {
                /* intentionally empty */
            }
            streamAcc.finalize({ aborted: true });
            if (tailAssistant.value?.pending)
                tailAssistant.value.pending = false;
            try {
                const appConfig = useAppConfig() as {
                    errors?: { showAbortInfo?: boolean };
                };
                const showAbort =
                    typeof appConfig.errors === 'object' &&
                    appConfig.errors.showAbortInfo === true;
                reportError(
                    err('ERR_STREAM_ABORTED', 'Generation aborted', {
                        severity: 'info',
                        tags: {
                            domain: 'chat',
                            threadId: threadIdRef.value || '',
                            streamId: streamId.value || '',
                            stage: 'abort',
                        },
                    }),
                    { code: 'ERR_STREAM_ABORTED', toast: showAbort }
                );
            } catch {
                /* intentionally empty */
            }
        },
        clear,
    };
}
