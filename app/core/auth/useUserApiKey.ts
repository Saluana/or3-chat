import { computed } from 'vue';
import { db } from '~/db';
import { state } from '~/state/global';

export function useUserApiKey() {
    // Read from Dexie on client without awaiting the composable
    if (import.meta.client) {
        db.kv
            .where('name')
            .equals('openrouter_api_key')
            .first()
            .then((rec) => {
                if (rec && typeof rec.value === 'string') {
                    state.value.openrouterKey = rec.value;
                } else if (rec && rec.value == null) {
                    state.value.openrouterKey = null;
                }
            })
            .catch(() => {
                /* noop */
            });
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
