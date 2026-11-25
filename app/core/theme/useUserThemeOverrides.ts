/** Singleton, batched user theme override store. */
import { computed, ref, watch, type Ref, type WatchStopHandle } from 'vue';
import { useNuxtApp } from '#app';
import { useToast } from '#imports';
import type { ThemePlugin } from '~/theme/_shared/types';
import type { UserThemeOverrides } from './user-overrides-types';
import { EMPTY_USER_OVERRIDES } from './user-overrides-types';
import { applyMergedTheme, type MissingBackgroundImage } from './apply-merged-theme';
import { isUserFontChoice } from './font-options';
import {
    isDensityPreset,
    isElevationPreset,
    isUiScaleChoice,
} from './theme-token-presets';
import { invalidateBackgroundToken, revokeBackgroundBlobs } from './backgrounds';
import { isBrowser } from '~/utils/env';

const STORAGE_KEY_LIGHT = 'or3:user-theme-overrides:light';
const STORAGE_KEY_DARK = 'or3:user-theme-overrides:dark';
const PERSIST_DELAY_MS = 50;

interface ToastPayload {
    title?: string;
    description?: string;
    color?: 'error' | 'warning' | 'success' | 'info' | 'neutral';
    timeout?: number;
}

function nuxtUiToast(): StoreState['toast'] {
    try {
        const toast = useToast();
        return {
            add: ({ timeout, ...payload }) => toast.add({ ...payload, duration: timeout }),
        };
    } catch {
        return undefined;
    }
}

interface StoreState {
    light: Ref<UserThemeOverrides>;
    dark: Ref<UserThemeOverrides>;
    activeMode: Ref<'light' | 'dark'>;
    loaded: boolean;
    revision: number;
    commitQueued: boolean;
    persistTimer: ReturnType<typeof setTimeout> | null;
    stopWatch?: WatchStopHandle;
    observer?: MutationObserver;
    themePlugin?: ThemePlugin;
    toast?: { add?: (payload: ToastPayload) => void };
}

type StoreGlobal = typeof globalThis & {
    __or3UserThemeOverrides?: StoreState;
};

function createEmpty(): UserThemeOverrides {
    return typeof globalThis.structuredClone === 'function'
        ? globalThis.structuredClone(EMPTY_USER_OVERRIDES)
        : JSON.parse(JSON.stringify(EMPTY_USER_OVERRIDES));
}

function getStore(): StoreState {
    const globalStore = globalThis as StoreGlobal;
    globalStore.__or3UserThemeOverrides ??= {
        light: ref(createEmpty()),
        dark: ref(createEmpty()),
        activeMode: ref('light'),
        loaded: false,
        revision: 0,
        commitQueued: false,
        persistTimer: null,
    };
    return globalStore.__or3UserThemeOverrides!;
}

function detectModeFromHtml(): 'light' | 'dark' {
    if (!isBrowser()) return 'light';
    return /\bdark\b/.test(document.documentElement.className)
        ? 'dark'
        : 'light';
}

function loadFromStorage(mode: 'light' | 'dark'): UserThemeOverrides | null {
    if (!isBrowser()) return null;
    try {
        const key = mode === 'light' ? STORAGE_KEY_LIGHT : STORAGE_KEY_DARK;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return validatePatch(parsed as Partial<UserThemeOverrides>) as UserThemeOverrides;
    } catch (error) {
        console.warn('[user-theme-overrides] Failed to parse stored data', error);
        return null;
    }
}

function persist(store: StoreState): void {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(STORAGE_KEY_LIGHT, JSON.stringify(store.light.value));
        localStorage.setItem(STORAGE_KEY_DARK, JSON.stringify(store.dark.value));
    } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            store.toast?.add?.({
                title: 'Storage Full',
                description:
                    'Could not save theme customizations. Clear browser data to free space.',
                color: 'error',
                timeout: 5000,
            });
        } else {
            console.warn('[user-theme-overrides] Failed to save', error);
        }
    }
}

const AREA_LABELS: Record<MissingBackgroundImage['area'], string> = {
    content: 'Content Layer 1',
    overlay: 'Content Layer 2',
    sidebar: 'Sidebar Background',
};
/** Each missing image is reported once per session, not on every re-apply. */
const reportedMissingImages = new Set<string>();

function notifyMissingBackgroundImages(store: StoreState, missing: MissingBackgroundImage[]): void {
    const fresh = missing.filter(({ hash }) => !reportedMissingImages.has(hash));
    if (!fresh.length) return;
    for (const { hash } of fresh) reportedMissingImages.add(hash);
    store.toast?.add?.({
        title: 'Background image not found',
        description: fresh.length === 1
            ? `${AREA_LABELS[fresh[0]!.area]} is showing the theme pattern because its image isn't available on this device. Choose another image in Appearance → Backgrounds.`
            : `${fresh.map(({ area }) => AREA_LABELS[area]).join(', ')} are showing the theme pattern because their images aren't available on this device. Choose other images in Appearance → Backgrounds.`,
        color: 'warning',
        timeout: 8000,
    });
}

function scheduleCommit(store: StoreState): void {
    const revision = ++store.revision;
    if (!store.commitQueued) {
        store.commitQueued = true;
        queueMicrotask(() => {
            store.commitQueued = false;
            if (revision !== store.revision) return scheduleCommit(store);
            const mode = store.activeMode.value;
            const overrides = mode === 'light' ? store.light.value : store.dark.value;
            void applyMergedTheme(mode, overrides, store.themePlugin, () => revision === store.revision, {
                onMissingBackgroundImages: (missing) => notifyMissingBackgroundImages(store, missing),
            });
        });
    }

    if (store.persistTimer) clearTimeout(store.persistTimer);
    store.persistTimer = setTimeout(() => {
        store.persistTimer = null;
        persist(store);
    }, PERSIST_DELAY_MS);
}

function backgroundUrls(value: UserThemeOverrides): Array<string | null | undefined> {
    return [
        value.backgrounds?.content?.base?.url,
        value.backgrounds?.content?.overlay?.url,
        value.backgrounds?.sidebar?.url,
    ];
}

function invalidateChangedBackgrounds(
    previous: UserThemeOverrides,
    next: UserThemeOverrides
): void {
    const before = backgroundUrls(previous);
    const after = backgroundUrls(next);
    for (let index = 0; index < before.length; index++) {
        const oldUrl = before[index];
        if (oldUrl === after[index] || !oldUrl?.startsWith('internal-file://')) continue;
        invalidateBackgroundToken(oldUrl.slice('internal-file://'.length));
    }
}

function initializeStore(store: StoreState): void {
    if (store.loaded || !isBrowser()) return;
    const nuxtApp = useNuxtApp() as unknown as {
        $theme?: ThemePlugin;
        $toast?: { add?: (payload: ToastPayload) => void };
    };
    store.themePlugin = nuxtApp.$theme;
    // Nuxt UI exposes toasts through useToast(); $toast is kept for hosts that provide one.
    store.toast = nuxtApp.$toast ?? nuxtUiToast();
    store.light.value = loadFromStorage('light') ?? createEmpty();
    store.dark.value = loadFromStorage('dark') ?? createEmpty();
    store.activeMode.value = detectModeFromHtml();

    store.stopWatch = watch(
        [
            store.light,
            store.dark,
            store.activeMode,
            () => (store.themePlugin as Partial<ThemePlugin> | undefined)?.resolversVersion?.value,
        ],
        () => scheduleCommit(store),
        { deep: true, flush: 'sync' }
    );

    store.observer = new MutationObserver(() => {
        const mode = detectModeFromHtml();
        if (mode !== store.activeMode.value) store.activeMode.value = mode;
    });
    store.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
    });
    store.loaded = true;
    scheduleCommit(store);

    if (import.meta.hot) {
        import.meta.hot.dispose(() => {
            store.stopWatch?.();
            store.observer?.disconnect();
            if (store.persistTimer) clearTimeout(store.persistTimer);
            revokeBackgroundBlobs();
            delete (globalThis as StoreGlobal).__or3UserThemeOverrides;
        });
    }
}

export function useUserThemeOverrides() {
    const store = getStore();
    initializeStore(store);
    const current = computed(() =>
        store.activeMode.value === 'light' ? store.light.value : store.dark.value
    );

    function set(patch: Partial<UserThemeOverrides>) {
        const mode = store.activeMode.value;
        const previous = mode === 'light' ? store.light.value : store.dark.value;
        const merged = deepMerge(previous, validatePatch(patch));
        invalidateChangedBackgrounds(previous, merged);
        if (mode === 'light') store.light.value = merged;
        else store.dark.value = merged;
    }

    function reset(mode: 'light' | 'dark' = store.activeMode.value) {
        const previous = mode === 'light' ? store.light.value : store.dark.value;
        const empty = createEmpty();
        invalidateChangedBackgrounds(previous, empty);
        if (mode === 'light') store.light.value = empty;
        else store.dark.value = empty;
    }

    function resetAll() {
        reset('light');
        reset('dark');
    }

    function applyPreset(light: UserThemeOverrides, dark: UserThemeOverrides) {
        const nextLight = deepMerge(createEmpty(), validatePatch(light));
        const nextDark = deepMerge(createEmpty(), validatePatch(dark));
        invalidateChangedBackgrounds(store.light.value, nextLight);
        invalidateChangedBackgrounds(store.dark.value, nextDark);
        store.light.value = nextLight;
        store.dark.value = nextDark;
        if (store.persistTimer) {
            clearTimeout(store.persistTimer);
            store.persistTimer = null;
        }
        persist(store);
    }

    function switchMode(mode: 'light' | 'dark') {
        if (mode === store.activeMode.value) return;
        store.activeMode.value = mode;
        (store.themePlugin as Partial<ThemePlugin> | undefined)?.set?.(mode);
    }

    function reapply() {
        scheduleCommit(store);
    }

    return {
        overrides: current,
        light: store.light,
        dark: store.dark,
        activeMode: store.activeMode,
        set,
        reset,
        resetAll,
        applyPreset,
        switchMode,
        reapply,
    };
}

function validatePatch(patch: Partial<UserThemeOverrides>): Partial<UserThemeOverrides> {
    const result = deepMerge({} as UserThemeOverrides, patch);
    if (result.typography?.baseFontPx !== undefined) {
        result.typography.baseFontPx = Math.max(
            14,
            Math.min(24, result.typography.baseFontPx)
        );
    }
    if (
        result.typography?.uiScale !== undefined &&
        !isUiScaleChoice(result.typography.uiScale)
    ) {
        delete result.typography.uiScale;
    }
    for (const key of ['bodyFont', 'headingFont'] as const) {
        const value = result.typography?.[key];
        if (value !== undefined && !isUserFontChoice(value)) {
            delete result.typography![key];
        }
    }
    for (const key of [
        'borderWidthSubtlePx',
        'borderWidthPx',
        'borderWidthStrongPx',
    ] as const) {
        const value = result.shape?.[key];
        if (value !== undefined) {
            result.shape![key] = Math.max(0, Math.min(6, value));
        }
    }
    for (const key of [
        'borderRadiusSmallPx',
        'borderRadiusPx',
        'borderRadiusLargePx',
    ] as const) {
        const value = result.shape?.[key];
        if (value !== undefined) {
            result.shape![key] = Math.max(0, Math.min(32, value));
        }
    }
    for (const layer of [
        result.backgrounds?.content?.base,
        result.backgrounds?.content?.overlay,
        result.backgrounds?.sidebar,
    ]) {
        if (layer?.opacity !== undefined) {
            layer.opacity = Math.max(0, Math.min(1, layer.opacity));
        }
    }
    for (const group of ['density', 'elevation'] as const) {
        const value = result[group];
        if (!value) continue;
        if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
            delete value.enabled;
        }
        if (
            value.preset !== undefined &&
            (group === 'density'
                ? !isDensityPreset(value.preset)
                : !isElevationPreset(value.preset))
        ) {
            delete value.preset;
        }
    }
    return result;
}

function mergeRecords(
    base: Record<string, unknown>,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const result = { ...base } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const previous = result[key];
        result[key] =
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value)
                ? mergeRecords(
                      previous && typeof previous === 'object' && !Array.isArray(previous)
                          ? (previous as Record<string, unknown>)
                          : {},
                      value as Record<string, unknown>
                  )
                : value;
    }
    return result;
}

function deepMerge(
    base: UserThemeOverrides,
    patch: Partial<UserThemeOverrides>
): UserThemeOverrides {
    return mergeRecords(
        base as unknown as Record<string, unknown>,
        patch as unknown as Record<string, unknown>
    ) as unknown as UserThemeOverrides;
}
