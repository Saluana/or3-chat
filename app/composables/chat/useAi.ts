import { ref } from 'vue';
import { useToast, useAppConfig } from '#imports';
import { nowSec, newId } from '~/db/util';
import { create, db, tx, upsert } from '~/db';
import { createOrRefFile } from '~/db/files';
import { serializeFileHashes, MAX_MESSAGE_FILE_HASHES } from '~/db/files-util';
import {
    parseHashes,
    mergeAssistantFileHashes,
} from '~/utils/files/attachments';
import { getThreadSystemPrompt } from '~/db/threads';
import { getPrompt } from '~/db/prompts';
import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
    ToolCall,
} from '~/utils/chat/types';
import { ensureUiMessage, recordRawMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import { buildParts, trimOrMessagesImages } from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import { openRouterStream } from '../../utils/chat/openrouterStream';
import { useToolRegistry } from '~/utils/chat/tool-registry';
import { dataUrlToBlob, inferMimeFromUrl } from '~/utils/chat/files';
import {
    promptJsonToString,
    composeSystemPrompt,
} from '~/utils/chat/prompt-utils';
import { resolveDefaultModel } from '~/core/auth/models-service';
import { state } from '~/state/global';
// Import paths aligned with tests' vi.mock targets
import { useUserApiKey } from '#imports';
import { useActivePrompt } from '#imports';
import { getDefaultPromptId } from '#imports';
import { useHooks } from '#imports';
// settings/model store are provided elsewhere at runtime; keep dynamic access guards

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

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
    let { apiKey, setKey } = useUserApiKey();
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    const historyLoadedFor = ref<string | null>(null);

    if (import.meta.dev) {
        if (state.value.openrouterKey && apiKey) {
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
            ? promptJsonToString(activePromptContent.value)
            : null;
    }

    // Helpers to reduce duplication and improve clarity/perf
    function getActivePaneContext() {
        try {
            const mpApi: any = (globalThis as any).__or3MultiPaneApi;
            if (!mpApi?.panes?.value) return null;
            const pane = mpApi.panes.value.find(
                (p: any) =>
                    p.mode === 'chat' && p.threadId === threadIdRef.value
            );
            if (!pane) return null;
            const paneIndex = mpApi.panes.value.indexOf(pane);
            return { mpApi, pane, paneIndex };
        } catch {
            return null;
        }
    }

    function makeAssistantPersister(
        assistantDbMsg: any,
        assistantFileHashes: string[]
    ) {
        // Cache last serialized file hashes to avoid recomputing on each write
        let lastSerialized: string | null =
            (assistantDbMsg as any).file_hashes || null;
        return async function persist({
            content,
            reasoning,
            toolCalls,
        }: {
            content?: string;
            reasoning?: string | null;
            toolCalls?: any[] | null;
        }) {
            const serialized = assistantFileHashes.length
                ? serializeFileHashes(assistantFileHashes)
                : lastSerialized;
            if (
                serialized !== lastSerialized ||
                content != null ||
                reasoning != null ||
                toolCalls != null
            ) {
                const payload = {
                    ...assistantDbMsg,
                    data: {
                        ...((assistantDbMsg as any).data || {}),
                        content:
                            content ??
                            (assistantDbMsg as any).data?.content ??
                            '',
                        reasoning_text:
                            reasoning ??
                            (assistantDbMsg as any).data?.reasoning_text ??
                            null,
                        ...(toolCalls
                            ? {
                                  tool_calls: JSON.parse(
                                      JSON.stringify(toolCalls)
                                  ),
                              }
                            : {}),
                    },
                    file_hashes: serialized,
                    updated_at: nowSec(),
                } as any;
                await upsert.message(payload);
                lastSerialized = serialized ?? null;
            }
            return lastSerialized;
        };
    }

    function shouldKeepAssistantMessage(m: any) {
        if (m.role !== 'assistant') return true;
        const c = m.content;
        if (c == null) return false;
        if (typeof c === 'string') return c.trim().length > 0;
        if (Array.isArray(c)) {
            return c.some((p) => {
                if (!p) return false;
                if (typeof p === 'string') return p.trim().length > 0;
                if (p.type === 'text' && typeof p.text === 'string')
                    return p.text.trim().length > 0;
                if (
                    p.type === 'image' ||
                    p.type === 'image_url' ||
                    (p.mediaType && /image\//.test(p.mediaType))
                )
                    return true;
                return false;
            });
        }
        return true;
    }

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
                .filter((m) => m.role !== 'tool')
                .map((m) => ensureUiMessage(m));
        }
    }

    const tailAssistant = ref<UiChatMessage | null>(null);
    let lastSuppressedAssistantId: string | null = null;
    function flushTailAssistant() {
        if (!tailAssistant.value) return;
        if (!messages.value.find((m) => m.id === tailAssistant.value!.id)) {
            messages.value.push(tailAssistant.value!);
        }
        tailAssistant.value = null;
    }

    async function sendMessage(
        content: string,
        sendMessagesParams: SendMessageParams = {
            files: [],
            model: DEFAULT_AI_MODEL,
            file_hashes: [],
            online: false,
            context_hashes: [],
        }
    ) {
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
                timeout: 3000,
            } as any);
            return;
        }

        if (!threadIdRef.value) {
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {}
            }
            try {
                const { settings } = useAiSettings();
                const set = (settings && (settings as any).value) || null;
                const { catalog } = useModelStore();
                let lastSelected: string | null = null;
                try {
                    if (typeof window !== 'undefined')
                        lastSelected = localStorage.getItem(
                            'last_selected_model'
                        );
                } catch {}
                const chosen = resolveDefaultModel(
                    {
                        defaultModelMode:
                            (set?.defaultModelMode as any) || 'lastSelected',
                        fixedModelId: (set?.fixedModelId as any) || null,
                    },
                    {
                        isAvailable: (id: string) =>
                            !!(catalog?.value || []).some(
                                (m: any) => m?.id === id
                            ),
                        lastSelectedModelId: () => lastSelected,
                        recommendedDefault: () => DEFAULT_AI_MODEL,
                    }
                );
                if (!sendMessagesParams.model) {
                    (sendMessagesParams as any).model = chosen.id;
                }
                if (
                    set?.defaultModelMode === 'fixed' &&
                    chosen.reason !== 'fixed'
                ) {
                    try {
                        useToast()?.add?.({
                            title: 'Model fallback in effect',
                            description:
                                'Your fixed model was not used. Falling back to last selected or default.',
                            timeout: 3500,
                        } as any);
                    } catch {}
                }
            } catch {}
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
            threadIdRef.value = newThread.id;
            // Bind thread to active pane immediately (before first user message hook) if multi-pane present.
            try {
                const mpApi: any = (globalThis as any).__or3MultiPaneApi;
                if (
                    mpApi?.panes?.value &&
                    mpApi.activePaneIndex?.value != null &&
                    mpApi.activePaneIndex.value >= 0
                ) {
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
            } catch {}
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
        let {
            files,
            model,
            file_hashes,
            extraTextParts,
            online,
            context_hashes,
        } = sendMessagesParams as any;
        if (
            (!files || files.length === 0) &&
            Array.isArray((sendMessagesParams as any)?.images)
        ) {
            files = (sendMessagesParams as any).images.map((img: any) => {
                const url = typeof img === 'string' ? img : img.url;
                const provided = typeof img === 'object' ? img.type : undefined;
                return { type: inferMimeFromUrl(url, provided), url } as any;
            });
        }
        if (!model) model = DEFAULT_AI_MODEL;
        if (online === true) model = model + ':online';

        file_hashes = mergeAssistantFileHashes(assistantHashes, file_hashes);
        const normalizeFileUrl = async (f: { type: string; url: string }) => {
            if (typeof FileReader === 'undefined') return f; // SSR safeguard
            const mime = f.type || '';
            // Only hydrate images; leave other files (e.g., PDFs) untouched for now.
            if (!mime.startsWith('image/')) return f;
            let url = f.url || '';
            if (url.startsWith('data:image/')) return { ...f, url };
            try {
                // Local hash -> load from Dexie
                if (!/^https?:|^data:|^blob:/i.test(url)) {
                    const { getFileBlob } = await import('~/db/files');
                    const blob = await getFileBlob(url);
                    if (blob) {
                        url = await new Promise<string>((resolve, reject) => {
                            const fr = new FileReader();
                            fr.onerror = () => reject(fr.error);
                            fr.onload = () => resolve(fr.result as string);
                            fr.readAsDataURL(blob);
                        });
                        return { ...f, url };
                    }
                }
                // blob: object URL -> fetch and encode
                if (url.startsWith('blob:')) {
                    const resp = await fetch(url);
                    if (resp.ok) {
                        const blob = await resp.blob();
                        url = await new Promise<string>((resolve, reject) => {
                            const fr = new FileReader();
                            fr.onerror = () => reject(fr.error);
                            fr.onload = () => resolve(fr.result as string);
                            fr.readAsDataURL(blob);
                        });
                        return { ...f, url };
                    }
                }
            } catch {
                // fall through to original url
            }
            return { ...f, url };
        };

        const hydratedFiles = await Promise.all(
            Array.isArray(files) ? files.map(normalizeFileUrl) : []
        );

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
                    const dataUrl = await new Promise<string>(
                        (resolve, reject) => {
                            const fr = new FileReader();
                            fr.onerror = () => reject(fr.error);
                            fr.onload = () => resolve(fr.result as string);
                            fr.readAsDataURL(blob);
                        }
                    );
                    return {
                        type: 'file',
                        data: dataUrl,
                        mediaType: mime,
                        name: meta?.name || 'document.pdf',
                    };
                }
                if (!mime.startsWith('image/')) return null;
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const fr = new FileReader();
                    fr.onerror = () => reject(fr.error);
                    fr.onload = () => resolve(fr.result as string);
                    fr.readAsDataURL(blob);
                });
                return {
                    type: 'image',
                    image: dataUrl,
                    mediaType: mime,
                };
            } catch {
                return null;
            }
        };

        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes:
                file_hashes && file_hashes.length
                    ? (file_hashes as any)
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
            id: (userDbMsg as any).id,
            file_hashes: userDbMsg.file_hashes,
        };
        recordRawMessage(rawUser);
        rawMessages.value.push(rawUser);
        messages.value.push(ensureUiMessage(rawUser));

        try {
            const ctx = getActivePaneContext();
            if (ctx) {
                hooks.doAction('ui.pane.msg:action:sent', {
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

            let messagesWithSystemRaw = [...rawMessages.value];
            const threadSystemText = await getSystemPromptContent();
            let finalSystem: string | null = null;
            try {
                const { settings } = useAiSettings();
                const master = ((settings as any)?.value?.masterSystemPrompt ??
                    '') as string;
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
                effectiveMessages as any[]
            ).filter(shouldKeepAssistantMessage);

            const { buildOpenRouterMessages } = await import(
                '~/core/auth/openrouter-build'
            );

            // Load thread history if not already loaded
            await ensureHistorySynced();

            const modelInputMessages: any[] = (
                sanitizedEffectiveMessages as any[]
            ).map((m: any) => ({ ...m }));
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
                        .map((m: any, idx: number) =>
                            m?.role === 'user' ? idx : -1
                        )
                        .filter((idx) => idx >= 0)
                        .pop();
                    if (lastUserIdx != null && lastUserIdx >= 0) {
                        const target = modelInputMessages[lastUserIdx];
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
            let orMessages = await buildOpenRouterMessages(
                modelInputMessages as any,
                {
                    maxImageInputs: 16,
                    imageInclusionPolicy: 'all',
                    debug: false,
                }
            );
            trimOrMessagesImages(orMessages, 5);

            const hasImageInput = (modelInputMessages as any[]).some((m) =>
                Array.isArray(m.content)
                    ? (m.content as any[]).some(
                          (p) =>
                              p?.type === 'image_url' ||
                              p?.type === 'image' ||
                              p?.mediaType?.startsWith('image/')
                      )
                    : false
            );
            const modelImageHint = /image|vision|flash/i.test(modelId);
            const modalities =
                hasImageInput || modelImageHint ? ['image', 'text'] : ['text'];

            const newStreamId = newId();
            streamId.value = newStreamId;
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: newStreamId,
                data: { content: '', attachments: [], reasoning_text: null },
            });
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
                    ? (effectiveMessages as any[]).length
                    : undefined,
            });

            const toolRegistry = useToolRegistry();
            const enabledToolDefs = toolRegistry.getEnabledDefinitions();

            // Track tool calls across all loop iterations (persists state)
            const activeToolCalls = new Map<string, any>();

            aborted.value = false;
            abortController.value = new AbortController();

            let continueLoop = true;
            let loopIteration = 0;
            const MAX_TOOL_ITERATIONS = 10; // Prevent infinite loops

            const filteredMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:before_send',
                { messages: orMessages }
            );

            if (filteredMessages && (filteredMessages as any).messages) {
                orMessages = (filteredMessages as any).messages;
            }

            while (continueLoop && loopIteration < MAX_TOOL_ITERATIONS) {
                continueLoop = false;
                loopIteration++;

                const stream = openRouterStream({
                    apiKey: apiKey.value!,
                    model: modelId,
                    orMessages,
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
                    id: (assistantDbMsg as any).id,
                    stream_id: newStreamId,
                    reasoning_text: null,
                } as any;

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
                            } catch {}
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
                                    deltaLength: String(delta ?? '').length,
                                    totalLength:
                                        current.text.length +
                                        String(delta ?? '').length,
                                    chunkIndex: chunkIndex++,
                                }
                            );
                            current.text += delta;
                        } else if (ev.type === 'image') {
                            if (current.pending) current.pending = false;
                            const placeholder = `![generated image](${ev.url})`;
                            const already = current.text.includes(placeholder);
                            if (!already) {
                                current.text +=
                                    (current.text ? '\n\n' : '') + placeholder;
                            }
                            if (assistantFileHashes.length < 6) {
                                let blob: Blob | null = null;
                                if (ev.url.startsWith('data:image/'))
                                    blob = dataUrlToBlob(ev.url);
                                else if (/^https?:/.test(ev.url)) {
                                    try {
                                        const r = await fetch(ev.url);
                                        if (r.ok) blob = await r.blob();
                                    } catch {}
                                }
                                if (blob) {
                                    try {
                                        const meta = await createOrRefFile(
                                            blob,
                                            'gen-image'
                                        );
                                        assistantFileHashes.push(meta.hash);
                                        const serialized =
                                            await persistAssistant({
                                                reasoning:
                                                    current.reasoning_text ??
                                                    null,
                                            });
                                        (current as any).file_hashes =
                                            serialized;
                                    } catch {}
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
                                (current as any).file_hashes =
                                    serializeFileHashes(assistantFileHashes);
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
                                thread_id: threadIdRef.value!,
                                role: 'tool' as any,
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
                            content: current.text || null,
                            tool_calls: pendingToolCalls.map((toolCall) => ({
                                id: toolCall.id,
                                type: 'function',
                                function: {
                                    name: toolCall.function.name,
                                    arguments: toolCall.function.arguments,
                                },
                            })),
                        } as any);

                        for (const payload of toolResultsForNextLoop) {
                            orMessages.push({
                                role: 'tool',
                                tool_call_id: payload.call.id,
                                name: payload.call.function.name,
                                content: payload.result,
                            } as any);
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
            const errorsBefore = hooks._diagnostics?.errors?.[hookName] ?? 0;
            const incoming = (await hooks.applyFilters(
                hookName,
                fullText,
                threadIdRef.value
            )) as string;
            const errorsAfter = hooks._diagnostics?.errors?.[hookName] ?? 0;
            if (errorsAfter > errorsBefore) {
                throw new Error('Incoming filter threw an exception');
            }
            if (current.pending) current.pending = false;
            current.text = incoming;
            await persistAssistant({
                content: incoming as string,
                reasoning: current.reasoning_text ?? null,
                toolCalls: current.toolCalls ?? null,
            });
            const finalized = {
                ...assistantDbMsg,
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : (assistantDbMsg as any).file_hashes,
            } as any;
            await hooks.doAction('ai.chat.stream:action:complete', {
                threadId: threadIdRef.value,
                assistantId: assistantDbMsg.id,
                streamId: newStreamId,
                totalLength: (incoming as string).length,
                reasoningLength: (current.reasoning_text || '').length,
                fileHashes: finalized.file_hashes || null,
            });
            try {
                const ctx = getActivePaneContext();
                if (ctx) {
                    hooks.doAction('ui.pane.msg:action:received', {
                        pane: ctx.pane,
                        paneIndex: ctx.paneIndex,
                        message: {
                            id: finalized.id,
                            threadId: threadIdRef.value,
                            length: (incoming as string).length,
                            fileHashes: finalized.file_hashes || null,
                            reasoningLength: (current.reasoning_text || '')
                                .length,
                        },
                    });
                }
            } catch {}
            const endedAt = Date.now();
            await hooks.doAction('ai.chat.send:action:after', {
                threadId: threadIdRef.value,
                request: { modelId, userId: userDbMsg.id },
                response: {
                    assistantId: assistantDbMsg.id,
                    length: (incoming as string).length,
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
                    (tailAssistant.value as any).pending = false;
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
                if (tailAssistant.value?.id && !tailAssistant.value?.text) {
                    try {
                        await db.messages.delete(tailAssistant.value.id);
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
                }
                tailAssistant.value = null;
            } else {
                const lastUser = [...messages.value]
                    .reverse()
                    .find((m) => m.role === 'user');
                const retryFn = lastUser
                    ? () => retryMessage(lastUser.id as any)
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
                        await db.messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch {}
                    tailAssistant.value = null;
                } else if (tailAssistant.value?.pending) {
                    (tailAssistant.value as any).pending = false;
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
            const target: any = await db.messages.get(messageId);
            if (!target || target.thread_id !== threadIdRef.value) return;
            let userMsg: any = target.role === 'user' ? target : null;
            if (!userMsg && target.role === 'assistant') {
                const DexieMod = (await import('dexie')).default;
                userMsg = await db.messages
                    .where('[thread_id+index]')
                    .between(
                        [target.thread_id, DexieMod.minKey],
                        [target.thread_id, target.index]
                    )
                    .filter(
                        (m: any) =>
                            m.role === 'user' &&
                            !m.deleted &&
                            m.index < target.index
                    )
                    .last();
            }
            if (!userMsg) return;
            const DexieMod2 = (await import('dexie')).default;
            const assistant = await db.messages
                .where('[thread_id+index]')
                .between(
                    [userMsg.thread_id, userMsg.index + 1],
                    [userMsg.thread_id, DexieMod2.maxKey]
                )
                .filter((m: any) => m.role === 'assistant' && !m.deleted)
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
                triggeredBy: target.role,
            });

            // Store original text and hashes before deletion
            const originalText = (userMsg.data as any)?.content || '';
            let hashes: string[] = [];
            if (userMsg.file_hashes) {
                const { parseFileHashes } = await import('~/db/files-util');
                hashes = parseFileHashes(userMsg.file_hashes);
            }

            // CRITICAL: Before deleting, ensure in-memory state matches DB state
            // This handles edge cases where messages exist in DB but not in memory
            const { messagesByThread } = await import('~/db/messages');
            const dbMessages =
                (await messagesByThread(threadIdRef.value!)) || [];

            // If DB has more messages than our in-memory arrays, we need to sync first
            if (dbMessages.length > rawMessages.value.length) {
                console.warn('[retry] Syncing messages from DB before retry', {
                    dbCount: dbMessages.length,
                    memoryCount: rawMessages.value.length,
                });
                rawMessages.value = dbMessages.map((m: any) => ({
                    role: m.role,
                    content:
                        typeof m.data?.content === 'string'
                            ? m.data.content
                            : (m as any).content || '',
                    id: m.id,
                    stream_id: m.stream_id,
                    file_hashes: m.file_hashes,
                    reasoning_text:
                        typeof m.data?.reasoning_text === 'string'
                            ? m.data.reasoning_text
                            : null,
                    data: m.data || null,
                    index:
                        typeof m.index === 'number'
                            ? m.index
                            : typeof m.index === 'string'
                            ? Number(m.index) || null
                            : null,
                    created_at:
                        typeof m.created_at === 'number' ? m.created_at : null,
                }));
                const uiMessages = dbMessages.filter(
                    (m: any) => m.role !== 'tool'
                );
                messages.value = uiMessages.map((m: any) =>
                    ensureUiMessage({
                        role: m.role,
                        content:
                            typeof m.data?.content === 'string'
                                ? m.data.content
                                : (m as any).content || '',
                        id: m.id,
                        stream_id: m.stream_id,
                        file_hashes: m.file_hashes,
                        reasoning_text:
                            typeof m.data?.reasoning_text === 'string'
                                ? m.data.reasoning_text
                                : null,
                        data: m.data,
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
            await db.transaction('rw', db.messages, async () => {
                await db.messages.delete(userMsg.id);
                if (assistant) await db.messages.delete(assistant.id);
            });

            // Remove deleted messages from in-memory arrays
            rawMessages.value = rawMessages.value.filter(
                (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
            );
            messages.value = messages.value.filter(
                (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
            );

            await sendMessage(originalText, {
                model: modelOverride || DEFAULT_AI_MODEL,
                file_hashes: hashes,
                files: [],
                online: false,
            });
            const tail = messages.value.slice(-2);
            const newUser = tail.find((m: any) => m.role === 'user');
            const newAssistant = tail.find((m: any) => m.role === 'assistant');
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

        rawMessages.value = [];
        messages.value = [];
        streamAcc.reset();
    }

    // Keep in-memory history in sync when a message is edited elsewhere (e.g., inline edit UI)
    function applyLocalEdit(id: string, text: string) {
        let updated = false;
        const rawIdx = rawMessages.value.findIndex((m) => m.id === id);
        if (rawIdx !== -1) {
            const raw = rawMessages.value[rawIdx];
            if (raw) {
                if (Array.isArray(raw.content)) {
                    raw.content = raw.content.map((p: any) =>
                        p?.type === 'text' ? { ...p, text } : p
                    );
                } else {
                    raw.content = text;
                }
                rawMessages.value = [...rawMessages.value];
                updated = true;
            }
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
        sendMessage,
        retryMessage,
        loading,
        threadId: threadIdRef,
        streamId,
        resetStream,
        streamState,
        tailAssistant,
        flushTailAssistant,
        applyLocalEdit,
        abort: () => {
            if (!loading.value || !abortController.value) return;
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {}
            streamAcc.finalize({ aborted: true });
            if (tailAssistant.value?.pending)
                (tailAssistant.value as any).pending = false;
            try {
                const appConfig = useAppConfig?.() as any;
                const showAbort = appConfig?.errors?.showAbortInfo === true;
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
            } catch {}
        },
        clear,
    };
}
