import { ref, type Ref } from 'vue';
import type { NuxtApp } from '#app';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import { compileOverridesRuntime } from '~/theme/_shared/runtime-compile';
import type { CompiledTheme } from '~/theme/_shared/types';
import type { ThemePlugin } from './01.theme.client';
import {
    loadThemeManifest,
    loadThemeStylesheets,
    updateManifestEntry,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';

export default defineNuxtPlugin(async (nuxtApp) => {
    const ACTIVE_THEME_COOKIE = 'or3_active_theme';

    const manifestEntries = await loadThemeManifest();
    const themeManifest = new Map<string, ThemeManifestEntry>();
    for (const entry of manifestEntries) {
        themeManifest.set(entry.name, entry);
    }

    if (manifestEntries.length === 0 && import.meta.dev) {
        console.warn(
            '[theme] No theme definitions discovered. Falling back to "retro".'
        );
    }

    const DEFAULT_THEME =
        manifestEntries.find((entry) => entry.isDefault)?.name ??
        manifestEntries[0]?.name ??
        'retro';

    const availableThemes = new Set(themeManifest.keys());

    // SSR-safe light/dark tracking (defaults to light)
    const current = ref<'light' | 'dark'>(
        detectServerScheme(nuxtApp.ssrContext)
    );

    const set = (name: string) => {
        current.value = (name.startsWith('dark') ? 'dark' : 'light') as
            | 'light'
            | 'dark';
    };

    const toggle = () => {
        set(current.value === 'dark' ? 'light' : 'dark');
    };

    const themeRegistry = new Map<string, CompiledTheme>();
    const resolverRegistry = new Map<string, RuntimeResolver>();

    const sanitizeThemeName = (themeName: string | null) => {
        if (!themeName) return null;
        if (!/^[a-z0-9-]+$/i.test(themeName)) return null;
        if (!availableThemes.has(themeName)) return null;
        return themeName;
    };

    const loadTheme = async (
        themeName: string
    ): Promise<CompiledTheme | null> => {
        try {
            const manifestEntry = themeManifest.get(themeName);

            if (!manifestEntry) {
                if (import.meta.dev) {
                    console.warn(
                        `[theme] Theme "${themeName}" is not registered.`
                    );
                }
                return null;
            }

            const themeModule = await manifestEntry.loader();

            if (themeModule?.default) {
                const definition = themeModule.default;
                updateManifestEntry(manifestEntry, definition);

                await loadThemeStylesheets(
                    manifestEntry,
                    definition.stylesheets
                );

                const compiledTheme: CompiledTheme = {
                    name: definition.name,
                    isDefault: manifestEntry.isDefault,
                    stylesheets: manifestEntry.stylesheets,
                    displayName: definition.displayName,
                    description: definition.description,
                    cssVariables: '',
                    overrides: compileOverridesRuntime(
                        definition.overrides || {}
                    ),
                    cssSelectors: definition.cssSelectors,
                    ui: definition.ui,
                    propMaps: definition.propMaps,
                    backgrounds: definition.backgrounds,
                };

                themeRegistry.set(themeName, compiledTheme);

                const resolver = new RuntimeResolver(compiledTheme);
                resolverRegistry.set(themeName, resolver);

                return compiledTheme;
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load theme "${themeName}":`,
                    error
                );
            }
        }

        return null;
    };

    const ensureThemeLoaded = async (themeName: string): Promise<boolean> => {
        if (resolverRegistry.has(themeName)) {
            return true;
        }

        if (themeRegistry.has(themeName)) {
            const cached = themeRegistry.get(themeName)!;
            const resolver = new RuntimeResolver(cached);
            resolverRegistry.set(themeName, resolver);
            return true;
        }

        const loaded = await loadTheme(themeName);
        return Boolean(loaded);
    };

    const getResolver = (themeName: string): RuntimeResolver | null => {
        if (resolverRegistry.has(themeName)) {
            return resolverRegistry.get(themeName)!;
        }

        if (themeRegistry.has(themeName)) {
            const resolver = new RuntimeResolver(themeRegistry.get(themeName)!);
            resolverRegistry.set(themeName, resolver);
            return resolver;
        }

        if (
            themeName !== DEFAULT_THEME &&
            resolverRegistry.has(DEFAULT_THEME)
        ) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] No resolver found for theme "${themeName}". Falling back to "${DEFAULT_THEME}".`
                );
            }
            return resolverRegistry.get(DEFAULT_THEME)!;
        }

        if (import.meta.dev) {
            console.warn(
                `[theme] No resolver found for theme "${themeName}". Theme may not be compiled.`
            );
        }

        return null;
    };

    const activeTheme = ref<string>(DEFAULT_THEME);

    // Ensure the default theme is available for initial SSR render
    try {
        await ensureThemeLoaded(DEFAULT_THEME);
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[theme] Failed to load default theme on SSR.', error);
        }
    }

    const cookieTheme = sanitizeThemeName(
        readActiveThemeCookie(
            nuxtApp.ssrContext?.event.node.req.headers.cookie,
            ACTIVE_THEME_COOKIE
        )
    );

    if (cookieTheme && cookieTheme !== DEFAULT_THEME) {
        try {
            const available = await ensureThemeLoaded(cookieTheme);

            if (available) {
                activeTheme.value = cookieTheme;
            } else if (import.meta.dev) {
                console.warn(
                    `[theme] Cookie theme "${cookieTheme}" unavailable on SSR. Using "${DEFAULT_THEME}".`
                );
            }
        } catch (error) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to initialize cookie theme "${cookieTheme}" on SSR. Using "${DEFAULT_THEME}".`,
                    error
                );
            }
        }
    }

    const setActiveTheme = async (themeName: string) => {
        let target = sanitizeThemeName(themeName);

        if (!target) {
            if (themeManifest.has(DEFAULT_THEME)) {
                target = DEFAULT_THEME;
            } else if (manifestEntries[0]) {
                target = manifestEntries[0].name;
            } else {
                if (import.meta.dev) {
                    console.warn(
                        '[theme] No available themes to activate during SSR.'
                    );
                }
                return;
            }
        }

        const available = await ensureThemeLoaded(target);

        if (!available) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to load theme "${target}" during SSR. Falling back to "${DEFAULT_THEME}".`
                );
            }

            const fallback = themeManifest.has(DEFAULT_THEME)
                ? DEFAULT_THEME
                : manifestEntries.find((entry) => entry.name !== target)?.name;

            if (!fallback) {
                return;
            }

            activeTheme.value = fallback;
            return;
        }

        activeTheme.value = target;
    };

    const themeApi: ThemePlugin = {
        set,
        toggle,
        get: () => current.value,
        system: () => current.value,
        current: current as Ref<string>,
        activeTheme,
        setActiveTheme,
        getResolver,
        loadTheme,
        getTheme: (themeName: string) => themeRegistry.get(themeName) || null,
    };

    nuxtApp.provide('theme', themeApi);
});

function detectServerScheme(
    ssrContext: NuxtApp['ssrContext']
): 'light' | 'dark' {
    const headerValue =
        ssrContext?.event.node.req.headers['sec-ch-prefers-color-scheme'];

    if (typeof headerValue === 'string') {
        return headerValue.includes('dark') ? 'dark' : 'light';
    }

    return 'light';
}

function readActiveThemeCookie(
    cookieHeader: string | undefined,
    cookieName: string
): string | null {
    if (!cookieHeader) return null;

    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
        const [rawName, ...rest] = pair.trim().split('=');
        if (rawName === cookieName) {
            return decodeURIComponent(rest.join('='));
        }
    }

    return null;
}
