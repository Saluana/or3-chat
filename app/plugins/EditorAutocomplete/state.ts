import { ref } from 'vue';

export default ref({
    isEnabled: true,
    isLoading: false,
    lastError: null as string | null,
    aiModel: 'openai/gpt-5-chat',
});
