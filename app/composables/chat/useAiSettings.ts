/**
 * @module composables/chat/useAiSettings
 *
 * **Purpose**
 * Manages AI-related settings (master system prompt, model defaults) with persistence
 * to Dexie KV store. Provides migration from legacy localStorage. Settings are shared
 * globally across all components via singleton pattern.
 *
 * **Responsibilities**
 * - Load and persist AI settings to KV store (key: `ai_settings`)
 * - Migrate from legacy localStorage on first access
 * - Provide reactive state for master system prompt and model defaults
 * - Sanitize and validate settings on load/save
 * - Support both "last selected" and "fixed" model modes
 *
 * **Non-responsibilities**
 * - Does NOT apply settings to chat messages (see useAi.ts)
 * - Does NOT manage model catalog (see useModelStore.ts)
 * - Does NOT validate model IDs exist (caller should check)
 * - Does NOT emit hooks (settings are directly reactive)
 *
 * **Singleton State Pattern**
 * - Module-scoped ref (`_settings`) ensures all callers share state
 * - Lazy-loaded once on first access via `ensureLoaded()`
 * - Settings persist across component mount/unmount (session lifetime)
 * - Persisted to KV store (survives page reload)
 *
 * **Settings Schema (V1)**
 * - `masterSystemPrompt`: Global system prompt prepended to all chats
 * - `defaultModelMode`: "lastSelected" (use last chosen model) or "fixed" (always use fixedModelId)
 * - `fixedModelId`: Model ID to use when defaultModelMode is "fixed"
 *
 * **Migration**
 * - On first load, checks localStorage for legacy key (`or3.ai.settings.v1`)
 * - Migrates to KV store and clears localStorage (one-time)
 * - Falls back to defaults if migration fails or no legacy data exists
 *
 * **Error Handling**
 * - Load errors from KV store are logged and fall back to defaults
 * - Save errors propagate to caller (should be caught and handled)
 * - Sanitization ensures settings are always valid (no runtime errors)
 *
 * **Lifecycle**
 * - First call triggers lazy load from KV (async, deduped via `_loadPromise`)
 * - `updateSettings(partial)` merges changes and persists to KV
 * - `resetSettings()` reverts to defaults and persists
 */

/**
 * AI Settings Composable
 * 
 * Stores AI-related settings (master prompt, model defaults) in KV for sync.
 * Includes migration from legacy localStorage storage.
 */
import { ref, computed, readonly } from 'vue';
import { getDb } from '~/db/client';
import { setKvByName, getKvByName } from '~/db/kv';

// Settings schema
export interface AiSettingsV1 {
    version: 1;
    masterSystemPrompt: string;
    defaultModelMode: 'lastSelected' | 'fixed';
    fixedModelId: string | null;
}

const AI_SETTINGS_KV_KEY = 'ai_settings';
/** @deprecated Use KV storage via AI_SETTINGS_KV_KEY instead */
export const LEGACY_STORAGE_KEY = 'or3.ai.settings.v1';
/** @deprecated Use AI_SETTINGS_KV_KEY instead */
export const AI_SETTINGS_STORAGE_KEY = LEGACY_STORAGE_KEY;

export const DEFAULT_AI_SETTINGS: AiSettingsV1 = {
    version: 1,
    masterSystemPrompt: '',
    defaultModelMode: 'lastSelected',
    fixedModelId: null,
};

// Module-level singleton state
const _settings = ref<AiSettingsV1>({ ...DEFAULT_AI_SETTINGS });
let _loaded = false;
let _loadedDbName: string | null = null;
let _loadPromise: Promise<void> | null = null;

function isObj(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function coerceStringOrNull(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
}

export function sanitizeAiSettings(
    input: unknown,
    defaults: AiSettingsV1 = DEFAULT_AI_SETTINGS
): AiSettingsV1 {
    const inObj = isObj(input) ? input : ({} as Record<string, unknown>);
    const masterSystemPrompt =
        typeof inObj.masterSystemPrompt === 'string'
            ? inObj.masterSystemPrompt
            : defaults.masterSystemPrompt;
    const defaultModelMode: 'lastSelected' | 'fixed' =
        inObj.defaultModelMode === 'fixed' ? 'fixed' : 'lastSelected';
    const fixedModelId =
        defaultModelMode === 'fixed'
            ? coerceStringOrNull(inObj.fixedModelId)
            : null;

    return {
        version: 1,
        masterSystemPrompt,
        defaultModelMode,
        fixedModelId: fixedModelId ?? defaults.fixedModelId,
    };
}

/**
 * Migrate from legacy localStorage to KV (one-time)
 */
async function migrateFromLocalStorage(): Promise<AiSettingsV1 | null> {
    if (typeof localStorage === 'undefined') return null;
    
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    
    try {
        const parsed: unknown = JSON.parse(raw);
        const settings = sanitizeAiSettings(parsed);
        
        // Mark as migrated by removing from localStorage
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        console.log('[useAiSettings] Migrated settings from localStorage to KV');
        
        return settings;
    } catch {
        return null;
    }
}

/**
 * Load settings from KV, with localStorage migration fallback
 */
async function loadSettings(): Promise<void> {
    const dbName = getDb().name;
    if (_loaded && _loadedDbName === dbName) return;
    if (_loadPromise && _loadedDbName === dbName) return _loadPromise;
    if (_loadedDbName !== dbName) {
        _loaded = false;
        _loadPromise = null;
    }
    _loadedDbName = dbName;
    
    _loadPromise = (async () => {
        try {
            // Try KV first
            const kvRecord = await getKvByName(AI_SETTINGS_KV_KEY);
            if (kvRecord?.value) {
                const parsed: unknown = JSON.parse(kvRecord.value);
                _settings.value = sanitizeAiSettings(parsed);
                _loaded = true;
                return;
            }
            
            // Fall back to localStorage migration
            const migrated = await migrateFromLocalStorage();
            if (migrated) {
                _settings.value = migrated;
                // Persist to KV
                await setKvByName(AI_SETTINGS_KV_KEY, JSON.stringify(migrated));
                _loaded = true;
                return;
            }
            
            // No existing settings, use defaults
            _settings.value = { ...DEFAULT_AI_SETTINGS };
            _loaded = true;
        } catch (error) {
            console.error('[useAiSettings] Failed to load settings:', error);
            _settings.value = { ...DEFAULT_AI_SETTINGS };
            _loaded = true;
        }
    })();
    
    return _loadPromise;
}

/**
 * Save settings to KV
 */
async function saveSettings(settings: AiSettingsV1): Promise<void> {
    try {
        await setKvByName(AI_SETTINGS_KV_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error('[useAiSettings] Failed to save settings:', error);
    }
}

/** Public composable API */
export function useAiSettings() {
    // Trigger load on first use (client-side only)
    if (import.meta.client && !_loaded && !_loadPromise) {
        void loadSettings();
    }

    const settings = computed(() => _settings.value);

    async function set(patch: Partial<AiSettingsV1>) {
        await loadSettings(); // Ensure loaded before modifying
        const merged = sanitizeAiSettings({
            ..._settings.value,
            ...patch,
        });
        _settings.value = merged;
        await saveSettings(merged);
    }

    async function reset() {
        _settings.value = { ...DEFAULT_AI_SETTINGS };
        await saveSettings(_settings.value);
    }

    function load(): AiSettingsV1 {
        return _settings.value;
    }

    return {
        settings,
        set,
        reset,
        load,
        ensureLoaded: loadSettings,
    };
}
