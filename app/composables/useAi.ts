import { ref } from 'vue';
import { useToast } from '#imports';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { useActivePrompt } from './useActivePrompt';
import { getDefaultPromptId } from './useDefaultPrompt';
import { create, db, tx, upsert } from '~/db';
import { createOrRefFile } from '~/db/files';
import { serializeFileHashes, parseFileHashes } from '~/db/files-util';
import { getThreadSystemPrompt } from '~/db/threads';
import { getPrompt } from '~/db/prompts';

import type {
    ContentPart,
    ChatMessage,
    SendMessageParams,
    TextPart,
} from '~/utils/chat/types';
import {
    buildParts,
    getTextFromContent,
    mergeFileHashes,
    trimOrMessagesImages,
} from '~/utils/chat/messages';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import { ensureThreadHistoryLoaded } from '~/utils/chat/history';
import { dataUrlToBlob, inferMimeFromUrl } from '~/utils/chat/files';
import { promptJsonToString } from '~/utils/prompt-utils';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

export function useChat(
    msgs: ChatMessage[] = [],
    initialThreadId?: string,
    pendingPromptId?: string
) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    // Abort controller & state for active streaming request
    const abortController = ref<AbortController | null>(null);
    const aborted = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();
    const { activePromptContent } = useActivePrompt();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    const historyLoadedFor = ref<string | null>(null);

    // Helper to get system prompt content for current thread
    async function getSystemPromptContent(): Promise<string | null> {
        if (!threadIdRef.value) return null;

        try {
            const promptId = await getThreadSystemPrompt(threadIdRef.value);
            if (promptId) {
                // Get the prompt content from the database
                const prompt = await getPrompt(promptId);
                if (prompt) {
                    return promptJsonToString(prompt.content);
                }
            }
        } catch (error) {
            console.warn('Failed to load thread system prompt:', error);
        }

        // Fallback to global active prompt
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
            // Resolve system prompt for new thread: pending > default > null
            let effectivePromptId: string | null = pendingPromptId || null;
            if (!effectivePromptId) {
                try {
                    effectivePromptId = await getDefaultPromptId();
                } catch {
                    /* noop */
                }
            }
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
                system_prompt_id: effectivePromptId || null,
            });
            threadIdRef.value = newThread.id;
        }

        // Load full history so prior assistant images are available
        await ensureThreadHistoryLoaded(
            threadIdRef,
            historyLoadedFor,
            messages
        );

        // Merge prior assistant images (file hashes) into this outgoing user message
        const prevAssistant = [...messages.value]
            .reverse()
            .find((m) => m.role === 'assistant');
        let assistantHashes: string[] = [];
        if (prevAssistant?.file_hashes) {
            try {
                assistantHashes =
                    parseFileHashes(prevAssistant.file_hashes) || [];
            } catch {}
        }

        // Normalize params, allow legacy images[] input
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

        // 1) Filter outgoing text
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        // 2) Persist user message (merge assistant hashes if present)
        file_hashes = mergeFileHashes(file_hashes, assistantHashes);
        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes:
                file_hashes && file_hashes.length
                    ? (file_hashes as any)
                    : undefined,
        });

        // 3) Build parts array for UI
        const parts: ContentPart[] = buildParts(
            outgoing,
            files,
            extraTextParts
        );
        messages.value.push({
            role: 'user',
            content: parts,
            id: (userDbMsg as any).id,
            file_hashes: userDbMsg.file_hashes,
        } as any);

        loading.value = true;

        try {
            const startedAt = Date.now();

            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );

            // Inject system message if active prompt exists
            let messagesWithSystem = [...messages.value];
            const systemText = await getSystemPromptContent();
            if (systemText && systemText.trim()) {
                messagesWithSystem.unshift({
                    role: 'system',
                    content: systemText,
                    id: `system-${newId()}`,
                });
            }

            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messagesWithSystem
            );

            // Build OpenRouter message objects (images included)
            const { buildOpenRouterMessages } = await import(
                '~/utils/openrouter-build'
            );

            // Ensure history still loaded (in case of concurrent changes)
            await ensureThreadHistoryLoaded(
                threadIdRef,
                historyLoadedFor,
                messages
            );

            // Remove assistant file_hashes we just migrated so builder prefers user-role images
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
            // Dynamically decide modalities: include image only if we have image inputs
            // or the model name suggests image generation capability.
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

            // Prepare assistant placeholder (with stream id)
            const streamId = newId();
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: streamId,
                data: { content: '', attachments: [], reasoning_text: null },
            });

            await hooks.doAction('ai.chat.send:action:before', {
                threadId: threadIdRef.value,
                modelId,
                user: { id: userDbMsg.id, length: outgoing.length },
                assistant: { id: assistantDbMsg.id, streamId },
                messagesCount: Array.isArray(effectiveMessages)
                    ? (effectiveMessages as any[]).length
                    : undefined,
            });

            // Stream (setup abort controller)
            aborted.value = false;
            abortController.value = new AbortController();
            const stream = openRouterStream({
                apiKey: apiKey.value!,
                model: modelId,
                orMessages,
                modalities,
                signal: abortController.value.signal,
            });

            // Assistant placeholder in UI
            const idx =
                messages.value.push({
                    role: 'assistant',
                    content: '',
                    id: (assistantDbMsg as any).id,
                    stream_id: streamId,
                    pending: true,
                    reasoning_text: null,
                } as any) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100;
            let lastPersistAt = 0;

            const assistantFileHashes: string[] = [];
            // Reasoning persistence state (always persist now)
            // (Kept minimal; could reintroduce throttling if needed.)

            for await (const ev of stream) {
                if (ev.type === 'reasoning') {
                    // Accumulate reasoning (chain-of-thought style content)
                    if (current.reasoning_text === null)
                        current.reasoning_text = ev.text;
                    else current.reasoning_text += ev.text;
                    // Fire a dedicated hook so UI/extensions can surface or log reasoning separately
                    try {
                        await hooks.doAction(
                            'ai.chat.stream:action:reasoning',
                            ev.text,
                            {
                                threadId: threadIdRef.value,
                                assistantId: assistantDbMsg.id,
                                streamId,
                                reasoningLength:
                                    current.reasoning_text?.length || 0,
                            }
                        );
                    } catch {}
                } else if (ev.type === 'text') {
                    if ((current as any).pending)
                        (current as any).pending = false;
                    const delta = ev.text;
                    await hooks.doAction('ai.chat.stream:action:delta', delta, {
                        threadId: threadIdRef.value,
                        assistantId: assistantDbMsg.id,
                        streamId,
                        deltaLength: String(delta ?? '').length,
                        totalLength:
                            getTextFromContent(current.content)!.length +
                            String(delta ?? '').length,
                        chunkIndex: chunkIndex++,
                    });

                    if (typeof current.content === 'string') {
                        current.content = (current.content as string) + delta;
                    } else if (Array.isArray(current.content)) {
                        const firstText = (
                            current.content as ContentPart[]
                        ).find((p) => p.type === 'text') as
                            | TextPart
                            | undefined;
                        if (firstText) firstText.text += delta;
                        else
                            (current.content as ContentPart[]).push({
                                type: 'text',
                                text: delta,
                            });
                    }
                } else if (ev.type === 'image') {
                    if ((current as any).pending)
                        (current as any).pending = false;
                    // Add image to assistant message content
                    if (typeof current.content === 'string') {
                        current.content = [
                            { type: 'text', text: current.content as string },
                            {
                                type: 'image',
                                image: ev.url,
                                mediaType: 'image/png',
                            },
                        ];
                    } else {
                        (current.content as ContentPart[]).push({
                            type: 'image',
                            image: ev.url,
                            mediaType: 'image/png',
                        });
                    }

                    // Persist generated image file (data URL preferred; remote URLs best-effort)
                    if (assistantFileHashes.length < 6) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/'))
                            blob = dataUrlToBlob(ev.url);
                        else if (/^https?:/.test(ev.url)) {
                            try {
                                const r = await fetch(ev.url);
                                if (r.ok) blob = await r.blob();
                            } catch {
                                /* ignore CORS/network issues */
                            }
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
                                        // Only include reasoning_text if we've got some (avoid bloating empty rows)
                                        reasoning_text:
                                            current.reasoning_text ?? null,
                                    },
                                    file_hashes: serialized,
                                    updated_at: nowSec(),
                                } as any;
                                await upsert.message(updatedMsg);
                                (current as any).file_hashes = serialized;
                            } catch {
                                /* ignore persistence errors */
                            }
                        }
                    }
                }

                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const textContent =
                        getTextFromContent(current.content) || '';
                    const reasoningToPersist = current.reasoning_text ?? null;
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: textContent,
                            reasoning_text: reasoningToPersist,
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

            // Final post-process
            const fullText = getTextFromContent(current.content) || '';
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                fullText,
                threadIdRef.value
            );

            // Ensure pending cleared even if no chunks (empty response edge case)
            if ((current as any).pending) (current as any).pending = false;

            if (typeof current.content === 'string') {
                current.content = incoming as string;
            } else {
                const firstText = (current.content as ContentPart[]).find(
                    (p) => p.type === 'text'
                ) as TextPart | undefined;
                if (firstText) firstText.text = incoming as string;
                else
                    (current.content as ContentPart[]).unshift({
                        type: 'text',
                        text: incoming as string,
                    });
            }

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

            const endedAt = Date.now();
            // Log full finalized assistant response (100% complete)
            // Removed verbose success console.log to reduce noise/memory retention.
            try {
                // (Intentionally left blank for potential lightweight analytics hook)
            } catch {}
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
        } catch (err) {
            if (aborted.value) {
                // Graceful abort: keep partial content, clear pending, fire after hook with aborted flag
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
                // Dispatch error hook first
                await hooks.doAction('ai.chat.error:action', {
                    threadId: threadIdRef.value,
                    stage: 'stream',
                    error: err,
                });
                try {
                    // Remove any trailing pending assistant placeholder
                    const last = messages.value[messages.value.length - 1];
                    if (
                        last &&
                        last.role === 'assistant' &&
                        (last as any).pending
                    ) {
                        messages.value.pop();
                    }
                } catch {}
                // Present toast with retry option (if last user message exists)
                try {
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
                // Swallow error so caller doesn't need try/catch; UI already handled
                return;
            }
        } finally {
            loading.value = false;
            abortController.value = null;
        }
    }

    // Retry logic unchanged in behavior, simplified
    async function retryMessage(messageId: string, modelOverride?: string) {
        if (loading.value || !threadIdRef.value) return;

        try {
            const target: any = await db.messages.get(messageId);
            if (!target || target.thread_id !== threadIdRef.value) return;

            // If assistant clicked, resolve to preceding user message
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

            // Find assistant reply after the user (could be original target)
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

            (messages as any).value = (messages as any).value.filter(
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

            const tail = (messages as any).value.slice(-2);
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

    return {
        messages,
        sendMessage,
        retryMessage,
        loading,
        threadId: threadIdRef,
        abort: () => {
            if (!loading.value || !abortController.value) return;
            aborted.value = true;
            try {
                abortController.value.abort();
            } catch {}
        },
    };
}
