import { computed, watch } from 'vue';
import { useLocalStorage } from '@vueuse/core';

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

function coerceStringOrNull(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
}

function isObj(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function sanitizeAiSettings(
    input: unknown,
    defaults: AiSettingsV1 = DEFAULT_AI_SETTINGS
): AiSettingsV1 {
    const inObj = isObj(input) ? input : {} as Record<string, unknown>;
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

// Use VueUse's useLocalStorage with a custom serializer for sanitization
const storedSettings = useLocalStorage<AiSettingsV1>(
    AI_SETTINGS_STORAGE_KEY,
    { ...DEFAULT_AI_SETTINGS },
    {
        deep: true,
        listenToStorageChanges: true,
        // Custom serializer to ensure sanitization on read
        serializer: {
            read: (raw: string): AiSettingsV1 => {
                try {
                    const parsed = JSON.parse(raw);
                    return sanitizeAiSettings(parsed);
                } catch {
                    return { ...DEFAULT_AI_SETTINGS };
                }
            },
            write: (value: AiSettingsV1): string => {
                return JSON.stringify(value);
            },
        },
    }
);

/** Public composable API */
export function useAiSettings() {
    const current = computed(() => storedSettings.value);

    function set(patch: Partial<AiSettingsV1>) {
        const merged = sanitizeAiSettings({
            ...storedSettings.value,
            ...patch,
        });
        storedSettings.value = merged;
    }

    function reset() {
        storedSettings.value = { ...DEFAULT_AI_SETTINGS };
    }

    function load(): AiSettingsV1 {
        // Return current stored value (useLocalStorage handles syncing)
        return storedSettings.value || DEFAULT_AI_SETTINGS;
    }

    return {
        settings: current,
        set,
        reset,
        load,
    };
}

