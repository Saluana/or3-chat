import { ref } from 'vue';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { useUserApiKey } from './useUserApiKey';

export function useChat(
    msgs: { role: 'user' | 'assistant'; content: string }[] = []
) {
    const messages = ref(msgs);
    const loading = ref(false);
    const { apiKey } = useUserApiKey();

    if (!apiKey.value) {
        throw new Error('No API key set');
    }

    const openrouter = createOpenRouter({
        apiKey: apiKey.value,
    });

    async function sendMessage(content: string) {
        if (!apiKey.value) {
            throw new Error('No API key set');
        }

        messages.value.push({ role: 'user', content });
        loading.value = true;

        const result = streamText({
            model: openrouter.chat('openai/gpt-4'), // example model
            messages: messages.value,
        });

        // stream result as it arrives
        let fullResponse = '';
        for await (const delta of result.textStream) {
            fullResponse += delta;
        }

        messages.value.push({ role: 'assistant', content: fullResponse });
        loading.value = false;
    }

    return { messages, sendMessage, loading };
}
