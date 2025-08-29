import { ref, readonly } from 'vue';
import { db } from '~/db';
import { setKvByName } from '~/db/kv';
import { useHooks } from './useHooks';

// Singleton state (module scope) so all importers share
const _defaultPromptId = ref<string | null>(null);
let _loaded = false;

async function loadOnce() {
    if (_loaded) return;
    _loaded = true;
    try {
        const rec = await db.kv
            .where('name')
            .equals('default_system_prompt_id')
            .first();
        if (rec && typeof rec.value === 'string' && rec.value) {
            _defaultPromptId.value = rec.value;
        } else {
            _defaultPromptId.value = null;
        }
    } catch {
        _defaultPromptId.value = null;
    }
}

export function useDefaultPrompt() {
    const hooks = useHooks();
    if (import.meta.client) loadOnce();

    async function setDefaultPrompt(id: string | null) {
        await loadOnce();
        const newId = id || null;
        _defaultPromptId.value = newId;
        await setKvByName('default_system_prompt_id', newId);
        await hooks.doAction('chat.systemPrompt.default:action:update', newId);
    }

    async function clearDefaultPrompt() {
        await setDefaultPrompt(null);
    }

    const defaultPromptId = readonly(_defaultPromptId);

    return {
        defaultPromptId,
        setDefaultPrompt,
        clearDefaultPrompt,
        // low-level ensure load (mainly for SSR safety guards)
        ensureLoaded: loadOnce,
    };
}

export async function getDefaultPromptId(): Promise<string | null> {
    try {
        const rec = await db.kv
            .where('name')
            .equals('default_system_prompt_id')
            .first();
        return rec && typeof rec.value === 'string' && rec.value
            ? rec.value
            : null;
    } catch {
        return null;
    }
}
