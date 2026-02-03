import { ref, type Ref } from 'vue';
import { callWithNuxt, type NuxtApp } from '#app';
import { useAppConfig, useHead, useRuntimeConfig } from '#imports';
import type { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import type { CompiledTheme, ThemePlugin } from '~/theme/_shared/types';
import { iconRegistry } from '~/theme/_shared/icon-registry';
import {
    loadThemeManifest,
    resolveThemeStylesheetHref,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';
import {
    cloneDeep,
    deepMerge,
    recursiveUpdate,
    readCookie,
    sanitizeThemeName,
} from '~/theme/_shared/theme-core';
import { FALLBACK_THEME_NAME } from '~/theme/_shared/constants';
import { pickDefaultTheme } from '~/theme/_shared/default-theme';
import {
    ensureThemeLoaded,
    getResolver,
    loadTheme,
    setActiveThemeSafe,
    type ThemeLoaderState,
} from '~/theme/_shared/theme-loader';

export default defineNuxtPlugin(async (nuxtApp) => {
    const ACTIVE_THEME_COOKIE = 'or3_active_theme';

    const { entries: manifestEntries, errors: manifestErrors } =
        await loadThemeManifest();
    const themeManifest = new Map<string, ThemeManifestEntry>();
    for (const entry of manifestEntries) {
        themeManifest.set(entry.name, entry);
    }
    if (import.meta.dev && manifestErrors.length > 0) {
        console.warn(
            `[theme] ${manifestErrors.length} theme(s) failed to load from the manifest.`
        );
        for (const error of manifestErrors) {
            console.warn(
                `[theme] Failed to load theme at ${error.path}:`,
                error.error
            );
        }
    }
    const runtimeConfig = useRuntimeConfig();

    const appConfig = useAppConfig() as any;
    const baseAppConfig = cloneDeep(appConfig);
    const themeAppConfigOverrides = new Map<
        string,
        Record<string, any> | null
    >();

    const recordInitialAppConfigPatch = (
        patch?: Record<string, any> | null
    ) => {
        if (!patch) return;
        const payload = (nuxtApp.payload ||= { data: {} } as any);
        payload.data = payload.data || {};
        payload.data.__or3ThemeAppConfigPatch = cloneDeep(patch);
    };

    const applyThemeAppConfigPatch = (patch?: Record<string, any> | null) => {
        const merged = deepMerge(cloneDeep(baseAppConfig), patch || undefined);
        recursiveUpdate(appConfig, merged);
    };

    const applyThemeUiConfig = (theme?: CompiledTheme | null) => {
        const startingUi = cloneDeep(appConfig.ui || {});
        const mergedUi = deepMerge(
            startingUi,
            (theme?.ui as Record<string, any> | undefined) || undefined
        );
        appConfig.ui = mergedUi;
    };

    if (manifestEntries.length === 0 && import.meta.dev) {
        console.warn(
            `[theme] No theme definitions discovered. Falling back to "${FALLBACK_THEME_NAME}".`
        );
    }

    // Read previous default from cookie to detect default changes across deploys
    const PREVIOUS_DEFAULT_COOKIE = 'or3_previous_default_theme';
    const previousDefault = readCookie(
        nuxtApp.ssrContext?.event.node.req.headers.cookie,
        PREVIOUS_DEFAULT_COOKIE
    );

    const availableThemes = new Set(themeManifest.keys());
    const configuredDefaultTheme =
        typeof runtimeConfig.public?.branding?.defaultTheme === 'string' &&
        runtimeConfig.public?.branding?.defaultTheme !== 'system'
            ? runtimeConfig.public?.branding?.defaultTheme
            : null;
    const manifestDefaultName =
        manifestEntries.find((entry) => entry.isDefault)?.name ?? null;
    const defaultDecision = pickDefaultTheme({
        manifestNames: manifestEntries.map((entry) => entry.name),
        manifestDefaultName,
        configuredDefaultName: configuredDefaultTheme,
        fallbackThemeName: FALLBACK_THEME_NAME,
    });
    const DEFAULT_THEME = defaultDecision.defaultTheme;

    if (import.meta.dev) {
        for (const warning of defaultDecision.warnings) {
            console.warn(warning);
        }
        if (
            configuredDefaultTheme &&
            !sanitizeThemeName(configuredDefaultTheme, availableThemes)
        ) {
            console.warn(
                `[theme] Default theme "${configuredDefaultTheme}" not found. Falling back to "${DEFAULT_THEME}".`
            );
        }
    }

    // SSR-safe light/dark tracking (defaults to light)
    const current = ref<'light' | 'dark'>(
        detectServerScheme(nuxtApp.ssrContext)
    );

    const set = (name: string) => {
        current.value = (name.startsWith('dark') ? 'dark' : 'light');
    };

    const toggle = () => {
        set(current.value === 'dark' ? 'light' : 'dark');
    };

    const themeRegistry = new Map<string, CompiledTheme>();
    const resolverRegistry = new Map<string, RuntimeResolver>();
    const loadingThemes = new Map<string, Promise<CompiledTheme | null>>();
    const themeLoaderState: ThemeLoaderState = {
        themeRegistry,
        resolverRegistry,
        appConfigOverrides: themeAppConfigOverrides,
        loadingThemes,
    };

    const sanitize = (name: string | null) =>
        sanitizeThemeName(name, availableThemes);

    const loadThemeByName = async (
        themeName: string
    ): Promise<CompiledTheme | null> =>
        loadTheme(themeName, themeManifest, themeLoaderState, {
            isDev: import.meta.dev,
        });

    const ensureThemeReady = async (themeName: string): Promise<boolean> =>
        ensureThemeLoaded(themeName, themeManifest, themeLoaderState, {
            isDev: import.meta.dev,
        });

    const getThemeResolver = (themeName: string): RuntimeResolver | null =>
        getResolver(themeName, DEFAULT_THEME, themeLoaderState, {
            isDev: import.meta.dev,
        });

    const activeTheme = ref<string>(DEFAULT_THEME);
    const resolversVersion = ref(0);
    const bumpResolversVersion = () => {
        resolversVersion.value += 1;
    };

    // Ensure the default theme is available for initial SSR render
    try {
        await ensureThemeReady(DEFAULT_THEME);
    } catch (error) {
        if (import.meta.dev) {
            console.warn('[theme] Failed to load default theme on SSR.', error);
        }
    }

    const cookieTheme = sanitize(
        readCookie(
            nuxtApp.ssrContext?.event.node.req.headers.cookie,
            ACTIVE_THEME_COOKIE
        )
    );

    // If previous default changed and the cookie theme equals the previous default,
    // prefer the new DEFAULT_THEME (treat as a default migration rather than an explicit user choice).
    const shouldMigrateDefault =
        previousDefault &&
        previousDefault !== DEFAULT_THEME &&
        cookieTheme === previousDefault;

    if (!shouldMigrateDefault && cookieTheme && cookieTheme !== DEFAULT_THEME) {
        try {
            const available = await ensureThemeReady(cookieTheme);

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

    // Persist current default into the response cookies for future comparisons
    try {
        nuxtApp.ssrContext?.event.node.res.setHeader(
            'Set-Cookie',
            `${PREVIOUS_DEFAULT_COOKIE}=${encodeURIComponent(
                DEFAULT_THEME
            )}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
        );
    } catch {}

    const cleanupInactiveThemes = (activeThemeName: string) => {
        const themesToKeep = new Set([activeThemeName, DEFAULT_THEME]);
        const themesToDelete: string[] = [];

        for (const [themeName] of themeRegistry) {
            if (!themesToKeep.has(themeName)) {
                themesToDelete.push(themeName);
            }
        }

        for (const themeName of themesToDelete) {
            themeRegistry.delete(themeName);
            resolverRegistry.delete(themeName);
            iconRegistry.unregisterTheme(themeName);
            themeAppConfigOverrides.delete(themeName);
        }
    };

    const setActiveTheme = async (themeName: string) => {
        if (availableThemes.size === 0) {
            if (import.meta.dev) {
                console.warn(
                    '[theme] No available themes to activate during SSR.'
                );
            }
            return;
        }

        const sanitized = sanitize(themeName);
        const requestedTheme = sanitized ?? '';
        const activation = await setActiveThemeSafe(requestedTheme, {
            availableThemes,
            defaultTheme: DEFAULT_THEME,
            previousTheme: activeTheme.value,
            ensureLoaded: ensureThemeReady,
        });

        if (!activation.ok) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to activate theme "${themeName}" during SSR. Keeping "${activeTheme.value}".`
                );
            }
            return;
        }

        if (sanitized && activation.activeTheme !== sanitized && import.meta.dev) {
            console.warn(
                `[theme] Using "${activation.activeTheme}" instead of "${sanitized}" during SSR due to load failure.`
            );
        }

        activeTheme.value = activation.activeTheme;
        iconRegistry.setActiveTheme(activation.activeTheme);
        cleanupInactiveThemes(activation.activeTheme);
        const patch = themeAppConfigOverrides.get(activation.activeTheme) ?? null;
        applyThemeAppConfigPatch(patch);
        recordInitialAppConfigPatch(patch);
        const compiledTheme = themeRegistry.get(activation.activeTheme);
        applyThemeUiConfig(compiledTheme || null);

        // Inject CSS variables and stylesheets into the head for SSR/Static builds
        if (compiledTheme) {
            const headConfig: any = {
                htmlAttrs: {
                    'data-theme': activation.activeTheme,
                },
                style: [],
                link: [],
            };

            if (compiledTheme.cssVariables) {
                headConfig.style.push({
                    id: `or3-theme-vars-${activation.activeTheme}`,
                    innerHTML: compiledTheme.cssVariables,
                    tagPriority: 'critical',
                    'data-theme-style': activation.activeTheme,
                });
            }

            // Inject generated CSS file if present
            if (compiledTheme.hasStyleSelectors) {
                headConfig.link.push({
                    key: `or3-theme-css-${activation.activeTheme}`,
                    rel: 'stylesheet',
                    href: `/themes/${activation.activeTheme}.css`,
                    tagPriority: 'critical',
                    'data-theme-css': activation.activeTheme,
                });
            }

            // Inject theme stylesheets
            if (
                compiledTheme.stylesheets &&
                compiledTheme.stylesheets.length > 0
            ) {
                const manifestEntry = themeManifest.get(activation.activeTheme);
                if (manifestEntry) {
                    for (const stylesheet of compiledTheme.stylesheets) {
                        const href = await resolveThemeStylesheetHref(
                            stylesheet,
                            manifestEntry
                        );
                        if (href) {
                            headConfig.link.push({
                                key: `or3-theme-extra-${activation.activeTheme}-${stylesheet}`,
                                rel: 'stylesheet',
                                href: href,
                                'data-theme-stylesheet': activation.activeTheme,
                            });
                        }
                    }
                }
            }

            // Use callWithNuxt to preserve context through async operations
            await callWithNuxt(nuxtApp, () => useHead(headConfig));
        }

        bumpResolversVersion();
    };

    await setActiveTheme(activeTheme.value);

    const themeApi: ThemePlugin = {
        set,
        toggle,
        get: () => current.value,
        system: () => current.value,
        current: current as Ref<string>,
        activeTheme,
        resolversVersion,
        setActiveTheme,
        getResolver: getThemeResolver,
        loadTheme: loadThemeByName,
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

// Utility functions (cloneDeep, deepMerge, recursiveUpdate, readCookie, sanitizeThemeName)
// are now imported from ~/theme/_shared/theme-core.ts
