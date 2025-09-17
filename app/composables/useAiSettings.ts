import { ref, computed, watch } from 'vue';

// Types
export type ToolPolicy = 'allow' | 'disallow' | 'ask';

export interface StructuredOutputSettings {
    enabled: boolean;
    schemaName?: string;
    strict?: boolean;
    schema?: Record<string, any> | null;
}

export interface ProviderPrefs {
    allowFallbacks: boolean;
    requireParameters: boolean;
    dataCollection: 'allow' | 'deny';
    zdr: boolean;
}

export interface AiSettingsV1 {
    version: 1;
    masterSystemPrompt: string;
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null;
    temperature: number; // 0.0–2.0
    maxOutputTokens: number | null; // null = auto/unset
    jsonMode: boolean; // response_format: json_object when true (if supported)
    structuredOutput: StructuredOutputSettings; // response_format: json_schema when enabled and schema provided
    streaming: boolean;
    toolPolicy: ToolPolicy;
    toolChoiceDefault: 'auto' | 'none';
    parallelToolCalls: boolean;
    provider: ProviderPrefs;
}

export const AI_SETTINGS_STORAGE_KEY = 'or3.ai.settings.v1';

export const DEFAULT_AI_SETTINGS: AiSettingsV1 = {
    version: 1,
    masterSystemPrompt: '',
    defaultModelMode: 'lastSelected',
    fixedModelId: null,
    temperature: 0.7,
    maxOutputTokens: null,
    jsonMode: false,
    structuredOutput: {
        enabled: false,
        schema: null,
        strict: true,
        schemaName: 'structured_output',
    },
    streaming: true,
    toolPolicy: 'allow',
    toolChoiceDefault: 'auto',
    parallelToolCalls: true,
    provider: {
        allowFallbacks: true,
        requireParameters: false,
        dataCollection: 'allow',
        zdr: false,
    },
};

function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

function coerceBool(v: any) {
    return !!v;
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
    const out: any = isObj(input) ? { ...input } : {};
    out.version = 1 as const;
    // Scalars
    out.masterSystemPrompt =
        typeof out.masterSystemPrompt === 'string'
            ? out.masterSystemPrompt
            : '';
    out.defaultModelMode =
        out.defaultModelMode === 'fixed' ? 'fixed' : 'lastSelected';
    out.fixedModelId =
        out.defaultModelMode === 'fixed'
            ? coerceStringOrNull(out.fixedModelId)
            : null;
    const t =
        typeof out.temperature === 'number'
            ? out.temperature
            : defaults.temperature;
    out.temperature = +clamp(t, 0, 2).toFixed(3);
    if (
        out.maxOutputTokens === null ||
        out.maxOutputTokens === undefined ||
        out.maxOutputTokens === ''
    ) {
        out.maxOutputTokens = null;
    } else {
        const n = Number(out.maxOutputTokens);
        out.maxOutputTokens =
            Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }
    out.jsonMode = coerceBool(out.jsonMode);
    out.streaming = coerceBool(out.streaming);

    // Structured outputs
    const so = isObj(out.structuredOutput) ? out.structuredOutput : {};
    const soEnabled = coerceBool(so.enabled);
    const soStrict = so.strict === undefined ? true : coerceBool(so.strict);
    const soName =
        typeof so.schemaName === 'string' && so.schemaName.trim()
            ? so.schemaName
            : 'structured_output';
    const soSchema = isObj(so.schema)
        ? (so.schema as Record<string, any>)
        : null;
    out.structuredOutput = {
        enabled: !!soEnabled,
        strict: !!soStrict,
        schemaName: soName,
        schema: soSchema,
    } as StructuredOutputSettings;

    // Tools & provider
    out.toolPolicy =
        out.toolPolicy === 'disallow' || out.toolPolicy === 'ask'
            ? out.toolPolicy
            : 'allow';
    out.toolChoiceDefault = out.toolChoiceDefault === 'none' ? 'none' : 'auto';
    out.parallelToolCalls = coerceBool(out.parallelToolCalls);

    const prov = isObj(out.provider) ? out.provider : {};
    out.provider = {
        allowFallbacks: coerceBool(prov.allowFallbacks),
        requireParameters: coerceBool(prov.requireParameters),
        dataCollection: prov.dataCollection === 'deny' ? 'deny' : 'allow',
        zdr: coerceBool(prov.zdr),
    } as ProviderPrefs;

    // Ensure all missing keys from defaults are present
    const base: any = { ...defaults };
    for (const k of Object.keys(base)) {
        if (out[k] === undefined) out[k] = base[k];
    }
    return out as AiSettingsV1;
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
