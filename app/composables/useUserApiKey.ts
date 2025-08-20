import { ref, computed } from 'vue';
import { kv } from '~/db';
import { state } from '~/state/global';

export async function useUserApiKey() {
    const key = await kv.get('openrouter_api_key');
    if (key) {
        state.value.openrouterKey = key.value as string;
    }

    function setKey(key: string) {
        state.value.openrouterKey = key;
    }

    function clearKey() {
        state.value.openrouterKey = null;
    }

    // Return a computed ref so callers can read `apiKey.value` and
    // still observe changes made to the shared state.
    const apiKey = computed(() => state.value.openrouterKey) as {
        readonly value: string | null;
    };

    return {
        apiKey,
        setKey,
        clearKey,
    };
}
