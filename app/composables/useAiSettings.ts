import { ref, computed, watch } from 'vue';

// Minimal settings schema per design
export interface AiSettingsV1 {
    version: 1;
    masterSystemPrompt: string; // may be ''
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null; // null unless defaultModelMode === 'fixed'
}

export const AI_SETTINGS_STORAGE_KEY = 'or3.ai.settings.v1';

export const DEFAULT_AI_SETTINGS: AiSettingsV1 = {
    version: 1,
    masterSystemPrompt: '',
    defaultModelMode: 'lastSelected',
    fixedModelId: null,
};

function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function coerceStringOrNull(v: any) {
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : String(v);
}

function isObj(v: any): v is Record<string, any> {
    return v && typeof v === 'object' && !Array.isArray(v);
}

export function sanitizeAiSettings(
    input: any,
    defaults: AiSettingsV1 = DEFAULT_AI_SETTINGS
): AiSettingsV1 {
    const inObj: any = isObj(input) ? input : {};
    const masterSystemPrompt =
        typeof inObj.masterSystemPrompt === 'string'
            ? inObj.masterSystemPrompt
            : '';
    const defaultModelMode: 'lastSelected' | 'fixed' =
        inObj.defaultModelMode === 'fixed' ? 'fixed' : 'lastSelected';
    const fixedModelId =
        defaultModelMode === 'fixed'
            ? coerceStringOrNull(inObj.fixedModelId)
            : null;

    // Build a strictly minimal object (drop unknown keys)
    const result: AiSettingsV1 = {
        version: 1,
        masterSystemPrompt,
        defaultModelMode,
        fixedModelId: fixedModelId ?? defaults.fixedModelId,
    };
    return result;
}

function persist(settings: AiSettingsV1) {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ai-settings] failed to persist settings', e);
    }
}

function loadFromStorage(): AiSettingsV1 | null {
    if (!isBrowser()) return null;
    try {
        const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return sanitizeAiSettings(parsed);
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[ai-settings] failed to parse stored settings', e);
        return null;
    }
}

// HMR-safe singleton store
const g: any = globalThis as any;
if (!g.__or3AiSettingsStoreV1) {
    g.__or3AiSettingsStoreV1 = {
        settings: ref<AiSettingsV1>({ ...DEFAULT_AI_SETTINGS }),
        loaded: false,
    };
}

const store = g.__or3AiSettingsStoreV1 as {
    settings: ReturnType<typeof ref<AiSettingsV1>>;
    loaded: boolean;
};

/** Public composable API */
export function useAiSettings() {
    if (!store.loaded && isBrowser()) {
        const loaded = loadFromStorage();
        if (loaded) store.settings.value = loaded;
        store.loaded = true;
    }

    const current = computed(() => store.settings.value);

    function set(patch: Partial<AiSettingsV1>) {
        const merged = sanitizeAiSettings({
            ...store.settings.value,
            ...patch,
        });
        store.settings.value = merged;
        persist(merged);
    }

    function reset() {
        store.settings.value = { ...DEFAULT_AI_SETTINGS };
        persist(store.settings.value);
    }

    function load(): AiSettingsV1 {
        const fresh = loadFromStorage();
        if (fresh) store.settings.value = fresh;
        // Ensure a defined return even in edge cases
        return (store.settings.value || DEFAULT_AI_SETTINGS) as AiSettingsV1;
    }

    // Persist on deep changes (for direct mutations outside set())
    if (isBrowser()) {
        watch(
            () => store.settings.value,
            (v) => {
                // Persist as-is to avoid loops; consumers should prefer set() for sanitization.
                try {
                    localStorage.setItem(
                        AI_SETTINGS_STORAGE_KEY,
                        JSON.stringify(v)
                    );
                } catch (e) {
                    console.warn('[ai-settings] persist (watch) failed', e);
                }
            },
            { deep: true }
        );
    }

    return {
        settings: current,
        set,
        reset,
        load,
    };
}
