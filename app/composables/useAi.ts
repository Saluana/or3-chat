import { ref } from 'vue';
import { createStreamAccumulator } from './useStreamAccumulator';
import { useToast } from '#imports';
import { nowSec, newId } from '~/db/util';
import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { useActivePrompt } from './useActivePrompt';
import { getDefaultPromptId } from './useDefaultPrompt';
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
    TextPart,
} from '~/utils/chat/types';
import { ensureUiMessage, recordRawMessage } from '~/utils/chat/uiMessages';
import type { UiChatMessage } from '~/utils/chat/uiMessages';
import {
    buildParts,
    mergeFileHashes,
    trimOrMessagesImages,
} from '~/utils/chat/messages';
// getTextFromContent removed for UI messages; raw messages maintain original parts if needed
import { openRouterStream } from '~/utils/chat/openrouterStream';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import { dataUrlToBlob, inferMimeFromUrl } from '~/utils/chat/files';
import { promptJsonToString } from '~/utils/prompt-utils';
import { state } from '~/state/global';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

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
    const getRawMessages = () => {
        if (import.meta.dev) {
            console.warn(
                '[useChat] getRawMessages() is deprecated; prefer UiChatMessage via messages ref'
            );
        }
        return rawMessages.value;
    }; // transitional
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

    // Unified streaming accumulator only (legacy removed)
    const streamAcc = createStreamAccumulator();
    const streamState = streamAcc.state;
    const streamId = ref<string | null>(null);
    function resetStream() {
        streamAcc.reset();
        streamId.value = null;
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

        if (!threadIdRef.value) {
            // Resolve system prompt: pending > default
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {}
            }
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
            threadIdRef.value = newThread.id;
        }

        await ensureThreadHistoryLoaded(
            threadIdRef,
            historyLoadedFor,
            rawMessages as any
        );

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

        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

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
                const pane = mpApi.panes.value.find(
                    (p: any) =>
                        p.mode === 'chat' && p.threadId === threadIdRef.value
                );
                if (pane)
                    hooks.doAction('ui.pane.msg:action:sent', pane, {
                        id: userDbMsg.id,
                        threadId: threadIdRef.value,
                        length: outgoing.length,
                        fileHashes: userDbMsg.file_hashes || null,
                    });
            }
        } catch {}

        loading.value = true;
        streamId.value = null;

        try {
            const startedAt = Date.now();
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );

            // Inject system message
            let messagesWithSystemRaw = [...rawMessages.value];
            const systemText = await getSystemPromptContent();
            if (systemText && systemText.trim()) {
                messagesWithSystemRaw.unshift({
                    role: 'system',
                    content: systemText,
                    id: `system-${newId()}`,
                });
            }

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messagesWithSystemRaw
            );

            const { buildOpenRouterMessages } = await import(
                '~/utils/openrouter-build'
            );

            // Duplicate ensureThreadHistoryLoaded removed (already loaded earlier in this sendMessage invocation)
            const modelInputMessages: any[] = (effectiveMessages as any[]).map(
                (m: any) => ({ ...m })
            );
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
            const idx = messages.value.push(uiAssistant) - 1;
            const current = messages.value[idx]!; // UiChatMessage
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
            // Pane-scoped assistant received hook
            try {
                const mpApi: any = (globalThis as any).__or3MultiPaneApi;
                if (mpApi && mpApi.panes?.value) {
                    const pane = mpApi.panes.value.find(
                        (p: any) =>
                            p.mode === 'chat' &&
                            p.threadId === threadIdRef.value
                    );
                    if (pane)
                        hooks.doAction('ui.pane.msg:action:received', pane, {
                            id: finalized.id,
                            threadId: threadIdRef.value,
                            length: (incoming as string).length,
                            fileHashes: finalized.file_hashes || null,
                            reasoningLength: (current.reasoning_text || '')
                                .length,
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
                try {
                    const last = messages.value[messages.value.length - 1];
                    if (
                        last &&
                        last.role === 'assistant' &&
                        (last as any).pending
                    ) {
                        (last as any).pending = false;
                    }
                } catch {}
                await hooks.doAction('ai.chat.send:action:after', {
                    threadId: threadIdRef.value,
                    aborted: true,
                });
            } else {
                await hooks.doAction('ai.chat.error:action', {
                    threadId: threadIdRef.value,
                    stage: 'stream',
                    error: err,
                });
                try {
                    const last = messages.value[messages.value.length - 1];
                    if (
                        last &&
                        last.role === 'assistant' &&
                        (last as any).pending
                    ) {
                        messages.value.pop();
                    }
                    const lastUser = [...messages.value]
                        .reverse()
                        .find((m) => m.role === 'user');
                    const toast = useToast();
                    toast.add({
                        title: 'Message failed',
                        description: (err as any)?.message || 'Request failed',
                        color: 'error',
                        actions: lastUser
                            ? [
                                  {
                                      label: 'Retry',
                                      onClick: () => {
                                          if (lastUser?.id)
                                              retryMessage(lastUser.id as any);
                                      },
                                  },
                              ]
                            : undefined,
                        duration: 6000,
                    });
                } catch {}
                const e = err instanceof Error ? err : new Error(String(err));
                streamAcc.finalize({ error: e });
            }
        } finally {
            loading.value = false;
            abortController.value = null;
            setTimeout(() => {
                if (!loading.value && streamState.finalized) resetStream();
            }, 0);
        }
    }

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
            await hooks.doAction('ai.chat.retry:action:before', {
                threadId: threadIdRef.value,
                originalUserId: userMsg.id,
                originalAssistantId: assistant?.id,
                triggeredBy: target.role,
            });
            await db.transaction('rw', db.messages, async () => {
                await db.messages.delete(userMsg.id);
                if (assistant) await db.messages.delete(assistant.id);
            });
            rawMessages.value = rawMessages.value.filter(
                (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
            );
            messages.value = messages.value.filter(
                (m: any) => m.id !== userMsg.id && m.id !== assistant?.id
            );
            const originalText = (userMsg.data as any)?.content || '';
            let hashes: string[] = [];
            if (userMsg.file_hashes) {
                const { parseFileHashes } = await import('~/db/files-util');
                hashes = parseFileHashes(userMsg.file_hashes);
            }
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
            console.error('[useChat.retryMessage] failed', e);
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
        abort: () => {
            if (!loading.value || !abortController.value) return;
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {}
            streamAcc.finalize({ aborted: true });
        },
        clear,
    };
}
