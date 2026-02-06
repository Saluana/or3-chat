/**
 * @module app/core/theme/useUserThemeOverrides
 *
 * Purpose:
 * Vue composable for reading, writing, and applying user theme overrides.
 * Manages a per-mode (light/dark) override store backed by localStorage
 * with reactive application to the DOM.
 *
 * Behavior:
 * - On first use, loads stored overrides from localStorage and applies them
 * - Watches for HTML class mutations to detect light/dark mode switches
 * - `set()` deep-merges a patch into the current mode's overrides, validates,
 *   persists, and re-applies to the DOM
 * - `reset()` / `resetAll()` reverts overrides to empty defaults
 * - `switchMode()` changes the active color mode and re-applies
 * - `reapply()` forces re-application without changing overrides
 *
 * Constraints:
 * - Client-only (guards via `isBrowser()`)
 * - HMR-safe singleton via `globalThis.__or3UserThemeOverrides`
 * - Typography font size is validated to 14-24 px range
 * - Background opacities are clamped to 0-1
 * - Quota exceeded errors are caught and surfaced via toast
 *
 * Non-goals:
 * - Does not manage the base theme registry (see theme plugin)
 * - Does not handle theme file compilation (see scripts/theme-compiler)
 *
 * @see core/theme/apply-merged-theme for DOM application logic
 * @see core/theme/user-overrides-types for the persisted shape
 * @see core/theme/backgrounds for blob URL lifecycle management
 */
import { ref, watch, computed } from 'vue';
import type { UserThemeOverrides } from './user-overrides-types';
import { EMPTY_USER_OVERRIDES } from './user-overrides-types';
import { applyMergedTheme } from './apply-merged-theme';
import { revokeBackgroundBlobs } from './backgrounds';
import { isBrowser } from '~/utils/env';

// Storage keys
const STORAGE_KEY_LIGHT = 'or3:user-theme-overrides:light';
const STORAGE_KEY_DARK = 'or3:user-theme-overrides:dark';

interface ToastPayload {
    title?: string;
    description?: string;
    color?: string;
    timeout?: number;
}

type UserThemeOverrideGlobals = typeof globalThis & {
    __or3UserThemeOverrides?: {
        light: ReturnType<typeof ref<UserThemeOverrides>>;
        dark: ReturnType<typeof ref<UserThemeOverrides>>;
        activeMode: ReturnType<typeof ref<'light' | 'dark'>>;
        loaded: boolean;
    };
    useNuxtApp?: () => {
        $toast?: { add?: (payload: ToastPayload) => void };
        $theme?: { set?: (mode: 'light' | 'dark') => void };
    };
};

// HMR-safe singleton
const g = globalThis as UserThemeOverrideGlobals;
if (!g.__or3UserThemeOverrides) {
    g.__or3UserThemeOverrides = {
        light: ref<UserThemeOverrides>({ ...EMPTY_USER_OVERRIDES }),
        dark: ref<UserThemeOverrides>({ ...EMPTY_USER_OVERRIDES }),
        activeMode: ref<'light' | 'dark'>('light'),
        loaded: false,
    };
}

const store = g.__or3UserThemeOverrides;

function detectModeFromHtml(): 'light' | 'dark' {
    if (!isBrowser()) return 'light';
    const cls = document.documentElement.className;
    return /\bdark\b/.test(cls) ? 'dark' : 'light';
}

function loadFromStorage(mode: 'light' | 'dark'): UserThemeOverrides | null {
    if (!isBrowser()) return null;
    try {
        const key = mode === 'light' ? STORAGE_KEY_LIGHT : STORAGE_KEY_DARK;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as UserThemeOverrides;
    } catch (e) {
        console.warn('[user-theme-overrides] Failed to parse stored data', e);
        return null;
    }
}

function saveToStorage(mode: 'light' | 'dark', overrides: UserThemeOverrides) {
    if (!isBrowser()) return;
    try {
        const key = mode === 'light' ? STORAGE_KEY_LIGHT : STORAGE_KEY_DARK;
        localStorage.setItem(key, JSON.stringify(overrides));
    } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            console.error(
                '[user-theme-overrides] Storage quota exceeded. Customizations not saved.'
            );
            // Notify user via toast if available
            const nuxtApp = g.useNuxtApp?.();
            nuxtApp?.$toast?.add?.({
                title: 'Storage Full',
                description:
                    'Could not save theme customizations. Clear browser data to free space.',
                color: 'red',
                timeout: 5000,
            });
        } else {
            console.warn('[user-theme-overrides] Failed to save', e);
        }
    }
}

/**
 * Purpose:
 * Provide a reactive, persisted store of user theme overrides.
 *
 * Behavior:
 * - Loads per-mode overrides from localStorage on first use
 * - Applies overrides to the DOM via `applyMergedTheme`
 * - Persists updates and supports reset operations
 *
 * Constraints:
 * - Client-only; returns a usable API but does not read/write storage on SSR
 * - Uses a global singleton for HMR and multiple component consumers
 */
export function useUserThemeOverrides() {
    const current = computed<UserThemeOverrides>(() => {
        const lightValue = store.light.value;
        const darkValue = store.dark.value;
        const modeValue = store.activeMode.value;

        return modeValue === 'light' ? lightValue : darkValue;
    });

    // Initialize on first use
    if (!store.loaded && isBrowser()) {
        const loadedLight = loadFromStorage('light');
        const loadedDark = loadFromStorage('dark');
        if (loadedLight) store.light.value = loadedLight;
        if (loadedDark) store.dark.value = loadedDark;

        store.activeMode.value = detectModeFromHtml();

        // Apply initial theme (async)
        void applyMergedTheme(store.activeMode.value, current.value);

        // Watch for mode changes (html class mutations)
        const mo = new MutationObserver(() => {
            const mode = detectModeFromHtml();
            if (mode !== store.activeMode.value) {
                store.activeMode.value = mode;
                void applyMergedTheme(mode, current.value);
            }
        });
        mo.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });

        if (import.meta.hot) {
            import.meta.hot.dispose(() => {
                mo.disconnect();
                revokeBackgroundBlobs();
            });
        }

        store.loaded = true;
    }

    function set(patch: Partial<UserThemeOverrides>) {
        const mode = store.activeMode.value;
        const baseValue =
            mode === 'light' ? store.light.value : store.dark.value;

        // Validate before merge
        const validated = validatePatch(patch);
        const merged = deepMerge(baseValue, validated);

        if (mode === 'light') store.light.value = merged;
        else store.dark.value = merged;

        if (patch.backgrounds) {
            revokeBackgroundBlobs();
        }

        void applyMergedTheme(mode, merged);
        saveToStorage(mode, merged);
    }

    function validatePatch(
        patch: Partial<UserThemeOverrides>
    ): Partial<UserThemeOverrides> {
        const result: Partial<UserThemeOverrides> = { ...patch };

        // Validate typography
        if (result.typography?.baseFontPx !== undefined) {
            result.typography = {
                ...result.typography,
                baseFontPx: Math.max(
                    14,
                    Math.min(24, result.typography.baseFontPx)
                ),
            };
        }

        // Validate background layer opacities
        if (result.backgrounds?.content?.base?.opacity !== undefined) {
            const base = result.backgrounds.content.base;
            const opacity = base.opacity ?? 0;
            result.backgrounds = {
                ...result.backgrounds,
                content: {
                    ...result.backgrounds.content,
                    base: {
                        ...base,
                        opacity: Math.max(0, Math.min(1, opacity)),
                    },
                },
            };
        }

        if (result.backgrounds?.content?.overlay?.opacity !== undefined) {
            const overlay = result.backgrounds.content.overlay;
            const opacity = overlay.opacity ?? 0;
            result.backgrounds = {
                ...result.backgrounds,
                content: {
                    ...result.backgrounds.content,
                    overlay: {
                        ...overlay,
                        opacity: Math.max(0, Math.min(1, opacity)),
                    },
                },
            };
        }

        if (result.backgrounds?.sidebar?.opacity !== undefined) {
            const sidebar = result.backgrounds.sidebar;
            const opacity = sidebar.opacity ?? 0;
            result.backgrounds = {
                ...result.backgrounds,
                sidebar: {
                    ...sidebar,
                    opacity: Math.max(0, Math.min(1, opacity)),
                },
            };
        }

        return result;
    }

    function reset(mode?: 'light' | 'dark') {
        const target = mode ?? store.activeMode.value;
        const empty = { ...EMPTY_USER_OVERRIDES };

        if (target === 'light') {
            store.light.value = empty;
            saveToStorage('light', empty);
        } else {
            store.dark.value = empty;
            saveToStorage('dark', empty);
        }

        if (target === store.activeMode.value) {
            revokeBackgroundBlobs();
            void applyMergedTheme(target, empty);
        }
    }

    function resetAll() {
        reset('light');
        reset('dark');
    }

    function switchMode(mode: 'light' | 'dark') {
        if (mode === store.activeMode.value) return;
        store.activeMode.value = mode;
        const overrides =
            mode === 'light' ? store.light.value : store.dark.value;
        void applyMergedTheme(mode, overrides);

        // Also update theme plugin to sync classes
        if (isBrowser()) {
            const nuxtApp = g.useNuxtApp?.();
            nuxtApp?.$theme?.set?.(mode);
        }
    }

    function reapply() {
        const mode = store.activeMode.value;
        void applyMergedTheme(mode, current.value);
    }

    // Watch for changes and persist
    if (isBrowser()) {
        watch(
            () => store.light.value,
            (v) => {
                if (store.activeMode.value === 'light') {
                    void applyMergedTheme('light', v);
                }
                saveToStorage('light', v);
            },
            { deep: true }
        );

        watch(
            () => store.dark.value,
            (v) => {
                if (store.activeMode.value === 'dark') {
                    void applyMergedTheme('dark', v);
                }
                saveToStorage('dark', v);
            },
            { deep: true }
        );
    }

    return {
        overrides: current,
        light: store.light,
        dark: store.dark,
        activeMode: store.activeMode,
        set,
        reset,
        resetAll,
        switchMode,
        reapply,
    };
}

/** Deep merge helper for user overrides */
function deepMerge(
    base: UserThemeOverrides,
    patch: Partial<UserThemeOverrides>
): UserThemeOverrides {
    const result = { ...base } as Record<string, unknown>;
    for (const key in patch) {
        const val = (patch as Record<string, unknown>)[key];
        if (val === undefined) continue; // skip undefined

        if (val === null || typeof val !== 'object' || Array.isArray(val)) {
            result[key] = val; // allow null to clear, primitives, and arrays
        } else {
            result[key] = deepMerge(
                (result[key] || {}) as UserThemeOverrides,
                val as Partial<UserThemeOverrides>
            );
        }
    }
    return result as UserThemeOverrides;
}
