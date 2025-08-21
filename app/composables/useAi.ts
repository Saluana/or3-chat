import { ref, computed } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { nowSec, newId } from '~/db/util';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';
import { create, db, tx, upsert } from '~/db';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
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

    async function sendMessage(content: string) {
        if (!apiKey.value || !openrouter.value) {
            return console.log('No API key set');
        }

        if (!threadIdRef.value) {
            // Pass minimal fields; DB layer (ThreadCreateSchema) fills defaults
            const newThread = await create.thread({
                title: 'New Thread',
                last_message_at: nowSec(),
                parent_thread_id: null,
            });
            threadIdRef.value = newThread.id;
        }

        // Allow transforms on outgoing user content
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );
        // Persist user message first (DB fills defaults and index)
        const userDbMsg = await tx.appendMessage({
            thread_id: threadIdRef.value!,
            role: 'user',
            data: { content: outgoing },
        });
        messages.value.push({ role: 'user', content: outgoing });
        loading.value = true;

        try {
            const startedAt = Date.now();
            // Let callers change the model or the messages before sending
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                'openai/gpt-oss-120b'
            );
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

            const result = streamText({
                model: openrouter.value!.chat(modelId),
                messages: effectiveMessages,
            });

            // Create assistant placeholder in UI
            const idx =
                messages.value.push({ role: 'assistant', content: '' }) - 1;
            const current = messages.value[idx]!;
            let chunkIndex = 0;
            const WRITE_INTERVAL_MS = 100; // throttle window
            let lastPersistAt = 0;
            for await (const delta of result.textStream) {
                await hooks.doAction('ai.chat.stream:action:delta', delta, {
                    threadId: threadIdRef.value,
                    assistantId: assistantDbMsg.id,
                    streamId,
                    deltaLength: String(delta ?? '').length,
                    totalLength:
                        (current.content?.length ?? 0) +
                        String(delta ?? '').length,
                    chunkIndex: chunkIndex++,
                });
                current.content = (current.content ?? '') + String(delta ?? '');
                // Persist incremental content (throttled)
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

            // Final post-processing of the full assistant text
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                current.content,
                threadIdRef.value
            );
            current.content = incoming;
            // Finalize assistant message in DB (final upsert ensures last chunk is saved)
            const finalized = {
                ...assistantDbMsg,
                data: {
                    ...((assistantDbMsg as any).data || {}),
                    content: incoming,
                },
                updated_at: nowSec(),
            } as any;
            await upsert.message(finalized);

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
