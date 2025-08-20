import { ref } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { useUserApiKey } from './useUserApiKey';
import { useHooks } from './useHooks';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export function useChat(msgs: ChatMessage[] = []) {
    const messages = ref(msgs);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();
    const hooks = useHooks();

    if (!apiKey.value) {
        return console.log('No API key set');
    }

    const openrouter = createOpenRouter({
        apiKey: apiKey.value,
    });

    async function sendMessage(content: string) {
        if (!apiKey.value) {
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
                'openai/gpt-4'
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
                model: openrouter.chat(modelId),
                messages: effectiveMessages,
            });

            // stream result as it arrives
            let fullResponse = '';
            for await (const delta of result.textStream) {
                await hooks.doAction('ai.chat.stream:action:delta', delta);
                fullResponse += delta;
            }

            const incoming = await hooks.applyFilters(
                'ui.chat.message:filter:incoming',
                fullResponse
            );
            messages.value.push({ role: 'assistant', content: incoming });

            await hooks.doAction('ai.chat.send:action:after', {
                request: { content: outgoing, modelId },
                response: incoming,
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
