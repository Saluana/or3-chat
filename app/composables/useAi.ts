import { ref, computed } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { create, db, tx, upsert } from '~/db';

const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';

// ADD these near your imports
export type TextPart = { type: 'text'; text: string };

export type ImagePart = {
    type: 'image';
    // Base64 data URL (recommended) or raw base64/bytes — data URL is easiest across providers
    image: string | Uint8Array | Buffer;
    mediaType?: string; // e.g. 'image/png'
};

export type FilePart = {
    type: 'file';
    data: string | Uint8Array | Buffer; // base64 data URL or bytes
    mediaType: string; // required for files
    name?: string;
};

export type ContentPart = TextPart | ImagePart | FilePart;

// ⬅️ change your ChatMessage to allow either a plain string OR an array of parts
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string | ContentPart[];
}

interface SendMessageParams {
    files?: {
        type: string;
        url: string;
    }[];
    model?: string;
    file_hashes?: string[]; // pre-computed content hashes for persistence
}

export function useChat(msgs: ChatMessage[] = [], initialThreadId?: string) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();
    const threadIdRef = ref<string | undefined>(initialThreadId);

    // Make provider reactive so it initializes when apiKey arrives later
    const openrouter = computed(() =>
        apiKey.value ? createOpenRouter({ apiKey: apiKey.value }) : null
    );

    async function sendMessage(
        content: string,
        sendMessagesParams: SendMessageParams = {
            files: [],
            model: DEFAULT_AI_MODEL,
            file_hashes: [],
        }
    ) {
        console.log('[useChat.sendMessage] invoked', {
            contentPreview: content.slice(0, 40),
            contentLength: content.length,
            paramsKeys: Object.keys(sendMessagesParams || {}),
        });
        if (!apiKey.value || !openrouter.value) {
            return console.log('No API key set');
        }

        if (!threadIdRef.value) {
            const newThread = await create.thread({
                title: content.split(' ').slice(0, 6).join(' ') || 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
            });
            threadIdRef.value = newThread.id;
        }

        let { files, model, file_hashes } = sendMessagesParams;
        const rawParams: any = sendMessagesParams as any;
        if ((!files || files.length === 0) && rawParams?.images?.length) {
            console.warn(
                '[useChat.sendMessage] images[] provided without files[]. Auto-converting images[] -> files[].',
                { imageCount: rawParams.images.length }
            );
            const inferType = (u: string, provided?: string) => {
                if (provided && provided.startsWith('image/')) return provided;
                const m = /^data:([^;]+);/i.exec(u);
                if (m) return m[1];
                const lower = (u.split('?')[0] || '').toLowerCase();
                const ext = lower.substring(lower.lastIndexOf('.') + 1);
                const map: Record<string, string> = {
                    jpg: 'image/jpeg',
                    jpeg: 'image/jpeg',
                    png: 'image/png',
                    webp: 'image/webp',
                    gif: 'image/gif',
                    svg: 'image/svg+xml',
                    avif: 'image/avif',
                    heic: 'image/heic',
                    heif: 'image/heif',
                    bmp: 'image/bmp',
                    tif: 'image/tiff',
                    tiff: 'image/tiff',
                    ico: 'image/x-icon',
                };
                return map[ext] || 'image/png';
            };
            files = rawParams.images.map((img: any) => {
                const url = typeof img === 'string' ? img : img.url;
                const provided = typeof img === 'object' ? img.type : undefined;
                return { type: inferType(url, provided), url } as any;
            });
        }
        if (files?.length) {
            console.log(
                '[useChat.sendMessage] files received',
                files.map((f) => ({
                    type: f.type,
                    urlPreview: (f.url || '').slice(0, 50),
                }))
            );
        }
        if (!model) model = DEFAULT_AI_MODEL;

        // 1) Filter hook for outgoing text
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        // 2) Persist user message to DB (you can keep storing just the text; attachments optional)
        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing, attachments: files ?? [] },
            file_hashes:
                file_hashes && file_hashes.length
                    ? (file_hashes as any)
                    : undefined,
        });

        // 3) Build the parts array: text part first, then image/file parts
        const parts: ContentPart[] = [
            { type: 'text', text: outgoing },
            ...(files ?? []).map<ContentPart>((f) => {
                // If you're only sending images, you can treat all as ImagePart.
                // Use data URLs like `data:image/png;base64,...` in f.url for best compatibility.
                if ((f.type ?? '').startsWith('image/')) {
                    return { type: 'image', image: f.url, mediaType: f.type };
                }
                // Fallback for non-image files:
                return { type: 'file', data: f.url, mediaType: f.type };
            }),
        ];

        console.log('[useChat.sendMessage] constructed parts', {
            totalParts: parts.length,
            types: parts.map((p) => p.type),
        });

        // 4) Push to UI state with parts (✅ fixes your TS error)
        messages.value.push({
            role: 'user',
            content: parts,
            // Attach file_hashes so UI can render thumbnails lazily
            file_hashes: userDbMsg.file_hashes,
        } as any);

        loading.value = true;

        try {
            const startedAt = Date.now();

            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                model
            );

            // Let callers modify messages before sending
            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messages.value
            );

            // Prepare assistant placeholder in DB and include a stream id
            const streamId = newId();
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: streamId,
                data: { content: '' },
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

            // 5) Send to AI — OpenRouter vision models accept multiple images as separate parts
            const result = streamText({
                model: openrouter.value!.chat(modelId),
                messages: effectiveMessages as any, // your parts are already in the right shape
            });

            // 6) Create assistant placeholder in UI
            const idx =
                messages.value.push({ role: 'assistant', content: '' }) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100;
            let lastPersistAt = 0;

            for await (const delta of result.textStream) {
                if (chunkIndex === 0) {
                    console.log('[useChat.sendMessage] streaming started');
                }
                await hooks.doAction('ai.chat.stream:action:delta', delta, {
                    threadId: threadIdRef.value,
                    assistantId: assistantDbMsg.id,
                    streamId,
                    deltaLength: String(delta ?? '').length,
                    totalLength:
                        (current.content as string)?.length +
                        String(delta ?? '').length,
                    chunkIndex: chunkIndex++,
                });

                current.content =
                    ((current.content as string) ?? '') + String(delta ?? '');

                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: current.content,
                        },
                        updated_at: nowSec(),
                    } as any;
                    await upsert.message(updated);
                    lastPersistAt = now;
                }
            }

            // Final post-processing of full assistant text
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                current.content,
                threadIdRef.value
            );
            current.content = incoming;

            const finalized = {
                ...assistantDbMsg,
                data: {
                    ...((assistantDbMsg as any).data || {}),
                    content: incoming,
                },
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);

            console.log('[useChat.sendMessage] stream completed', {
                totalLength: (incoming as string).length,
                durationMs: Date.now() - startedAt,
            });

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
            });
        } catch (err) {
            await hooks.doAction('ai.chat.error:action', {
                threadId: threadIdRef.value,
                stage: 'stream',
                error: err,
            });
            throw err;
        } finally {
            loading.value = false;
        }
    }

    return { messages, sendMessage, loading, threadId: threadIdRef };
}
