import { ref } from 'vue';
import { useToast, useAppConfig } from '#imports';
import { nowSec, newId } from '~/db/util';
import { create, db, tx, upsert } from '~/db';
import { createOrRefFile } from '~/db/files';
import { serializeFileHashes } from '~/db/files-util';
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
} from '~/utils/chat/types';
import { ensureUiMessage, recordRawMessage } from '~/utils/chat/uiMessages';
import { reportError, err } from '~/utils/errors';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import {
    buildParts,
    mergeFileHashes,
    trimOrMessagesImages,
} from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import { openRouterStream } from '../../utils/chat/openrouterStream';
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

// NOTE: Previous global tail map removed; we keep per-instance tail state so
// each chat composable manages its own streaming tail.

export function useChat(
    msgs: ChatMessage[] = [],
    initialThreadId?: string,
    pendingPromptId?: string
) {
    // Messages and basic state
    // UI-facing normalized messages
    const messages = ref<UiChatMessage[]>(msgs.map((m) => ensureUiMessage(m)));
    // Raw legacy messages (content parts / strings) used for history & hooks
    const rawMessages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const abortController = ref<AbortController | null>(null);
    const aborted = ref(false);
    let { apiKey, setKey } = useUserApiKey();
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);

    if (import.meta.dev) {
        if (state.value.openrouterKey && apiKey) {
            setKey(state.value.openrouterKey);
        }
    }

    // Unified streaming accumulator only (legacy removed)
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

    // Tail assistant UI message (not added to messages[] until next user send)
    const tailAssistant = ref<UiChatMessage | null>(null);
    // When retrying we may intentionally remove the previous tail assistant (finalized answer)
    // and must ensure the next send() does NOT flush it into history. We keep the removed id
    // here and skip a single automatic flush if it matches.
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
        }
    ) {
        if (!apiKey.value) return;

        // --- DEBUG ENTRY (pane/mpApi snapshot) ---
        try {
            const mpApiDbg: any = (globalThis as any).__or3MultiPaneApi;
            console.debug('[useChat] sendMessage:entry', {
                threadIdRef: threadIdRef.value,
                hasMpApi: !!mpApiDbg,
                panesLen: mpApiDbg?.panes?.value?.length,
                activePaneIndex: mpApiDbg?.activePaneIndex?.value,
                paneThreadIds: Array.isArray(mpApiDbg?.panes?.value)
                    ? mpApiDbg.panes.value.map((p: any, i: number) => ({
                          i,
                          mode: p.mode,
                          threadId: p.threadId,
                      }))
                    : null,
            });
        } catch {}

        // Apply outgoing filter BEFORE creating thread to allow early veto
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        // Early veto: if filter returns false or empty string, skip everything
        if (!outgoing || outgoing === '') {
            useToast().add({
                title: 'Message blocked',
                description: 'Your message was filtered out.',
                timeout: 3000,
            } as any);
            return;
        }

        if (!threadIdRef.value) {
            // Resolve system prompt: pending > default
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {}
            }
            // Resolve default model based on settings (lastSelected vs fixed)
            try {
                const { settings } = useAiSettings();
                const set = (settings && (settings as any).value) || null;
                const { catalog } = useModelStore();
                // last selected model from localStorage (component writes under LAST_MODEL_KEY)
                let lastSelected: string | null = null;
                try {
                    if (typeof window !== 'undefined')
                        lastSelected = localStorage.getItem(
                            'last_selected_model'
                        );
                } catch {}
                // We don't have a centralized catalog availability here; optimistically accept provided model
                // and fallback to DEFAULT_AI_MODEL if not provided.
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
                // If caller didn't specify a model or specified an empty string, apply chosen.id
                if (!sendMessagesParams.model) {
                    (sendMessagesParams as any).model = chosen.id;
                }
                // Surface info toast when we didn't honor a fixed model (i.e., reason !== 'fixed')
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
                        try {
                            console.debug('[useChat] thread-bound-to-pane', {
                                newThreadId: newThread.id,
                                activePaneIndex: mpApi.activePaneIndex?.value,
                                paneId: pane?.id,
                                paneThreadId: pane?.threadId,
                            });
                        } catch {}
                    }
                } else {
                    try {
                        console.debug(
                            '[useChat] thread-bound: no panes present',
                            {
                                newThreadId: newThread.id,
                            }
                        );
                    } catch {}
                }
            } catch {}
        } // END create-new-thread block

        // Promote previous tail assistant (completed prior answer) into history unless
        // we intentionally suppressed it during a retry (duplicate would appear before
        // the re-sent user message otherwise).
        if (
            tailAssistant.value &&
            lastSuppressedAssistantId &&
            tailAssistant.value.id === lastSuppressedAssistantId
        ) {
            // Drop without flushing
            tailAssistant.value = null;
            lastSuppressedAssistantId = null;
        } else {
            flushTailAssistant();
            lastSuppressedAssistantId = null; // clear in normal path too
        }

        // Prior assistant hashes for image carry-over
        const prevAssistantRaw = [...rawMessages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        const prevAssistant = prevAssistantRaw
            ? messages.value.find((m) => m.id === prevAssistantRaw.id)
            : null;
        const assistantHashes = prevAssistantRaw?.file_hashes
            ? parseHashes(prevAssistantRaw.file_hashes)
            : [];

        // Prepare accumulator
        streamAcc.reset();
        // Normalize params
        let { files, model, file_hashes, extraTextParts, online } =
            sendMessagesParams as any;
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
            files,
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

        // Pane-scoped message sent hook (after append)
        try {
            const mpApi: any = (globalThis as any).__or3MultiPaneApi;
            if (mpApi && mpApi.panes?.value) {
                try {
                    console.debug('[useChat] pane-search:sent', {
                        threadId: threadIdRef.value,
                        paneThreads: mpApi.panes.value.map(
                            (p: any, i: number) => ({
                                i,
                                mode: p.mode,
                                threadId: p.threadId,
                            })
                        ),
                    });
                } catch {}
                const pane = mpApi.panes.value.find(
                    (p: any) =>
                        p.mode === 'chat' && p.threadId === threadIdRef.value
                );
                if (pane) {
                    if (import.meta.dev) {
                        try {
                            console.debug('[useChat] pane msg:sent', {
                                paneIndex: mpApi.panes.value.indexOf(pane),
                                threadId: threadIdRef.value,
                                msgId: userDbMsg.id,
                                length: outgoing.length,
                                fileHashes: userDbMsg.file_hashes || null,
                            });
                        } catch {}
                    }
                    const paneIndex = mpApi.panes.value.indexOf(pane);
                    hooks.doAction('ui.pane.msg:action:sent', {
                        pane,
                        paneIndex,
                        message: {
                            id: userDbMsg.id,
                            threadId: threadIdRef.value,
                            length: outgoing.length,
                            fileHashes: userDbMsg.file_hashes || null,
                        },
                    });
                } else if (import.meta.dev) {
                    try {
                        console.debug(
                            '[useChat] pane msg:sent (no pane found)',
                            {
                                threadId: threadIdRef.value,
                                msgId: userDbMsg.id,
                                panes: Array.isArray(mpApi.panes.value)
                                    ? mpApi.panes.value.map(
                                          (p: any, i: number) => ({
                                              i,
                                              mode: p.mode,
                                              threadId: p.threadId,
                                          })
                                      )
                                    : null,
                                activePaneIndex: mpApi.activePaneIndex?.value,
                                reason: !mpApi.panes.value.length
                                    ? 'no-panes'
                                    : 'thread-mismatch',
                            }
                        );
                    } catch {}
                }
            } else {
                try {
                    console.debug(
                        '[useChat] pane-search:sent mpApi missing or no panes',
                        {
                            threadId: threadIdRef.value,
                            hasMpApi: !!mpApi,
                        }
                    );
                } catch {}
            }
        } catch {}

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

            // Inject system message
            let messagesWithSystemRaw = [...rawMessages.value];
            const threadSystemText = await getSystemPromptContent();
            // Compose with global master system prompt
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

            // --- Sanitization: remove prior empty assistant placeholder messages ---
            // Root cause investigation: Anthropic (via OpenRouter) rejects a conversation
            // when an earlier assistant message has empty content, emitting:
            //   "messages.1: all messages must have non-empty content except for the optional final assistant message"
            // This occurs if a previous streamed assistant was aborted / failed before
            // any delta arrived, leaving an empty assistant entry in rawMessages.
            // We exclude such empty assistant messages from the request payload.
            const sanitizedEffectiveMessages = (
                effectiveMessages as any[]
            ).filter((m) => {
                if (m.role !== 'assistant') return true;
                const c = m.content;
                if (c == null) return false;
                if (typeof c === 'string') return c.trim().length > 0;
                if (Array.isArray(c)) {
                    // Content parts: keep if any part has non-empty text OR is an image / media part
                    return c.some((p) => {
                        if (!p) return false;
                        if (typeof p === 'string') return p.trim().length > 0;
                        if (p.type === 'text' && typeof p.text === 'string')
                            return p.text.trim().length > 0;
                        // Treat image / media parts as content-bearing
                        if (
                            p.type === 'image' ||
                            p.type === 'image_url' ||
                            (p.mediaType && /image\//.test(p.mediaType))
                        )
                            return true;
                        return false;
                    });
                }
                return true; // unknown shape: keep defensively
            });
            if (
                sanitizedEffectiveMessages.length !==
                (effectiveMessages as any[]).length
            ) {
                try {
                    console.debug(
                        '[useChat] removed empty assistant placeholders:',
                        (effectiveMessages as any[])
                            .filter((m: any) => m.role === 'assistant')
                            .map((m: any) => ({
                                id: m.id,
                                kept: sanitizedEffectiveMessages.includes(m),
                                contentPreview:
                                    typeof m.content === 'string'
                                        ? m.content.slice(0, 30)
                                        : JSON.stringify(m.content).slice(
                                              0,
                                              60
                                          ),
                            }))
                    );
                } catch {}
            }

            const { buildOpenRouterMessages } = await import(
                '~/core/auth/openrouter-build'
            );

            // Duplicate ensureThreadHistoryLoaded removed (already loaded earlier in this sendMessage invocation)
            const modelInputMessages: any[] = (
                sanitizedEffectiveMessages as any[]
            ).map((m: any) => ({ ...m }));
            if (assistantHashes.length && prevAssistant?.id) {
                const target = modelInputMessages.find(
                    (m) => m.id === prevAssistant.id
                );
                if (target) target.file_hashes = null;
            }
            const orMessages = await buildOpenRouterMessages(
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

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId: newStreamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? (effectiveMessages as any[]).length
                    : undefined,
            });

            aborted.value = false;
            abortController.value = new AbortController();
            const stream = openRouterStream({
                apiKey: apiKey.value!,
                model: modelId,
                orMessages,
                modalities,
                signal: abortController.value.signal,
            });

            const rawAssistant: ChatMessage = {
                role: 'assistant',
                content: '',
                id: (assistantDbMsg as any).id,
                stream_id: newStreamId,
                reasoning_text: null,
            } as any;
            recordRawMessage(rawAssistant);
            rawMessages.value.push(rawAssistant);
            const uiAssistant = ensureUiMessage(rawAssistant);
            uiAssistant.pending = true;
            tailAssistant.value = uiAssistant; // keep out of main messages until next user send
            const current = uiAssistant;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 500;
            let lastPersistAt = 0;
            const assistantFileHashes: string[] = [];

            for await (const ev of stream) {
                if (ev.type === 'reasoning') {
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
                    await hooks.doAction('ai.chat.stream:action:delta', delta, {
                        threadId: threadIdRef.value,
                        assistantId: assistantDbMsg.id,
                        streamId: newStreamId,
                        deltaLength: String(delta ?? '').length,
                        totalLength:
                            current.text.length + String(delta ?? '').length,
                        chunkIndex: chunkIndex++,
                    });
                    current.text += delta;
                } else if (ev.type === 'image') {
                    if (current.pending) current.pending = false;
                    // Append markdown placeholder exactly once per image URL
                    const placeholder = `![generated image](${ev.url})`;
                    const already = current.text.includes(placeholder);
                    if (!already) {
                        current.text +=
                            (current.text ? '\n\n' : '') + placeholder;
                    }
                    if (import.meta.dev) {
                        console.debug('[stream:image:event]', {
                            url: ev.url?.slice(0, 80),
                            placeholderInserted: !already,
                            currentLength: current.text.length,
                            fileHashes: assistantFileHashes.slice(),
                        });
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
                                    serializeFileHashes(assistantFileHashes);
                                const updatedMsg = {
                                    ...assistantDbMsg,
                                    data: {
                                        ...((assistantDbMsg as any).data || {}),
                                        reasoning_text:
                                            current.reasoning_text ?? null,
                                    },
                                    file_hashes: serialized,
                                    updated_at: nowSec(),
                                } as any;
                                await upsert.message(updatedMsg);
                                (current as any).file_hashes = serialized;
                                if (import.meta.dev) {
                                    console.debug('[stream:image:persist]', {
                                        hash: meta.hash,
                                        total: assistantFileHashes.length,
                                        serialized,
                                    });
                                }
                            } catch {}
                        }
                    }
                }

                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const textContent = current.text;
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: textContent,
                            reasoning_text: current.reasoning_text ?? null,
                        },
                        file_hashes: assistantFileHashes.length
                            ? serializeFileHashes(assistantFileHashes)
                            : (assistantDbMsg as any).file_hashes,
                        updated_at: nowSec(),
                    } as any;
                    await upsert.message(updated);
                    if (assistantFileHashes.length)
                        (current as any).file_hashes =
                            serializeFileHashes(assistantFileHashes);
                    lastPersistAt = now;
                }
            }

            const fullText = current.text;
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                fullText,
                threadIdRef.value
            );
            if (current.pending) current.pending = false;
            current.text = incoming as string;
            const finalized = {
                ...assistantDbMsg,
                data: {
                    ...((assistantDbMsg as any).data || {}),
                    content: incoming,
                    reasoning_text: current.reasoning_text ?? null,
                },
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : (assistantDbMsg as any).file_hashes,
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);
            await hooks.doAction('ai.chat.stream:action:complete', {
                threadId: threadIdRef.value,
                assistantId: assistantDbMsg.id,
                streamId: newStreamId,
                totalLength: (incoming as string).length,
                reasoningLength: (current.reasoning_text || '').length,
                fileHashes: finalized.file_hashes || null,
            });
            // Pane-scoped assistant received hook
            try {
                const mpApi: any = (globalThis as any).__or3MultiPaneApi;
                if (mpApi && mpApi.panes?.value) {
                    try {
                        console.debug('[useChat] pane-search:received', {
                            threadId: threadIdRef.value,
                            paneThreads: mpApi.panes.value.map(
                                (p: any, i: number) => ({
                                    i,
                                    mode: p.mode,
                                    threadId: p.threadId,
                                })
                            ),
                        });
                    } catch {}
                    const pane = mpApi.panes.value.find(
                        (p: any) =>
                            p.mode === 'chat' &&
                            p.threadId === threadIdRef.value
                    );
                    if (pane) {
                        if (import.meta.dev) {
                            try {
                                console.debug('[useChat] pane msg:received', {
                                    paneIndex: mpApi.panes.value.indexOf(pane),
                                    threadId: threadIdRef.value,
                                    msgId: finalized.id,
                                    length: (incoming as string).length,
                                    reasoningLength: (
                                        current.reasoning_text || ''
                                    ).length,
                                    fileHashes: finalized.file_hashes || null,
                                });
                            } catch {}
                        }
                        const paneIndex = mpApi.panes.value.indexOf(pane);
                        hooks.doAction('ui.pane.msg:action:received', {
                            pane,
                            paneIndex,
                            message: {
                                id: finalized.id,
                                threadId: threadIdRef.value,
                                length: (incoming as string).length,
                                fileHashes: finalized.file_hashes || null,
                                reasoningLength: (current.reasoning_text || '')
                                    .length,
                            },
                        });
                    } else if (import.meta.dev) {
                        try {
                            console.debug(
                                '[useChat] pane msg:received (no pane found)',
                                {
                                    threadId: threadIdRef.value,
                                    msgId: finalized.id,
                                    length: (incoming as string).length,
                                    panes: Array.isArray(mpApi.panes.value)
                                        ? mpApi.panes.value.map(
                                              (p: any, i: number) => ({
                                                  i,
                                                  mode: p.mode,
                                                  threadId: p.threadId,
                                              })
                                          )
                                        : null,
                                    activePaneIndex:
                                        mpApi.activePaneIndex?.value,
                                    reason: !mpApi.panes.value.length
                                        ? 'no-panes'
                                        : 'thread-mismatch',
                                }
                            );
                        } catch {}
                    }
                } else {
                    try {
                        console.debug(
                            '[useChat] pane-search:received mpApi missing or no panes',
                            {
                                threadId: threadIdRef.value,
                                hasMpApi: !!mpApi,
                            }
                        );
                    } catch {}
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
                await hooks.doAction('ai.chat.send:action:after', {
                    threadId: threadIdRef.value,
                    aborted: true,
                });
                // Clean up empty assistant message from DB after abort
                if (tailAssistant.value?.id && !tailAssistant.value?.text) {
                    try {
                        await db.messages.delete(tailAssistant.value.id);
                        const idx = rawMessages.value.findIndex(
                            (m) => m.id === tailAssistant.value!.id
                        );
                        if (idx >= 0) rawMessages.value.splice(idx, 1);
                    } catch {}
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
                // Drop empty failed assistant from memory AND database
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
            abortController.value = null;
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
                    content: (m.data as any)?.content || '',
                    id: m.id,
                    stream_id: m.stream_id,
                    file_hashes: m.file_hashes,
                    reasoning_text: (m.data as any)?.reasoning_text || null,
                }));
                messages.value = dbMessages.map((m: any) =>
                    ensureUiMessage({
                        role: m.role,
                        content: (m.data as any)?.content || '',
                        id: m.id,
                        stream_id: m.stream_id,
                        file_hashes: m.file_hashes,
                        reasoning_text: (m.data as any)?.reasoning_text || null,
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

    /** Free all in-memory message arrays (UI + raw) and abort any active stream. */
    function clear() {
        try {
            if (abortController.value) {
                aborted.value = true;
                try {
                    abortController.value.abort();
                } catch {}
                streamAcc.finalize({ aborted: true });
                abortController.value = null;
            }
        } catch {}
        rawMessages.value = [];
        messages.value = [];
        // Defensive: if any lingering refs still hold many messages, let GC reclaim by slicing to empty
        if (
            (rawMessages as any)._value &&
            (rawMessages as any)._value.length > 1000
        ) {
            (rawMessages as any)._value = [];
        }
        if (
            (messages as any)._value &&
            (messages as any)._value.length > 1000
        ) {
            (messages as any)._value = [];
        }
        streamAcc.reset();
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
