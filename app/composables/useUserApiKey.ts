import { ref } from 'vue';

const apiKey = ref<string | null>(null);

export function useUserApiKey() {
    function setKey(key: string) {
        apiKey.value = key;
    }

    function clearKey() {
        apiKey.value = null;
    }

    return {
        apiKey,
        setKey,
        clearKey,
    };
}
