import { ref, computed } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export function useChat(msgs: ChatMessage[] = []) {
    const messages = ref<ChatMessage[]>([...msgs]);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();

    // Make provider reactive so it initializes when apiKey arrives later
    const openrouter = computed(() =>
        apiKey.value ? createOpenRouter({ apiKey: apiKey.value }) : null
    );

    async function sendMessage(content: string) {
        if (!apiKey.value || !openrouter.value) {
            return console.log('No API key set');
        }

        // Allow transforms on outgoing user content
        const outgoing = await hooks.applyFilters(
            'ui.chat.message:filter:outgoing',
            content
        );
        messages.value.push({ role: 'user', content: outgoing });
        loading.value = true;

        try {
            // Let callers change the model or the messages before sending
            const modelId = await hooks.applyFilters(
                'ai.chat.model:filter:select',
                'openai/gpt-oss-120b'
            );
            const effectiveMessages = await hooks.applyFilters(
                'ai.chat.messages:filter:input',
                messages.value
            );

            await hooks.doAction('ai.chat.send:action:before', {
                content: outgoing,
                messages: effectiveMessages,
                modelId,
            });

            const result = streamText({
                model: openrouter.value!.chat(modelId),
                messages: effectiveMessages,
            });

            // Stream result live into a placeholder assistant message
            const idx =
                messages.value.push({ role: 'assistant', content: '' }) - 1;
            const current = messages.value[idx]!;
            for await (const delta of result.textStream) {
                await hooks.doAction('ai.chat.stream:action:delta', delta);
                current.content = (current.content ?? '') + String(delta ?? '');
            }

            // Final post-processing of the full assistant text
            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                current.content
            );
            current.content = incoming;

            await hooks.doAction('ai.chat.send:action:after', {
                request: { content: outgoing, modelId },
                response: current.content,
            });
        } catch (err) {
            await hooks.doAction('ai.chat.error:action', err);
            throw err;
        } finally {
            loading.value = false;
        }
    }

    return { messages, sendMessage, loading };
}
