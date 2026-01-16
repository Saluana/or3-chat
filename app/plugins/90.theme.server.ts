import { ref, type Ref } from 'vue';
import { callWithNuxt, type NuxtApp } from '#app';
import { useAppConfig, useHead } from '#imports';
import { RuntimeResolver } from '~/theme/_shared/runtime-resolver';
import { compileOverridesRuntime } from '~/theme/_shared/runtime-compile';
import type { CompiledTheme } from '~/theme/_shared/types';
import type { ThemePlugin } from './90.theme.client';
import { generateThemeCssVariables } from '~/theme/_shared/generate-css-variables';
import { iconRegistry } from '~/theme/_shared/icon-registry';
import {
    loadThemeManifest,
    loadThemeStylesheets,
    updateManifestEntry,
    loadThemeAppConfig,
    resolveThemeStylesheetHref,
    type ThemeManifestEntry,
} from '~/theme/_shared/theme-manifest';
import {
    cloneDeep,
    deepMerge,
    recursiveUpdate,
    sanitizeThemeName,
    readCookie,
} from '~/theme/_shared/theme-core';

export default defineNuxtPlugin(async (nuxtApp) => {
    const ACTIVE_THEME_COOKIE = 'or3_active_theme';

    const manifestEntries = await loadThemeManifest();
    const themeManifest = new Map<string, ThemeManifestEntry>();
    for (const entry of manifestEntries) {
        themeManifest.set(entry.name, entry);
    }

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
            '[theme] No theme definitions discovered. Falling back to "retro".'
        );
    }

    const DEFAULT_THEME =
        manifestEntries.find((entry) => entry.isDefault)?.name ??
        manifestEntries[0]?.name ??
        'retro';

    // Read previous default from cookie to detect default changes across deploys
    const PREVIOUS_DEFAULT_COOKIE = 'or3_previous_default_theme';
    const previousDefault = readCookie(
        nuxtApp.ssrContext?.event.node.req.headers.cookie,
        PREVIOUS_DEFAULT_COOKIE
    );

    const availableThemes = new Set(themeManifest.keys());

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

    // Use imported sanitizeThemeName with availableThemes
    const sanitize = (name: string | null) => sanitizeThemeName(name, availableThemes);

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

                // Load icons if defined directly in the theme or via a companion module
                let themeIcons = definition.icons;
                if (!themeIcons && manifestEntry.iconsLoader) {
                    try {
                        const iconsModule = await manifestEntry.iconsLoader();
                        themeIcons = iconsModule?.default || iconsModule;
                    } catch (e) {
                        if (import.meta.dev) {
                            console.warn(
                                `[theme] Failed to load icons for theme "${themeName}" during SSR:`,
                                e
                            );
                        }
                    }
                }

                const compiledTheme: CompiledTheme = {
                    name: definition.name,
                    isDefault: manifestEntry.isDefault,
                    stylesheets: manifestEntry.stylesheets,
                    displayName: definition.displayName,
                    description: definition.description,
                    cssVariables: generateThemeCssVariables(definition),
                    overrides: compileOverridesRuntime(
                        definition.overrides || {}
                    ),
                    cssSelectors: definition.cssSelectors,
                    ui: definition.ui,
                    propMaps: definition.propMaps,
                    backgrounds: definition.backgrounds,
                    icons: themeIcons,
                };

                themeRegistry.set(themeName, compiledTheme);
                if (compiledTheme.icons) {
                    iconRegistry.registerTheme(themeName, compiledTheme.icons);
                }
                const themeSpecificConfig =
                    (await loadThemeAppConfig(manifestEntry)) ?? null;
                themeAppConfigOverrides.set(themeName, themeSpecificConfig);

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
    const resolversVersion = ref(0);
    const bumpResolversVersion = () => {
        resolversVersion.value += 1;
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
        let target = sanitize(themeName);

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
            iconRegistry.setActiveTheme(fallback);
            bumpResolversVersion();
            return;
        }

        activeTheme.value = target;
        iconRegistry.setActiveTheme(target);
        const patch = themeAppConfigOverrides.get(target) ?? null;
        applyThemeAppConfigPatch(patch);
        recordInitialAppConfigPatch(patch);
        const compiledTheme = themeRegistry.get(target);
        applyThemeUiConfig(compiledTheme || null);

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
