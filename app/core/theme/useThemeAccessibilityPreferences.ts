import { ref, type Ref } from 'vue';
import { useNuxtApp } from '#app';
import { isBrowser } from '~/utils/env';

const STORAGE_KEY = 'or3:user-theme-accessibility';
const STORAGE_VERSION = 1;

export type MotionPreference = 'system' | 'reduced';

export interface UserThemeAccessibilityPreferences {
    focusRingWidthPx: number;
    motion: MotionPreference;
}

interface StoredAccessibilityPreferences
    extends UserThemeAccessibilityPreferences {
    version: number;
}

interface ToastPayload {
    title?: string;
    description?: string;
    color?: string;
    timeout?: number;
}

interface PreferenceStore {
    preferences: Ref<UserThemeAccessibilityPreferences>;
    loaded: boolean;
    mediaQuery?: MediaQueryList;
    onMediaChange?: () => void;
    toast?: { add?: (payload: ToastPayload) => void };
}

type StoreGlobal = typeof globalThis & {
    __or3ThemeAccessibilityPreferences?: PreferenceStore;
};

export const DEFAULT_THEME_ACCESSIBILITY_PREFERENCES: UserThemeAccessibilityPreferences =
    {
        focusRingWidthPx: 2,
        motion: 'system',
    };

function getStore(): PreferenceStore {
    const globalStore = globalThis as StoreGlobal;
    globalStore.__or3ThemeAccessibilityPreferences ??= {
        preferences: ref({ ...DEFAULT_THEME_ACCESSIBILITY_PREFERENCES }),
        loaded: false,
    };
    return globalStore.__or3ThemeAccessibilityPreferences;
}

export function normalizeThemeAccessibilityPreferences(
    value: unknown
): UserThemeAccessibilityPreferences {
    const input =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Partial<UserThemeAccessibilityPreferences>)
            : {};
    const focusRingWidthPx =
        typeof input.focusRingWidthPx === 'number' &&
        Number.isFinite(input.focusRingWidthPx)
            ? Math.max(1, Math.min(4, input.focusRingWidthPx))
            : DEFAULT_THEME_ACCESSIBILITY_PREFERENCES.focusRingWidthPx;
    const motion: MotionPreference =
        input.motion === 'reduced' || input.motion === 'system'
            ? input.motion
            : DEFAULT_THEME_ACCESSIBILITY_PREFERENCES.motion;

    return { focusRingWidthPx, motion };
}

export function applyAccessibilityPreferences(
    preferences: UserThemeAccessibilityPreferences,
    prefersReducedMotion = getPrefersReducedMotion()
): void {
    if (!isBrowser()) return;
    const normalized = normalizeThemeAccessibilityPreferences(preferences);
    const root = document.documentElement;
    root.style.setProperty(
        '--app-focus-ring-width',
        `${normalized.focusRingWidthPx}px`
    );
    root.dataset.motion = normalized.motion;
    const reduced = normalized.motion === 'reduced' || prefersReducedMotion;
    root.dataset.motionResolved = reduced ? 'reduced' : 'normal';
    if (reduced) {
        root.style.setProperty('--app-motion-duration-fast', '100ms');
        root.style.setProperty('--app-motion-duration-medium', '100ms');
        root.style.setProperty('--app-motion-duration-slow', '100ms');
        root.style.setProperty('--app-motion-easing-standard', 'linear');
    } else {
        root.style.removeProperty('--app-motion-duration-fast');
        root.style.removeProperty('--app-motion-duration-medium');
        root.style.removeProperty('--app-motion-duration-slow');
        root.style.removeProperty('--app-motion-easing-standard');
    }
}

function initializeStore(store: PreferenceStore): void {
    if (store.loaded || !isBrowser()) return;

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<StoredAccessibilityPreferences>;
            if (parsed.version === STORAGE_VERSION) {
                store.preferences.value = normalizeThemeAccessibilityPreferences(
                    parsed
                );
            }
        }
    } catch (error) {
        console.warn(
            '[theme-accessibility-preferences] Failed to parse stored data',
            error
        );
    }

    const nuxtApp = useNuxtApp() as unknown as {
        $toast?: { add?: (payload: ToastPayload) => void };
    };
    store.toast = nuxtApp.$toast;
    store.mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    store.onMediaChange = () => {
        applyAccessibilityPreferences(
            store.preferences.value,
            store.mediaQuery?.matches ?? false
        );
    };
    store.mediaQuery?.addEventListener?.('change', store.onMediaChange);
    store.loaded = true;
    store.onMediaChange();

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            store.mediaQuery?.removeEventListener?.('change', store.onMediaChange!);
            delete (globalThis as StoreGlobal).__or3ThemeAccessibilityPreferences;
        });
    }
}

function getPrefersReducedMotion(): boolean {
    if (!isBrowser()) return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function persist(
    store: PreferenceStore,
    preferences: UserThemeAccessibilityPreferences
): void {
    if (!isBrowser()) return;
    try {
        const payload: StoredAccessibilityPreferences = {
            version: STORAGE_VERSION,
            ...preferences,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            store.toast?.add?.({
                title: 'Storage Full',
                description:
                    'Could not save accessibility preferences. Clear browser data to free space.',
                color: 'red',
                timeout: 5000,
            });
        } else {
            console.warn('[theme-accessibility-preferences] Failed to save', error);
        }
    }
}

export function useThemeAccessibilityPreferences() {
    const store = getStore();
    initializeStore(store);

    function set(patch: Partial<UserThemeAccessibilityPreferences>): void {
        const preferences = normalizeThemeAccessibilityPreferences({
            ...store.preferences.value,
            ...patch,
        });
        store.preferences.value = preferences;
        applyAccessibilityPreferences(
            preferences,
            store.mediaQuery?.matches ?? false
        );
        persist(store, preferences);
    }

    function reset(): void {
        set(DEFAULT_THEME_ACCESSIBILITY_PREFERENCES);
    }

    return {
        preferences: store.preferences,
        set,
        reset,
    };
}
