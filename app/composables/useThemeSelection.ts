/**
 * Theme Selection Composable
 * 
 * Manages theme selection with KV storage for cross-device sync.
 * Includes migration from legacy localStorage storage.
 */
import { ref, readonly } from 'vue';
import { getDb } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';

const THEME_SELECTION_KV_KEY = 'theme_selection';
/** @deprecated Use KV storage via THEME_SELECTION_KV_KEY instead */
const LEGACY_STORAGE_KEY = 'activeTheme';

// Module-level singleton state
const _selectedTheme = ref<string | null>(null);
let _loaded = false;
let _loadedDbName: string | null = null;
let _loadPromise: Promise<void> | null = null;

/**
 * Migrate from legacy localStorage to KV (one-time)
 */
function migrateFromLocalStorage(): string | null {
    if (typeof localStorage === 'undefined') return null;
    
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return null;
    
    // Mark as migrated by removing from localStorage
    // Note: We keep the cookie for SSR, but localStorage is no longer the source of truth
    console.log('[useThemeSelection] Migrated theme selection from localStorage to KV');
    
    return stored;
}

/**
 * Load theme selection from KV, with localStorage migration fallback
 */
async function loadSelection(): Promise<void> {
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
            const kvRecord = await getKvByName(THEME_SELECTION_KV_KEY);
            if (kvRecord?.value) {
                _selectedTheme.value = kvRecord.value;
                _loaded = true;
                return;
            }
            
            // Fall back to localStorage migration
            const migrated = migrateFromLocalStorage();
            if (migrated) {
                _selectedTheme.value = migrated;
                // Persist to KV (async, don't wait)
                void setKvByName(THEME_SELECTION_KV_KEY, migrated);
                _loaded = true;
                return;
            }
            
            // No existing selection
            _selectedTheme.value = null;
            _loaded = true;
        } catch (error) {
            console.error('[useThemeSelection] Failed to load theme selection:', error);
            _selectedTheme.value = null;
            _loaded = true;
        }
    })();
    
    return _loadPromise;
}

/**
 * Save theme selection to KV
 */
async function saveSelection(themeName: string): Promise<void> {
    try {
        _selectedTheme.value = themeName;
        await setKvByName(THEME_SELECTION_KV_KEY, themeName);
    } catch (error) {
        console.error('[useThemeSelection] Failed to save theme selection:', error);
    }
}

/** Public composable API */
export function useThemeSelection() {
    // Trigger load on first use (client-side only)
    if (import.meta.client && !_loaded && !_loadPromise) {
        void loadSelection();
    }

    const selectedTheme = readonly(_selectedTheme);

    async function setSelectedTheme(themeName: string) {
        await loadSelection(); // Ensure loaded before modifying
        await saveSelection(themeName);
    }

    return {
        selectedTheme,
        setSelectedTheme,
        ensureLoaded: loadSelection,
    };
}

/**
 * Get theme selection synchronously (for plugin initialization)
 * Falls back to localStorage if KV not yet loaded
 */
export function getThemeSelectionSync(): string | null {
    if (_loaded && _selectedTheme.value) {
        return _selectedTheme.value;
    }
    
    // Fallback to localStorage for initial load
    if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(LEGACY_STORAGE_KEY);
    }
    
    return null;
}
