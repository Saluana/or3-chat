import { ref, shallowRef, type Ref } from 'vue';
import { callWithNuxt, type NuxtApp } from '#app';
import { useAppConfig, useHead, useRuntimeConfig } from '#imports';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import type { CompiledTheme, ThemePlugin } from '~/theme/_shared/types';
import { IconRegistry } from '~/theme/_shared/icon-registry';
import { prepareThemeEntry } from '~/theme/_shared/prepare-theme';
import {
    loadThemeManifest,
    resolveThemeStylesheetHref,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';
import { pickDefaultTheme } from '~/theme/_shared/default-theme';
import { FALLBACK_THEME_NAME } from '~/theme/_shared/constants';
import {
    cloneDeep,
    computeEffectiveAppConfig,
    replaceReactiveObject,
    sanitizeThemeName,
    readCookie,
} from '~/theme/_shared/theme-core';
import {
    ensureThemeLoaded as ensureThemeLoadedShared,
    setActiveThemeSafe,
    type ThemeLoadState,
} from '~/theme/_shared/theme-loader';
import {
    CORE_APP_COMPONENT_DEFAULTS,
    createThemeComponentMap,
} from '~/theme/_shared/theme-components-registry';

export default defineNuxtPlugin(async (nuxtApp) => {
    const ACTIVE_THEME_COOKIE = 'or3_active_theme';
    const iconRegistry = new IconRegistry();

    const manifestResult = await loadThemeManifest();
    const manifestEntries = manifestResult.entries;
    const themeManifest = new Map<string, ThemeManifestEntry>();
    for (const entry of manifestEntries) {
        themeManifest.set(entry.name, entry);
    }
    const runtimeConfig = useRuntimeConfig();
    const activeComponents = shallowRef({
        ...CORE_APP_COMPONENT_DEFAULTS,
    });

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

    const applyEffectiveAppConfig = (
        theme?: CompiledTheme | null,
        patch?: Record<string, unknown> | null
    ) => {
        replaceReactiveObject(
            appConfig,
            computeEffectiveAppConfig(baseAppConfig, {
                appPatch: patch,
                uiPatch: theme?.ui,
            })
        );
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
        runtimeConfig.public?.branding?.defaultTheme;
    const normalizedConfiguredDefault =
        typeof configuredDefaultTheme === 'string' &&
        configuredDefaultTheme !== 'system'
            ? configuredDefaultTheme
            : null;
    const defaultDecision = pickDefaultTheme({
        manifestNames: manifestEntries.map((entry) => entry.name),
        manifestDefaultName:
            manifestEntries.find((entry) => entry.isDefault)?.name ?? null,
        configuredDefaultName: normalizedConfiguredDefault,
        fallbackThemeName: FALLBACK_THEME_NAME,
    });
    const DEFAULT_THEME = defaultDecision.defaultTheme;
    const branding = (runtimeConfig.public as Record<string, unknown>).branding as
        | Record<string, unknown>
        | undefined;
    const disabledThemes = new Set(
        Array.isArray(branding?.disabledThemes)
            ? (branding.disabledThemes as string[]).filter(Boolean)
            : []
    );

    if (
        import.meta.dev &&
        normalizedConfiguredDefault &&
        !availableThemes.has(normalizedConfiguredDefault.toLowerCase())
    ) {
        console.warn(
            `[theme] Default theme "${normalizedConfiguredDefault}" not found. Falling back to "${DEFAULT_THEME}".`
        );
    }
    if (import.meta.dev) {
        for (const warning of defaultDecision.warnings) {
            console.warn(warning);
        }
        if (manifestResult.errors.length > 0) {
            console.warn('[theme] Manifest contained load errors.', manifestResult.errors);
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
    const loadState: ThemeLoadState = {
        loadedThemes: new Set<string>(),
        loadingThemes: new Map<string, Promise<boolean>>(),
    };

    // Use imported sanitizeThemeName with availableThemes
    const sanitize = (name: string | null) => sanitizeThemeName(name, availableThemes);

    const registerThemeFromEntry = async (manifestEntry: ThemeManifestEntry) => {
        const themeName = manifestEntry.name;
        if (themeRegistry.has(themeName)) {
            if (!resolverRegistry.has(themeName)) {
                resolverRegistry.set(
                    themeName,
                    new RuntimeResolver(themeRegistry.get(themeName)!)
                );
            }
            return;
        }

        const { compiledTheme, appConfig: themeSpecificConfig } =
            await prepareThemeEntry(manifestEntry);

        themeRegistry.set(themeName, compiledTheme);
        if (compiledTheme.icons) {
            iconRegistry.registerTheme(themeName, compiledTheme.icons);
        }
        themeAppConfigOverrides.set(themeName, themeSpecificConfig);
        resolverRegistry.set(themeName, new RuntimeResolver(compiledTheme));
    };

    const loadTheme = async (themeName: string): Promise<CompiledTheme | null> => {
        const loaded = await ensureThemeLoadedShared(themeName, {
            manifestByName: themeManifest,
            state: loadState,
            registerTheme: registerThemeFromEntry,
        });
        return loaded ? themeRegistry.get(themeName) ?? null : null;
    };

    const ensureThemeLoaded = async (themeName: string): Promise<boolean> => {
        const loaded = await ensureThemeLoadedShared(themeName, {
            manifestByName: themeManifest,
            state: loadState,
            registerTheme: registerThemeFromEntry,
        });
        if (loaded && !resolverRegistry.has(themeName) && themeRegistry.has(themeName)) {
            resolverRegistry.set(themeName, new RuntimeResolver(themeRegistry.get(themeName)!));
        }
        return loaded;
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
            themeAppConfigOverrides.delete(themeName);
            iconRegistry.unregisterTheme(themeName);
            loadState.loadedThemes.delete(themeName);
            loadState.loadingThemes.delete(themeName);
        }
    };

    const activeTheme = ref<string>(DEFAULT_THEME);
    const resolversVersion = ref(0);
    const bumpResolversVersion = () => {
        resolversVersion.value += 1;
    };
    const syncActiveComponents = () => {
        const compiledTheme = themeRegistry.get(activeTheme.value);
        const manifestEntry = themeManifest.get(activeTheme.value);

        activeComponents.value =
            compiledTheme && manifestEntry
                ? createThemeComponentMap(
                      manifestEntry.dirName,
                      compiledTheme.customComponents
                  )
                : { ...CORE_APP_COMPONENT_DEFAULTS };
    };

    // Ensure the default theme is available for initial SSR render
    try {
        await ensureThemeLoaded(DEFAULT_THEME);
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

    // Persist current default into the response cookies for future comparisons
    try {
        nuxtApp.ssrContext?.event.node.res.setHeader(
            'Set-Cookie',
            `${PREVIOUS_DEFAULT_COOKIE}=${encodeURIComponent(
                DEFAULT_THEME
            )}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
        );
    } catch {}

    const setActiveTheme = async (themeName: string) => {
        let target = sanitize(themeName) ?? DEFAULT_THEME;

        if (disabledThemes.has(target) && target !== DEFAULT_THEME) {
            target = DEFAULT_THEME;
        }
        if (!themeManifest.has(target) && manifestEntries[0]) {
            target = manifestEntries[0].name;
        }

        if (!themeManifest.has(target)) {
            if (import.meta.dev) {
                console.warn(
                    '[theme] No available themes to activate during SSR.'
                );
            }
            return;
        }

        const activation = await setActiveThemeSafe(target, {
            availableThemes,
            defaultTheme: DEFAULT_THEME,
            previousTheme: activeTheme.value,
            ensureLoaded: ensureThemeLoaded,
        });

        if (!activation.ok) {
            if (import.meta.dev) {
                console.warn(
                    `[theme] Failed to activate theme "${target}" during SSR (reason: ${activation.reason}).`
                );
            }
            return;
        }

        target = activation.activeTheme;

        activeTheme.value = target;
        iconRegistry.setActiveTheme(target);
        cleanupInactiveThemes(target);
        const patch = themeAppConfigOverrides.get(target) ?? null;
        const compiledTheme = themeRegistry.get(target);
        applyEffectiveAppConfig(compiledTheme ?? null, patch);
        recordInitialAppConfigPatch(patch);
        syncActiveComponents();

        // Inject CSS variables and stylesheets into the head for SSR/Static builds
        if (compiledTheme) {
            const headConfig: any = {
                htmlAttrs: {
                    'data-theme': target,
                },
                style: [],
                link: [],
            };

            if (compiledTheme.cssVariables) {
                headConfig.style.push({
                    id: `or3-theme-vars-${target}`,
                    innerHTML: compiledTheme.cssVariables,
                    tagPriority: 'critical',
                    'data-theme-style': target,
                });
            }

            // Inject generated CSS file if present
            if (compiledTheme.hasStyleSelectors) {
                headConfig.link.push({
                    key: `or3-theme-css-${target}`,
                    rel: 'stylesheet',
                    href: `/themes/${target}.css`,
                    tagPriority: 'critical',
                    'data-theme-css': target,
                });
            }

            // Inject theme stylesheets
            if (
                compiledTheme.stylesheets &&
                compiledTheme.stylesheets.length > 0
            ) {
                const manifestEntry = themeManifest.get(target);
                if (manifestEntry) {
                    for (const stylesheet of compiledTheme.stylesheets) {
                        const href = await resolveThemeStylesheetHref(
                            stylesheet,
                            manifestEntry
                        );
                        if (href) {
                            headConfig.link.push({
                                key: `or3-theme-extra-${target}-${stylesheet}`,
                                rel: 'stylesheet',
                                href: href,
                                'data-theme-stylesheet': target,
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
        getResolver,
        loadTheme,
        getTheme: (themeName: string) => themeRegistry.get(themeName) || null,
        activeComponents,
        availableThemes: manifestEntries.map((entry) => ({
            name: entry.name,
            displayName: entry.displayName,
            description: entry.description,
        })),
    };

    nuxtApp.provide('theme', themeApi);
    nuxtApp.payload.iconRegistry = iconRegistry.state;
    nuxtApp.provide('iconRegistry', iconRegistry);
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
