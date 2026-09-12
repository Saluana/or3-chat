/**
 * Theme Selection Composable
 * 
 * Manages theme selection with KV storage for cross-device sync.
 * Includes migration from legacy localStorage storage.
 */
import { ref, readonly } from 'vue';
import { getDb, type Or3DB } from '~/db/client';
import { getKvByName, setKvByName } from '~/db/kv';

const THEME_SELECTION_KV_KEY = 'theme_selection';
/** @deprecated Use KV storage via THEME_SELECTION_KV_KEY instead */
const LEGACY_STORAGE_KEY = 'activeTheme';

// Module-level singleton state. Loads/saves capture their originating database
// at admission: a delayed completion must never publish to — or persist into —
// a workspace that became active after the operation started.
const _selectedTheme = ref<string | null>(null);
const _selectionSource = ref<'kv' | 'local-migration' | 'none'>('none');
let _loaded = false;
let _loadedDbName: string | null = null;
let _loadPromise: Promise<void> | null = null;
let _loadPromiseDbName: string | null = null;
const _saveRevisionByDb = new Map<string, number>();
const _saveQueueByDb = new Map<string, Promise<void>>();

function isStillCurrent(dbName: string): boolean {
    try {
        return getDb().name === dbName;
    } catch {
        return false;
    }
}

/**
 * Migrate from legacy localStorage to KV (one-time)
 */
function migrateFromLocalStorage(): string | null {
    if (typeof localStorage === 'undefined') return null;

    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return null;

    localStorage.removeItem(LEGACY_STORAGE_KEY);

    // Mark as migrated by removing from localStorage
    // Note: We keep the cookie for SSR, but localStorage is no longer the source of truth
    return stored;
}

/**
 * Load theme selection from KV, with localStorage migration fallback.
 * The originating database is captured at admission; a completion that resumes
 * after a workspace switch discards its result instead of overwriting the
 * newly active workspace's selection.
 */
async function loadSelection(targetDb?: Or3DB): Promise<void> {
    const capturedDb = targetDb ?? getDb();
    const dbName = capturedDb.name;
    if (_loaded && _loadedDbName === dbName) return;
    if (_loadPromise && _loadPromiseDbName === dbName) return _loadPromise;
    if (_loadedDbName !== dbName) {
        _loaded = false;
        _loadPromise = null;
        _loadPromiseDbName = null;
    }
    // Record the latest requested database, but only publish results while it
    // is still the requester.
    _loadedDbName = dbName;
    _loadPromiseDbName = dbName;

    _loadPromise = (async () => {
        try {
            // Try KV first (scoped to the captured database)
            const kvRecord = await getKvByName(THEME_SELECTION_KV_KEY, capturedDb);
            if (!isStillCurrent(dbName)) return;
            if (kvRecord?.value) {
                _selectedTheme.value = kvRecord.value;
                _selectionSource.value = 'kv';
                _loaded = true;
                return;
            }

            // Fall back to localStorage migration
            const migrated = migrateFromLocalStorage();
            if (migrated) {
                if (!isStillCurrent(dbName)) return;
                _selectedTheme.value = migrated;
                _selectionSource.value = 'local-migration';
                await setKvByName(THEME_SELECTION_KV_KEY, migrated, capturedDb);
                if (!isStillCurrent(dbName)) return;
                _loaded = true;
                return;
            }

            // No existing selection
            if (!isStillCurrent(dbName)) return;
            _selectedTheme.value = null;
            _selectionSource.value = 'none';
            _loaded = true;
        } catch (error) {
            if (!isStillCurrent(dbName)) return;
            console.error('[useThemeSelection] Failed to load theme selection:', error);
            _selectedTheme.value = null;
            _loaded = true;
        }
    })();

    return _loadPromise;
}

/**
 * Save theme selection to KV in the captured database. Revisions and the
 * write queue are scoped per database so a save admitted in one workspace
 * can neither overwrite another workspace nor be cancelled by it.
 */
async function saveSelection(themeName: string, targetDb?: Or3DB): Promise<void> {
    const capturedDb = targetDb ?? getDb();
    const dbName = capturedDb.name;
    const revision = (_saveRevisionByDb.get(dbName) ?? 0) + 1;
    _saveRevisionByDb.set(dbName, revision);
    if (isStillCurrent(dbName)) {
        _selectedTheme.value = themeName;
        _selectionSource.value = 'kv';
    }
    const previous = _saveQueueByDb.get(dbName) ?? Promise.resolve();
    const next = previous.then(async () => {
        if (_saveRevisionByDb.get(dbName) !== revision) return;
        try {
            await setKvByName(THEME_SELECTION_KV_KEY, themeName, capturedDb);
        } catch (error) {
            console.error('[useThemeSelection] Failed to save theme selection:', error);
        }
    });
    _saveQueueByDb.set(dbName, next);
    await next;
}

/** Public composable API */
export function useThemeSelection() {
    // Trigger load on first use (client-side only)
    if (import.meta.client && !_loaded && !_loadPromise) {
        void loadSelection();
    }

    const selectedTheme = readonly(_selectedTheme);

    async function setSelectedTheme(themeName: string) {
        const capturedDb = getDb();
        await loadSelection(capturedDb); // Ensure loaded before modifying
        await saveSelection(themeName, capturedDb);
    }

    return {
        selectedTheme,
        selectionSource: readonly(_selectionSource),
        setSelectedTheme,
        ensureLoaded: loadSelection,
    };
}

/**
 * Get theme selection synchronously (for plugin initialization)
 * Falls back to localStorage if KV not yet loaded
 */
/** Test-only reset for the module-level caches. */
export function __resetThemeSelectionForTests(): void {
    _selectedTheme.value = null;
    _selectionSource.value = 'none';
    _loaded = false;
    _loadedDbName = null;
    _loadPromise = null;
    _loadPromiseDbName = null;
    _saveRevisionByDb.clear();
    _saveQueueByDb.clear();
}

export function getThemeSelectionSync(): string | null {
    try {
        if (_loaded && _loadedDbName === getDb().name && _selectedTheme.value) {
            return _selectedTheme.value;
        }
    } catch {
        // Active DB unavailable; fall through to localStorage.
    }
    
    // Fallback to localStorage for initial load
    if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(LEGACY_STORAGE_KEY);
    }
    
    return null;
}
