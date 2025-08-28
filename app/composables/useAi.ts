import { ref } from 'vue';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { create, db, tx, upsert } from '~/db';
import { createOrRefFile } from '~/db/files';
import { serializeFileHashes, parseFileHashes } from '~/db/files-util';

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
    id?: string; // DB id when persisted
    stream_id?: string; // streaming correlation id for assistant
    file_hashes?: string | null; // serialized JSON string (UI convenience)
}

interface SendMessageParams {
    files?: {
        type: string;
        url: string;
    }[];
    model?: string;
    file_hashes?: string[]; // pre-computed content hashes for persistence
    extraTextParts?: string[]; // additional large pasted text blocks
    online: boolean;
}

export function useChat(msgs: ChatMessage[] = [], initialThreadId?: string) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();
    const threadIdRef = ref<string | undefined>(initialThreadId);
    // Track whether we've loaded full history for a given thread id
    const historyLoadedFor = ref<string | null>(null);

    async function ensureThreadHistoryLoaded() {
        if (!threadIdRef.value) return;
        if (historyLoadedFor.value === threadIdRef.value) return;
        try {
            const DexieMod = (await import('dexie')).default;
            const all = await db.messages
                .where('[thread_id+index]')
                .between(
                    [threadIdRef.value, DexieMod.minKey],
                    [threadIdRef.value, DexieMod.maxKey]
                )
                .filter((m: any) => !m.deleted)
                .toArray();
            // Sort by index just in case
            all.sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
            const existingIds = new Set(messages.value.map((m) => m.id));
            for (const m of all) {
                if (existingIds.has(m.id)) continue;
                messages.value.push({
                    role: m.role,
                    content: (m as any)?.data?.content || '',
                    id: m.id,
                    stream_id: (m as any).stream_id,
                    file_hashes: (m as any).file_hashes,
                } as any);
            }
            historyLoadedFor.value = threadIdRef.value;
        } catch (e) {
            console.warn('[useChat.ensureThreadHistoryLoaded] failed', e);
        }
    }

    // Enhanced OpenRouter SSE streaming wrapper (text + images + final message images)
    type ORStreamEvent =
        | { type: 'text'; text: string }
        | { type: 'image'; url: string; final?: boolean; index?: number }
        | { type: 'done' };
    async function* openRouterStream(params: {
        apiKey: string;
        model: string;
        orMessages: any[]; // already built OR format messages
        modalities: string[];
        signal?: AbortSignal;
    }): AsyncGenerator<ORStreamEvent, void, unknown> {
        const { apiKey, model, orMessages, modalities, signal } = params;
        const DEBUG_SSE = true;
        if (DEBUG_SSE) {
            // Summarize outgoing payload (avoid dumping full base64)
            const imgCounts = orMessages.map((m: any, i: number) => ({
                i,
                role: m.role,
                images: m.content.filter((p: any) => p.type === 'image_url')
                    .length,
                textLen: (
                    m.content.find((p: any) => p.type === 'text')?.text || ''
                ).length,
            }));
            const totalImages = imgCounts.reduce(
                (a: number, b: any) => a + b.images,
                0
            );
            console.log('[openRouterStream] request summary', {
                model,
                modalities,
                messages: orMessages.length,
                totalImages,
                imgCounts,
            });
        }
        const body = {
            model,
            messages: orMessages,
            modalities,
            stream: true,
        } as any;
        const resp = await fetch(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal,
            }
        );
        if (!resp.ok || !resp.body)
            throw new Error(
                `OpenRouter request failed ${resp.status} ${resp.statusText}`
            );
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const emittedImages = new Set<string>();
        let lineIndex = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const raw of lines) {
                const line = raw.trim();
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (DEBUG_SSE) {
                    console.log('[openRouterStream] SSE line', {
                        idx: lineIndex++,
                        size: data.length,
                        doneToken: data === '[DONE]',
                        prefix: data.slice(0, 80),
                    });
                }
                if (!data) continue;
                if (data === '[DONE]') {
                    yield { type: 'done' };
                    continue;
                }
                try {
                    const parsed = JSON.parse(data);
                    const choices = parsed.choices || [];
                    if (DEBUG_SSE) {
                        console.log('[openRouterStream] parsed', {
                            choices: choices.length,
                            hasUsage: !!parsed.usage,
                            firstChoiceKeys: Object.keys(choices[0] || {}),
                        });
                    }
                    for (const choice of choices) {
                        const delta = choice.delta || {};
                        if (DEBUG_SSE) {
                            const deltaKeys = Object.keys(delta || {});
                            console.log('[openRouterStream] delta', {
                                deltaKeys,
                                hasDeltaImages: Array.isArray(delta.images)
                                    ? delta.images.length
                                    : 0,
                                hasMessageImages: Array.isArray(
                                    choice.message?.images
                                )
                                    ? choice.message.images.length
                                    : 0,
                            });
                        }
                        // Text variants
                        if (Array.isArray(delta.content)) {
                            for (const part of delta.content) {
                                if (part?.type === 'text' && part.text) {
                                    yield { type: 'text', text: part.text };
                                }
                            }
                        }
                        if (typeof delta.text === 'string') {
                            yield { type: 'text', text: delta.text };
                        }
                        if (typeof delta.content === 'string') {
                            yield { type: 'text', text: delta.content };
                        }
                        if (Array.isArray(delta.images)) {
                            let ix = 0;
                            for (const img of delta.images) {
                                const url = img?.image_url?.url || img?.url;
                                if (url && !emittedImages.has(url)) {
                                    emittedImages.add(url);
                                    if (DEBUG_SSE)
                                        console.log(
                                            '[openRouterStream] emit delta image',
                                            { urlPreview: url.slice(0, 60) }
                                        );
                                    yield { type: 'image', url, index: ix++ };
                                }
                            }
                        }
                        // Final message images
                        const finalImages = choice.message?.images;
                        if (Array.isArray(finalImages)) {
                            let fIx = 0;
                            for (const img of finalImages) {
                                const url = img?.image_url?.url || img?.url;
                                if (url && !emittedImages.has(url)) {
                                    emittedImages.add(url);
                                    if (DEBUG_SSE)
                                        console.log(
                                            '[openRouterStream] emit final image',
                                            { urlPreview: url.slice(0, 60) }
                                        );
                                    yield {
                                        type: 'image',
                                        url,
                                        final: true,
                                        index: fIx++,
                                    };
                                }
                            }
                        }
                    }
                } catch {
                    // ignore invalid json
                    if (DEBUG_SSE)
                        console.warn('[openRouterStream] JSON parse failed');
                }
            }
        }
        yield { type: 'done' };
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
        console.log('[useChat.sendMessage] invoked', {
            contentPreview: content.slice(0, 40),
            contentLength: content.length,
            paramsKeys: Object.keys(sendMessagesParams || {}),
        });
        if (!apiKey.value) {
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

        // Before we build the payload ensure entire thread history (including prior assistant images) is resident
        await ensureThreadHistoryLoaded();

        // Merge prior assistant images (file hashes) into this outgoing user message so model sees them as user inputs
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

        let { files, model, file_hashes, extraTextParts, online } =
            sendMessagesParams;
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

        if (online === true) {
            model = model + ':online';
        }

        // 1) Filter hook for outgoing text
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );

        // 2) Persist user message to DB (you can keep storing just the text; attachments optional)
        // Merge assistant hashes with provided file_hashes (dedupe)
        if (assistantHashes.length) {
            const existing = Array.isArray(file_hashes) ? file_hashes : [];
            const merged = Array.from(
                new Set([...(existing as any), ...assistantHashes])
            );
            file_hashes = merged;
            console.log(
                '[useChat.sendMessage] merged assistant images into user message',
                {
                    assistantHashes: assistantHashes.length,
                    mergedTotal: merged.length,
                }
            );
        }

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
            ...(extraTextParts || []).map<ContentPart>((t) => ({
                type: 'text',
                text: t,
            })),
            ...(files ?? []).map<ContentPart>((f) => {
                if ((f.type ?? '').startsWith('image/')) {
                    return { type: 'image', image: f.url, mediaType: f.type };
                }
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
            id: (userDbMsg as any).id,
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

            // Let callers modify messages before sending (raw form)
            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messages.value
            );

            // Build OpenRouter message objects (includes historical images)
            const { buildOpenRouterMessages, decideModalities } = await import(
                '~/utils/openrouter-build'
            );
            // Ensure again in case another message slipped in concurrently
            await ensureThreadHistoryLoaded();
            // Build working copy; remove assistant file_hashes we just migrated so builder prioritizes user-role images
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
                    debug: true,
                }
            );
            // Post-build global image trim: keep only the last 5 images (most recent in history)
            const MAX_HISTORY_IMAGES = 5;
            try {
                const totalImagesPre = orMessages.reduce(
                    (a: number, m: any) =>
                        a +
                        m.content.filter((p: any) => p.type === 'image_url')
                            .length,
                    0
                );
                if (totalImagesPre > MAX_HISTORY_IMAGES) {
                    let toDrop = totalImagesPre - MAX_HISTORY_IMAGES;
                    for (const m of orMessages) {
                        if (toDrop <= 0) break;
                        const newContent: any[] = [];
                        for (const part of m.content) {
                            if (part.type === 'image_url' && toDrop > 0) {
                                toDrop--;
                                continue; // drop oldest first (iterating chronological order)
                            }
                            newContent.push(part);
                        }
                        m.content = newContent;
                    }
                    const totalImagesPost = orMessages.reduce(
                        (a: number, m: any) =>
                            a +
                            m.content.filter((p: any) => p.type === 'image_url')
                                .length,
                        0
                    );
                    console.log(
                        '[useChat.sendMessage] trimmed history images',
                        {
                            before: totalImagesPre,
                            after: totalImagesPost,
                            kept: MAX_HISTORY_IMAGES,
                        }
                    );
                }
            } catch (e) {
                console.warn('[useChat.sendMessage] image trim failed', e);
            }
            console.log('[useChat.sendMessage] OR messages built', {
                total: orMessages.length,
                imagesTotal: orMessages.reduce(
                    (a: number, m: any) =>
                        a +
                        m.content.filter((p: any) => p.type === 'image_url')
                            .length,
                    0
                ),
                perMessage: orMessages.map((m: any, i: number) => ({
                    i,
                    role: m.role,
                    images: m.content.filter((p: any) => p.type === 'image_url')
                        .length,
                    textPreview: (
                        m.content.find((p: any) => p.type === 'text')?.text ||
                        ''
                    ).slice(0, 40),
                })),
            });
            // Always enable both text and image modalities by default
            let modalities = ['text', 'image'];
            console.log(
                '[useChat.sendMessage] modalities forced (always on)',
                modalities
            );

            // Prepare assistant placeholder in DB and include a stream id
            const streamId = newId();
            const assistantDbMsg = await tx.appendMessage({
                thread_id: threadIdRef.value!,
                role: 'assistant',
                stream_id: streamId,
                data: { content: '', attachments: [] },
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

            // 5) Send to AI with custom streaming wrapper (supports text + images)
            const stream = openRouterStream({
                apiKey: apiKey.value!,
                model: modelId,
                orMessages,
                modalities,
            });
            console.log('[useChat.sendMessage] streaming request', {
                modelId,
                modalities,
                lastUserTextPreview: (() => {
                    const rev = [...orMessages].reverse();
                    const u = rev.find((m: any) => m.role === 'user');
                    if (!u) return undefined;
                    const textPart = (u.content as any[]).find(
                        (p) => p.type === 'text'
                    );
                    return textPart
                        ? (textPart.text || '').slice(0, 80)
                        : undefined;
                })(),
            });

            // 6) Create assistant placeholder in UI
            const idx =
                messages.value.push({
                    role: 'assistant',
                    content: '',
                    id: (assistantDbMsg as any).id,
                    stream_id: streamId,
                }) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100;
            let lastPersistAt = 0;

            const assistantFileHashes: string[] = [];
            const MAX_INLINE_IMAGES = 6; // guardrail
            function dataUrlToBlob(dataUrl: string): Blob | null {
                try {
                    const m: RegExpExecArray | null =
                        /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
                    if (!m) return null;
                    const mime: string = m[1] as string;
                    const b64: string = m[2] as string;
                    const bin = atob(b64);
                    const len = bin.length;
                    const arr = new Uint8Array(len);
                    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
                    return new Blob([arr], { type: mime });
                } catch {
                    return null;
                }
            }

            for await (const ev of stream) {
                if (chunkIndex === 0)
                    console.log('[useChat.sendMessage] streaming started');
                if (ev.type === 'text') {
                    const delta = ev.text;
                    await hooks.doAction('ai.chat.stream:action:delta', delta, {
                        threadId: threadIdRef.value,
                        assistantId: assistantDbMsg.id,
                        streamId,
                        deltaLength: String(delta ?? '').length,
                        totalLength:
                            (typeof current.content === 'string'
                                ? (current.content as string).length
                                : (current.content as ContentPart[])
                                      .filter((p) => p.type === 'text')
                                      .map((p: any) => p.text || '')
                                      .join('').length) +
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
                    console.log(
                        '[useChat.sendMessage] image delta received',
                        ev.url.slice(0, 60)
                    );
                    try {
                        let first10 = '';
                        if (ev.url.startsWith('data:')) {
                            const idx = ev.url.indexOf('base64,');
                            if (idx !== -1)
                                first10 = ev.url.slice(idx + 7, idx + 17);
                            else first10 = ev.url.slice(0, 10);
                        } else {
                            first10 = ev.url.slice(0, 10);
                        }
                        console.log('IMAGE FOUND', first10);
                    } catch {}
                    if (typeof current.content === 'string') {
                        current.content = [
                            { type: 'text', text: current.content as string },
                            {
                                type: 'image',
                                image: ev.url,
                                mediaType: 'image/png',
                            },
                        ];
                    } else if (Array.isArray(current.content)) {
                        (current.content as ContentPart[]).push({
                            type: 'image',
                            image: ev.url,
                            mediaType: 'image/png',
                        });
                    }
                    // Persist image as file (data URL or remote URL fetch if needed)
                    if (assistantFileHashes.length < MAX_INLINE_IMAGES) {
                        let blob: Blob | null = null;
                        if (ev.url.startsWith('data:image/')) {
                            blob = dataUrlToBlob(ev.url);
                        } else if (/^https?:/.test(ev.url)) {
                            try {
                                // Fetch remote image (may fail due to CORS; ignore errors)
                                const resp = await fetch(ev.url);
                                if (resp.ok) blob = await resp.blob();
                            } catch {}
                        }
                        if (blob) {
                            try {
                                const meta = await createOrRefFile(
                                    blob,
                                    'gen-image'
                                );
                                assistantFileHashes.push(meta.hash);
                                // Update DB message with new file_hashes incrementally
                                const serialized =
                                    serializeFileHashes(assistantFileHashes);
                                const updatedMsg = {
                                    ...assistantDbMsg,
                                    file_hashes: serialized,
                                    updated_at: nowSec(),
                                } as any;
                                await upsert.message(updatedMsg);
                                // Also update in-memory assistant message so future requests include these images
                                (current as any).file_hashes = serialized;
                            } catch (e) {
                                console.warn(
                                    '[useChat.sendMessage] failed to persist generated image',
                                    e
                                );
                            }
                        }
                    }
                } else if (ev.type === 'done') {
                    // no-op, handled after loop
                }
                const now = Date.now();
                if (now - lastPersistAt >= WRITE_INTERVAL_MS) {
                    const textContent =
                        typeof current.content === 'string'
                            ? (current.content as string)
                            : (current.content as ContentPart[])
                                  .filter((p) => p.type === 'text')
                                  .map((p: any) => p.text || '')
                                  .join('');
                    const updated = {
                        ...assistantDbMsg,
                        data: {
                            ...((assistantDbMsg as any).data || {}),
                            content: textContent,
                        },
                        file_hashes: assistantFileHashes.length
                            ? serializeFileHashes(assistantFileHashes)
                            : (assistantDbMsg as any).file_hashes,
                        updated_at: nowSec(),
                    } as any;
                    await upsert.message(updated);
                    if (assistantFileHashes.length) {
                        (current as any).file_hashes =
                            serializeFileHashes(assistantFileHashes);
                    }
                    lastPersistAt = now;
                }
            }

            // Final post-processing of full assistant text
            const fullText =
                typeof current.content === 'string'
                    ? (current.content as string)
                    : (current.content as ContentPart[])
                          .filter((p) => p.type === 'text')
                          .map((p: any) => p.text || '')
                          .join('');
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                fullText,
                threadIdRef.value
            );
            if (typeof current.content === 'string') {
                current.content = incoming;
            } else if (Array.isArray(current.content)) {
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
                },
                file_hashes: assistantFileHashes.length
                    ? serializeFileHashes(assistantFileHashes)
                    : (assistantDbMsg as any).file_hashes,
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);
            if (assistantFileHashes.length) {
                (current as any).file_hashes =
                    serializeFileHashes(assistantFileHashes);
            }
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

    // Retry logic: remove prior user (and its assistant) OR assistant (resolve to preceding user) then resend user prompt at end
    async function retryMessage(messageId: string, modelOverride?: string) {
        if (loading.value) return;
        if (!threadIdRef.value) return;
        try {
            let target: any = await db.messages.get(messageId);
            if (!target) return;
            if (target.thread_id !== threadIdRef.value) return;

            // If assistant clicked, locate preceding user message
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
    };
}
