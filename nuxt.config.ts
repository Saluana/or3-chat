// https://nuxt.com/docs/api/configuration/nuxt-config
import { themeCompilerPlugin } from './plugins/vite-theme-compiler';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'path';
import * as ts from 'typescript';
import { createLogger } from 'vite';
import { or3CloudConfig } from './config.or3cloud';
import { or3Config } from './config.or3';
import { printStartupBanner as printOr3StartupBanner } from './shared/dev/startup-banner';
import {
    discoverNonCorePlugins,
    isNonCorePluginDiscoveryDisabled,
} from './shared/plugins/safe-mode';
import { providerIdToModuleId } from './shared/cloud/provider-compatibility';

// SSR auth is gated by environment variable to preserve static builds
const isSsrAuthEnabled = or3CloudConfig.auth.enabled;
const disableNonCorePlugins = isNonCorePluginDiscoveryDisabled(
    or3CloudConfig.admin,
);
const isWizardUiProcess = process.env.OR3_WIZARD_UI_ENABLED === 'true';
const isScrollTestHarnessEnabled =
    process.env.OR3_SCROLL_TEST_HARNESS === 'true';
const isProductionJourneyTestHarnessEnabled =
    process.env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS === 'true';
const productionJourneyPort = Number(process.env.PW_PORT || 3000);
const productionJourneyOpenRouterBaseUrl =
    `http://127.0.0.1:${
        Number.isInteger(productionJourneyPort) ? productionJourneyPort : 3000
    }/api/__or3-e2e`;
const isStaticGenerateBuild = process.argv.includes('generate');
const isStaticCloudDisabledBuild = isStaticGenerateBuild && !isSsrAuthEnabled;
const shouldLoadCloudProviderModules =
    !isWizardUiProcess && !isStaticCloudDisabledBuild;

const convexUrl = or3CloudConfig.sync.convex?.url || '';
const convexAdminKey = or3CloudConfig.sync.convex?.adminKey || '';

function isPackageInstalled(pkgName: string): boolean {
    return existsSync(resolve(__dirname, 'node_modules', pkgName));
}

function isProviderAvailable(providerId: string): boolean {
    const moduleId = providerIdToModuleId(providerId);
    if (!moduleId) return true;
    const pkgName = moduleId.split('/')[0];
    return Boolean(pkgName && isPackageInstalled(pkgName));
}

function loadGeneratedProviderModules(): string[] {
    if (!shouldLoadCloudProviderModules) {
        return [];
    }

    const generatedModulesPath = resolve(
        __dirname,
        'or3.providers.generated.ts',
    );
    if (!existsSync(generatedModulesPath)) {
        return [];
    }

    try {
        const source = readFileSync(generatedModulesPath, 'utf8');
        const transpiled = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText;
        const module = { exports: {} as { or3ProviderModules?: unknown } };
        const exports = module.exports;
        const evaluate = new Function('module', 'exports', transpiled);
        evaluate(module, exports);

        const parsed = module.exports.or3ProviderModules;
        if (!Array.isArray(parsed)) {
            console.warn(
                `[or3-provider] Could not parse generated provider modules from "${generatedModulesPath}".`,
            );
            return [];
        }

        return parsed.filter(
            (entry): entry is string => typeof entry === 'string',
        );
    } catch (error) {
        console.warn(
            `[or3-provider] Failed to read generated provider modules from "${generatedModulesPath}": ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        return [];
    }
}

const or3ProviderModules = loadGeneratedProviderModules();

const providerIdsFromConfig = new Set<string>();
if (shouldLoadCloudProviderModules) {
    if (or3CloudConfig.auth.enabled)
        providerIdsFromConfig.add(or3CloudConfig.auth.provider);
    if (or3CloudConfig.sync.enabled)
        providerIdsFromConfig.add(or3CloudConfig.sync.provider);
    if (or3CloudConfig.storage.enabled)
        providerIdsFromConfig.add(or3CloudConfig.storage.provider);
    if (
        or3CloudConfig.limits?.enabled &&
        or3CloudConfig.limits.storageProvider
    ) {
        providerIdsFromConfig.add(or3CloudConfig.limits.storageProvider);
    }
    if (
        or3CloudConfig.backgroundStreaming?.enabled &&
        or3CloudConfig.backgroundStreaming.storageProvider
    ) {
        providerIdsFromConfig.add(
            or3CloudConfig.backgroundStreaming.storageProvider,
        );
    }
}

const providerModulesFromConfig: string[] = [];
for (const providerId of providerIdsFromConfig) {
    const moduleId = providerIdToModuleId(providerId);
    if (!moduleId) continue;
    const pkgName = moduleId.split('/')[0];
    if (pkgName && isPackageInstalled(pkgName)) {
        providerModulesFromConfig.push(moduleId);
    } else {
        console.warn(
            `[or3-provider] Configured provider "${providerId}" expects package "${pkgName}", but it is not installed.`,
        );
    }
}

const configuredPluginModules =
    discoverNonCorePlugins(
        or3CloudConfig.admin,
        () =>
            or3Config.extensions?.plugins?.modules?.filter((entry) =>
                typeof entry === 'string' ? entry.trim().length > 0 : false,
            ) ?? [],
    ) ?? [];
const pluginModulesFromConfig: string[] = [];
for (const moduleId of configuredPluginModules) {
    const pkgName = moduleId.split('/')[0];
    if (!pkgName) {
        console.warn(
            `[or3-plugin] Ignoring invalid plugin module id "${moduleId}".`,
        );
        continue;
    }
    if (isStaticCloudDisabledBuild && pkgName.startsWith('or3-provider-')) {
        continue;
    }
    if (!isPackageInstalled(pkgName)) {
        console.warn(
            `[or3-plugin] Configured plugin module "${moduleId}" expects package "${pkgName}", but it is not installed.`,
        );
        continue;
    }
    pluginModulesFromConfig.push(moduleId);
}

const generatedProviderModules: string[] = [];
for (const moduleId of or3ProviderModules) {
    const pkgName = moduleId.split('/')[0];
    if (!pkgName) {
        console.warn(
            `[or3-provider] Ignoring invalid generated provider module id "${moduleId}".`,
        );
        continue;
    }
    if (!isPackageInstalled(pkgName)) {
        console.warn(
            `[or3-provider] Generated provider module "${moduleId}" expects package "${pkgName}", but it is not installed yet.`,
        );
        continue;
    }
    generatedProviderModules.push(moduleId);
}

const activeProviderModules = Array.from(
    new Set([
        ...generatedProviderModules,
        ...providerModulesFromConfig,
        ...pluginModulesFromConfig,
    ]),
);

const authProviderAvailable =
    isStaticCloudDisabledBuild ||
    isProviderAvailable(or3CloudConfig.auth.provider);
const syncProviderAvailable =
    isStaticCloudDisabledBuild ||
    isProviderAvailable(or3CloudConfig.sync.provider);
const storageProviderAvailable =
    isStaticCloudDisabledBuild ||
    isProviderAvailable(or3CloudConfig.storage.provider);

const effectiveSsrAuthEnabled =
    isSsrAuthEnabled && authProviderAvailable && syncProviderAvailable;

const resolvedRegistrationMode =
    or3CloudConfig.auth.registrationMode ??
    ((or3CloudConfig.auth.autoProvision ?? true) ? 'open' : 'disabled');
const effectiveSyncEnabled =
    effectiveSsrAuthEnabled &&
    or3CloudConfig.sync.enabled &&
    syncProviderAvailable;
const effectiveStorageEnabled =
    effectiveSsrAuthEnabled &&
    or3CloudConfig.storage.enabled &&
    storageProviderAvailable;

if (isSsrAuthEnabled && !authProviderAvailable) {
    console.warn(
        `[or3-provider] Auth provider "${or3CloudConfig.auth.provider}" is not available. Falling back to local-only auth mode.`,
    );
}
if (isSsrAuthEnabled && !syncProviderAvailable) {
    console.warn(
        `[or3-provider] Sync provider "${or3CloudConfig.sync.provider}" is not available. SSR auth requires the matching AuthWorkspaceStore, so cloud auth and sync are disabled.`,
    );
}
if (or3CloudConfig.storage.enabled && !storageProviderAvailable) {
    console.warn(
        `[or3-provider] Storage provider "${or3CloudConfig.storage.provider}" is not available. Cloud storage is disabled.`,
    );
}
// Branding defaults (sourced from or3Config)
const appName = or3Config.site.name;
const appShortName = appName.length > 12 ? appName.slice(0, 12) : appName;
const pwaNavigateFallback = isStaticGenerateBuild ? '/index.html' : null;
const pwaOpenRouterCallbackFallback = isStaticGenerateBuild
    ? '/openrouter-callback/index.html'
    : undefined;

// Shared config objects (DRY: used in both server and public runtimeConfig)
const limitsConfig = {
    enabled: or3CloudConfig.limits!.enabled!,
    requestsPerMinute: or3CloudConfig.limits!.requestsPerMinute!,
    maxConversations: or3CloudConfig.limits!.maxConversations!,
    maxMessagesPerDay: or3CloudConfig.limits!.maxMessagesPerDay!,
    storageProvider: or3CloudConfig.limits!.storageProvider || 'memory',
    operationRateLimits: or3CloudConfig.limits!.operationRateLimits || {},
};
const publicLimitsConfig = {
    enabled: limitsConfig.enabled,
    requestsPerMinute: limitsConfig.requestsPerMinute,
    maxConversations: limitsConfig.maxConversations,
    maxMessagesPerDay: limitsConfig.maxMessagesPerDay,
};
const brandingConfig = {
    appName: or3Config.site.name,
    logoUrl: or3Config.site.logoUrl,
    defaultTheme: or3Config.site.defaultTheme,
    disabledThemes: or3Config.site.disabledThemes,
};
const legalConfig = {
    termsUrl: or3Config.legal.termsUrl,
    privacyUrl: or3Config.legal.privacyUrl,
};
const adminConfig = {
    basePath: or3CloudConfig.admin?.basePath || '/admin',
    allowedHosts: or3CloudConfig.admin?.allowedHosts || [],
    allowRestart: Boolean(or3CloudConfig.admin?.allowRestart),
    allowRebuild: Boolean(or3CloudConfig.admin?.allowRebuild),
    disableNonCorePlugins,
    pluginRuntimeShadowEnabled:
        or3CloudConfig.admin?.pluginRuntimeShadowEnabled !== false,
    pluginRuntimeLoaderEnabled:
        or3CloudConfig.admin?.pluginRuntimeLoaderEnabled !== false,
    pluginRuntimeV2Enabled:
        or3CloudConfig.admin?.pluginRuntimeV2Enabled === true,
    pluginRuntimeV2WorkspaceIds:
        or3CloudConfig.admin?.pluginRuntimeV2WorkspaceIds ?? [],
    pluginContributionV2Surfaces:
        or3CloudConfig.admin?.pluginContributionV2Surfaces ?? [],
    hookEngineV2Enabled: or3CloudConfig.admin?.hookEngineV2Enabled === true,
    pluginModuleLoaderV2Enabled:
        or3CloudConfig.admin?.pluginModuleLoaderV2Enabled === true,
    pluginIsolationEnabled:
        or3CloudConfig.admin?.pluginIsolationEnabled === true,
    pluginZipInstallEnabled:
        or3CloudConfig.admin?.pluginZipInstallEnabled !== false,
    pluginRouteDispatcherEnabled:
        or3CloudConfig.admin?.pluginRouteDispatcherEnabled !== false,
    rebuildCommand: or3CloudConfig.admin?.rebuildCommand || 'bun run build',
    extensionMaxZipBytes: or3CloudConfig.admin?.extensionMaxZipBytes
        ? String(or3CloudConfig.admin.extensionMaxZipBytes)
        : undefined,
    extensionMaxFiles: or3CloudConfig.admin?.extensionMaxFiles
        ? String(or3CloudConfig.admin.extensionMaxFiles)
        : undefined,
    extensionMaxTotalBytes: or3CloudConfig.admin?.extensionMaxTotalBytes
        ? String(or3CloudConfig.admin.extensionMaxTotalBytes)
        : undefined,
    extensionAllowedExtensions: or3CloudConfig.admin?.extensionAllowedExtensions
        ? or3CloudConfig.admin.extensionAllowedExtensions.join(',')
        : undefined,
    // Admin auth configuration (server-only, never expose secrets to client)
    auth: {
        username: or3CloudConfig.admin?.auth?.username ?? '',
        password: or3CloudConfig.admin?.auth?.password ?? '',
        jwtSecret: or3CloudConfig.admin?.auth?.jwtSecret ?? '',
        jwtExpiry: or3CloudConfig.admin?.auth?.jwtExpiry || '24h',
        deletedWorkspaceRetentionDays:
            or3CloudConfig.admin?.auth?.deletedWorkspaceRetentionDays !==
            undefined
                ? String(
                      or3CloudConfig.admin?.auth?.deletedWorkspaceRetentionDays,
                  )
                : '',
    },
};
const lockPageConfig = {
    enabled:
        effectiveSsrAuthEnabled &&
        (or3CloudConfig.auth.lockPage?.enabled ?? false),
    adapter: or3CloudConfig.auth.lockPage?.adapter || 'default',
};
const webhooksConfig = {
    enabled: or3CloudConfig.webhooks?.enabled ?? false,
    maxPerUser: or3CloudConfig.webhooks?.maxPerUser ?? 20,
    adminMax: or3CloudConfig.webhooks?.adminMax ?? 50,
    rateLimitPerMinute: or3CloudConfig.webhooks?.rateLimitPerMinute ?? 120,
    deliveryTimeoutMs: or3CloudConfig.webhooks?.deliveryTimeoutMs ?? 10_000,
    blockPrivateIps: or3CloudConfig.webhooks?.blockPrivateIps ?? false,
    encryptionKey: or3CloudConfig.webhooks?.encryptionKey ?? '',
    maxRetryHours: or3CloudConfig.webhooks?.maxRetryHours ?? 1,
    logRetentionHours: or3CloudConfig.webhooks?.logRetentionHours ?? 72,
};

const viteLogger = createLogger();
const viteWarn = viteLogger.warn;
viteLogger.warn = (msg, options) => {
    if (
        msg.includes('Failed to load source map for') &&
        msg.includes('/node_modules/@openrouter/sdk/')
    ) {
        return;
    }
    viteWarn(msg, options);
};

export default defineNuxtConfig({
    app: {
        head: {
            link: [
                {
                    rel: 'icon',
                    type: 'image/svg+xml',
                    href:
                        or3Config.site.faviconUrl || '/logos/icon-logo-svg.svg',
                },
                {
                    rel: 'icon',
                    type: 'image/x-icon',
                    href: or3Config.site.faviconUrl || '/favicon.ico',
                    sizes: '32x32',
                },
                {
                    rel: 'apple-touch-icon',
                    sizes: '192x192',
                    href: '/logos/logo-192.png',
                },
            ],
        },
    },
    alias: {
        types: resolve(__dirname, './types'),
        '~/types': resolve(__dirname, './types'),
        '~~/shared': resolve(__dirname, './shared'),
    },
    // Disable SSR for test pages to avoid hydration mismatches
    routeRules: {
        '/_tests/**': { ssr: false },
        ...(isScrollTestHarnessEnabled
            ? { '/__or3-scroll-test': { ssr: false } }
            : {}),
        ...(isProductionJourneyTestHarnessEnabled
            ? {
                  '/__or3-chat-journey-test': { ssr: false },
                  '/__or3-document-journey-test': { ssr: false },
              }
            : {}),
    },
    compatibilityDate: '2025-07-15',
    runtimeConfig: {
        // Server-only env variables (auto-mapped from NUXT_*)
        openrouterApiKey:
            or3CloudConfig.services.llm?.openRouter?.instanceApiKey || '',
        openrouterBaseUrl:
            isProductionJourneyTestHarnessEnabled
                ? productionJourneyOpenRouterBaseUrl
                : or3CloudConfig.services.llm?.openRouter?.baseUrl ||
                  'https://openrouter.ai/api/v1',
        openrouterAllowUserOverride:
            or3CloudConfig.services.llm?.openRouter?.allowUserOverride ?? true,
        openrouterRequireUserKey:
            or3CloudConfig.services.llm?.openRouter?.requireUserKey ?? false,
        clerkSecretKey: '', // Auto-mapped from NUXT_CLERK_SECRET_KEY
        auth: {
            enabled: effectiveSsrAuthEnabled,
            provider: or3CloudConfig.auth.provider,
            autoProvision: or3CloudConfig.auth.autoProvision ?? true,
            registrationMode: resolvedRegistrationMode,
            sessionProvisioningFailure:
                or3CloudConfig.auth.sessionProvisioningFailure ?? 'throw',
            lockPage: lockPageConfig,
            invite: {
                tokenSecret: process.env.OR3_AUTH_INVITE_TOKEN_SECRET,
                tokenTtlSeconds: process.env.OR3_AUTH_INVITE_TOKEN_TTL_SECONDS
                    ? Number(process.env.OR3_AUTH_INVITE_TOKEN_TTL_SECONDS)
                    : 7 * 24 * 60 * 60,
            },
        },
        sync: {
            enabled: effectiveSyncEnabled,
            provider: or3CloudConfig.sync.provider,
            convexUrl,
            convexAdminKey,
        },
        storage: {
            enabled: effectiveStorageEnabled,
            provider: or3CloudConfig.storage.provider,
            allowedMimeTypes:
                or3CloudConfig.storage.allowedMimeTypes ?? undefined,
            workspaceQuotaBytes:
                or3CloudConfig.storage.workspaceQuotaBytes !== undefined
                    ? String(or3CloudConfig.storage.workspaceQuotaBytes)
                    : undefined,
            gcRetentionSeconds:
                or3CloudConfig.storage.gcRetentionSeconds !== undefined
                    ? String(or3CloudConfig.storage.gcRetentionSeconds)
                    : undefined,
            gcCooldownMs:
                or3CloudConfig.storage.gcCooldownMs !== undefined
                    ? String(or3CloudConfig.storage.gcCooldownMs)
                    : undefined,
        },
        limits: limitsConfig,
        branding: brandingConfig,
        legal: legalConfig,
        plugins: {
            defaultEnabled:
                or3Config.extensions?.plugins?.defaultEnabled?.filter(
                    Boolean,
                ) ?? [],
            modules:
                or3Config.extensions?.plugins?.modules?.filter(Boolean) ?? [],
        },
        security: {
            allowedOrigins: or3CloudConfig.security!.allowedOrigins!,
            forceHttps: or3CloudConfig.security!.forceHttps!,
            proxy: {
                trustProxy: or3CloudConfig.security?.proxy?.trustProxy ?? false,
                forwardedForHeader:
                    or3CloudConfig.security?.proxy?.forwardedForHeader ??
                    'x-forwarded-for',
                forwardedHostHeader:
                    or3CloudConfig.security?.proxy?.forwardedHostHeader ??
                    'x-forwarded-host',
            },
        },
        admin: adminConfig,
        webhooks: webhooksConfig,
        wizardUi: {
            enabled: process.env.OR3_WIZARD_UI_ENABLED === 'true',
            token: process.env.OR3_WIZARD_UI_TOKEN ?? '',
        },
        // Background streaming configuration (SSR mode only)
        backgroundJobs: {
            enabled: or3CloudConfig.backgroundStreaming?.enabled ?? false,
            storageProvider:
                or3CloudConfig.backgroundStreaming?.storageProvider ?? 'memory',
            maxConcurrentJobs:
                or3CloudConfig.backgroundStreaming?.maxConcurrentJobs ?? 20,
            maxConcurrentJobsPerUser:
                or3CloudConfig.backgroundStreaming?.maxConcurrentJobsPerUser ??
                5,
            jobTimeoutMs:
                (or3CloudConfig.backgroundStreaming?.jobTimeoutSeconds ?? 300) *
                1000,
            completedJobRetentionMs: 5 * 60 * 1000, // 5 minutes
        },
        public: {
            appVersion: process.env.npm_package_version || '0.1.0',
            // Single source of truth for client gating.
            // Avoid inferring enablement from presence of publishable keys.
            ssrAuthEnabled: effectiveSsrAuthEnabled,
            authProvider: or3CloudConfig.auth.provider,
            guestAccessEnabled: or3CloudConfig.auth.guestAccessEnabled ?? false,
            registrationMode: resolvedRegistrationMode,
            lockPage: lockPageConfig,
            openRouter: {
                allowUserOverride:
                    or3CloudConfig.services.llm?.openRouter
                        ?.allowUserOverride ?? true,
                hasInstanceKey: Boolean(
                    or3CloudConfig.services.llm?.openRouter?.instanceApiKey,
                ),
                requireUserKey:
                    or3CloudConfig.services.llm?.openRouter?.requireUserKey ??
                    false,
                baseUrl:
                    isProductionJourneyTestHarnessEnabled
                        ? productionJourneyOpenRouterBaseUrl
                        : or3CloudConfig.services.llm?.openRouter?.baseUrl ||
                          'https://openrouter.ai/api/v1',
            },
            storage: {
                enabled: effectiveStorageEnabled,
                provider: or3CloudConfig.storage.provider,
            },
            sync: {
                enabled: effectiveSyncEnabled,
                provider: or3CloudConfig.sync.provider,
                convexUrl,
            },
            limits: publicLimitsConfig,
            branding: brandingConfig,
            legal: legalConfig,
            backgroundStreaming: {
                enabled: or3CloudConfig.backgroundStreaming?.enabled ?? false,
                startMode:
                    or3CloudConfig.backgroundStreaming?.startMode ??
                    'foreground',
            },
            admin: {
                basePath: adminConfig.basePath,
                disableNonCorePlugins: adminConfig.disableNonCorePlugins,
                pluginRuntimeShadowEnabled:
                    adminConfig.pluginRuntimeShadowEnabled,
                pluginRuntimeLoaderEnabled:
                    adminConfig.pluginRuntimeLoaderEnabled,
                pluginRuntimeV2Enabled: adminConfig.pluginRuntimeV2Enabled,
                pluginRuntimeV2WorkspaceIds:
                    adminConfig.pluginRuntimeV2WorkspaceIds,
                pluginContributionV2Surfaces:
                    adminConfig.pluginContributionV2Surfaces,
                hookEngineV2Enabled: adminConfig.hookEngineV2Enabled,
                pluginModuleLoaderV2Enabled:
                    adminConfig.pluginModuleLoaderV2Enabled,
                pluginIsolationEnabled: adminConfig.pluginIsolationEnabled,
                pluginRouteDispatcherEnabled:
                    adminConfig.pluginRouteDispatcherEnabled,
            },
            webhooks: {
                enabled: webhooksConfig.enabled,
            },
            wizardUi: {
                enabled: process.env.OR3_WIZARD_UI_ENABLED === 'true',
            },
            // Feature toggles from OR3 config - exposed for client-side gating
            features: {
                workflows: {
                    enabled: or3Config.features.workflows.enabled,
                    editor: or3Config.features.workflows.editor,
                    slashCommands: or3Config.features.workflows.slashCommands,
                    execution: or3Config.features.workflows.execution,
                },
                documents: {
                    enabled: or3Config.features.documents.enabled,
                },
                backup: {
                    enabled: or3Config.features.backup.enabled,
                },
                mentions: {
                    enabled: or3Config.features.mentions.enabled,
                    documents: or3Config.features.mentions.documents,
                    conversations: or3Config.features.mentions.conversations,
                },
                dashboard: {
                    enabled: or3Config.features.dashboard.enabled,
                },
            },
            // Base OR3 config for client/runtime access (avoid importing config.or3 in app runtime)
            or3: {
                site: {
                    name: or3Config.site.name,
                    description: or3Config.site.description,
                    logoUrl: or3Config.site.logoUrl,
                    faviconUrl: or3Config.site.faviconUrl,
                    defaultTheme: or3Config.site.defaultTheme,
                    disabledThemes: or3Config.site.disabledThemes,
                },
                limits: {
                    maxFileSizeBytes: or3Config.limits.maxFileSizeBytes,
                    maxCloudFileSizeBytes:
                        or3Config.limits.maxCloudFileSizeBytes,
                    maxFilesPerMessage: or3Config.limits.maxFilesPerMessage,
                    localStorageQuotaMB:
                        or3Config.limits.localStorageQuotaMB !== null
                            ? String(or3Config.limits.localStorageQuotaMB)
                            : undefined,
                },
                ui: {
                    defaultPaneCount: or3Config.ui.defaultPaneCount,
                    maxPanes: or3Config.ui.maxPanes,
                    sidebarCollapsedByDefault:
                        or3Config.ui.sidebarCollapsedByDefault,
                },
                legal: {
                    termsUrl: or3Config.legal.termsUrl,
                    privacyUrl: or3Config.legal.privacyUrl,
                },
                plugins: {
                    defaultEnabled:
                        or3Config.extensions?.plugins?.defaultEnabled?.filter(
                            Boolean,
                        ) ?? [],
                    modules:
                        or3Config.extensions?.plugins?.modules?.filter(
                            Boolean,
                        ) ?? [],
                },
            },
            // Auto-mapped from NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
            clerkPublishableKey: '',
        },
    },
    experimental: {
        defaults: {
            nuxtLink: {
                // Nuxt type defs currently expect booleans, but runtime accepts the string literal
                // to force interaction-only prefetching.
                prefetchOn: 'interaction' as unknown as {
                    visibility?: boolean;
                    interaction?: boolean;
                },
            },
        },
    },
    devtools: {
        enabled: process.env.NODE_ENV !== 'production',

        timeline: {
            enabled: process.env.NODE_ENV !== 'production',
        },
    },
    modules: [
        './modules/plugin-runtime-catalog',
        '@nuxt/ui',
        '@nuxt/fonts',
        '@vite-pwa/nuxt',
        ...activeProviderModules,
    ],
    // Use the "app" folder as the source directory (where app.vue, pages/, layouts/, etc. live)
    srcDir: 'app',
    // Linked provider packages (or3-provider-*) are file-level symlinks.
    // preserveSymlinks prevents TypeScript from resolving them to their real
    // paths outside the project root, which would break module resolution.
    typescript: {
        tsConfig: {
            compilerOptions: {
                preserveSymlinks: true,
            },
        },
    },
    // Load Tailwind + theme variables globally
    css: ['~/assets/css/main.css'],
    icon: {
        serverBundle: {
            // Only bundle the iconify collections we actually use
            // (pixelarticons = theme tokens, tabler/lucide/carbon = inline
            // prefixes, simple-icons = provider brand logos).
            collections: [
                'pixelarticons',
                'lucide',
                'carbon',
                'tabler',
                'simple-icons',
            ],
        },
    },
    fonts: {
        defaults: {
            // Only emit the latin subset + normal style to keep the global font CSS lightweight
            subsets: ['latin'],
            styles: ['normal'],
            weights: ['400'],
        },
        families: [
            {
                name: 'Press Start 2P',
                provider: 'google',
                styles: ['normal'],
                weights: ['400'],
                subsets: ['latin'],
            },
            {
                name: 'VT323',
                provider: 'google',
                styles: ['normal'],
                weights: ['400'],
                subsets: ['latin'],
            },
            {
                name: 'IBM Plex Sans',
                provider: 'google',
                styles: ['normal'],
                weights: ['400', '500', '600', '700'],
                subsets: ['latin'],
            },
        ],
        experimental: {
            // Skip generating local metric fallback @font-face blocks (saves ~20% of the CSS payload)
            disableLocalFallbacks: true,
        },
    },
    nitro: {
        // Server tsconfig needs preserveSymlinks for file:-linked provider packages.
        typescript: {
            tsConfig: {
                compilerOptions: {
                    preserveSymlinks: true,
                },
            },
        },
        prerender: {
            crawlLinks: false,
            routes: ['/', '/openrouter-callback', '/documentation'],
        },
        routeRules: {
            // Hashed Nuxt chunks - immutable forever
            '/_nuxt/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            // Font files - immutable forever
            '/_fonts/**': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            // Static images with versioning - cache for 1 week
            '/**/*.webp': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.png': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.svg': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.jpg': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            '/**/*.jpeg': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            // Font files (both woff and woff2)
            '/**/*.woff': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
            '/**/*.woff2': {
                headers: {
                    'cache-control':
                        'public,max-age=604800,stale-while-revalidate=86400',
                },
            },
            // CSS files from Nuxt build
            '/**/*.css': {
                headers: {
                    'cache-control': 'public,max-age=31536000,immutable',
                },
            },
        },
    },
    // PWA configuration
    pwa: {
        // Auto update SW when new content is available
        registerType: 'autoUpdate',
        // Enable PWA in dev so you can install/test while developing
        devOptions: {
            enabled: false,
            suppressWarnings: true,
        },
        // Expose $pwa and intercept install prompt
        client: {
            installPrompt: true,
            registerPlugin: true,
            periodicSyncForUpdates: 60 * 60, // Check every 1 hour (reduced from 12 hours for faster updates)
        },
        // Basic offline support; let Workbox handle common assets
        workbox: {
            skipWaiting: true, // activate new SW immediately
            clientsClaim: true, // control pages right away
            cleanupOutdatedCaches: true,
            // The app bundle currently exceeds Workbox's 2 MiB default during
            // production preview/E2E builds. Raise the cap so local preview and
            // Playwright can boot instead of hard-failing the build.
            maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
            // Ensure the prerendered callback HTML can be matched regardless of auth params
            ignoreURLParametersMatching: [/^code$/, /^state$/],
            // Never serve the generic SPA fallback for these routes.
            // /openrouter-callback uses a dedicated runtime rule below with
            // a precache fallback to the prerendered callback HTML.
            navigateFallbackDenylist: [
                /\/openrouter-callback(?:[?/].*)?$/,
                /\/streamsaver(?:\/.*)?$/,
                /\/documentation(?:\/.*)?$/,
            ],
            // Explicitly set null for SSR builds to disable vite-plugin-pwa's default fallback.
            navigateFallback: pwaNavigateFallback,
            manifestTransforms: [
                (entries) => ({
                    manifest: entries.filter((entry) => {
                        // Remove streamsaver app shell from precache
                        if (
                            entry.url === 'streamsaver' ||
                            entry.url === 'streamsaver/index.html'
                        )
                            return false;
                        // Exclude heavy KaTeX assets from precache (loaded lazily when Markdown with math is viewed)
                        // This avoids large install-time caches without affecting runtime loading
                        if (/^_nuxt\/KaTeX_/i.test(entry.url)) return false;
                        if (/^_nuxt\/katex\..*\.css$/i.test(entry.url))
                            return false;
                        // The exact tokenizer is a worker-only, on-demand asset.
                        // Do not force its ~1 MB gzip payload into every PWA
                        // installation; the browser will cache it after use.
                        if (
                            entry.url.endsWith('.js') &&
                            entry.size > 1.5 * 1024 * 1024
                        )
                            return false;
                        return true;
                    }),
                    warnings: [],
                }),
            ],
            globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
            globIgnores: ['streamsaver/**'],
            importScripts: ['/sw-bypass-streamsaver.js'],
            runtimeCaching: [
                // OpenRouter callback: prefer network, but fall back to the
                // prerendered callback page from precache if localhost drops.
                {
                    urlPattern: ({ request, url }) =>
                        request.mode === 'navigate' &&
                        /^\/openrouter-callback\/?$/.test(url.pathname),
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'openrouter-callback-pages',
                        matchOptions: { ignoreSearch: true },
                        networkTimeoutSeconds: 2,
                        ...(pwaOpenRouterCallbackFallback
                            ? {
                                  precacheFallback: {
                                      fallbackURL:
                                          pwaOpenRouterCallbackFallback,
                                  },
                              }
                            : {}),
                    },
                },
                // HTML navigation - always try network first for fresh content
                {
                    urlPattern: ({ request }) => request.mode === 'navigate',
                    handler: 'NetworkFirst',
                    options: {
                        cacheName: 'pages-cache',
                        expiration: {
                            maxEntries: 50,
                            maxAgeSeconds: 24 * 60 * 60, // 1 day
                        },
                        networkTimeoutSeconds: 3, // Fast timeout, then fallback to cache
                    },
                },
                // Nuxt chunks
                {
                    urlPattern: /^\/_nuxt\//,
                    handler: 'NetworkFirst',
                    method: 'GET',
                    options: {
                        cacheName: 'nuxt-dev-chunks',
                        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
                    },
                },
                // Static images
                {
                    urlPattern: /\.(?:png|webp|jpg|jpeg|gif|svg|ico)$/,
                    handler: 'CacheFirst',
                    method: 'GET',
                    options: {
                        cacheName: 'static-images',
                        expiration: {
                            maxEntries: 200,
                            maxAgeSeconds: 7 * 24 * 60 * 60,
                        },
                    },
                },
                // Fonts
                {
                    urlPattern: /^\/_fonts\//,
                    handler: 'CacheFirst',
                    method: 'GET',
                    options: {
                        cacheName: 'nuxt-fonts',
                        expiration: {
                            maxEntries: 50,
                            maxAgeSeconds: 30 * 24 * 60 * 60,
                        },
                    },
                },
                // Icon API
                {
                    urlPattern: /\/api\/_nuxt_icon\/.*$/,
                    handler: 'StaleWhileRevalidate',
                    method: 'GET',
                    options: {
                        cacheName: 'nuxt-icons',
                        expiration: {
                            maxEntries: 200,
                            maxAgeSeconds: 30 * 24 * 60 * 60,
                        },
                    },
                },
            ],
        },
        // Web App Manifest
        manifest: {
            name: appName,
            short_name: appShortName,
            description:
                'The open, extensible AI chat platform for the people.',
            start_url: '/',
            display: 'standalone',
            background_color: '#0b0f1a',
            theme_color: '#0b0f1a',
            icons: [
                {
                    src: '/logos/logo-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                },
                {
                    src: '/logos/logo-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                },
                // WebP is fine in many browsers; PNGs above cover platforms requiring PNG
                {
                    src: '/logos/logo-1024.webp',
                    sizes: '1024x1024',
                    type: 'image/webp',
                    purpose: 'any maskable',
                },
            ],
        },
    },
    imports: {
        dirs: [
            // Scan top-level composables
            '~/composables',
            // Scan all composables within subdirectories
            // Note: Keep non-composable internals out of composables/ to avoid Nuxt auto-import collisions.
            '~/composables/**',
            // Core directory for auth and other utilities (excluding sync which uses barrel exports)
            '~/core',
            '~/core/auth',
            '~/core/auth/**',
            '~/core/hooks',
            '~/core/hooks/**',
            '~/core/theme',
            '~/core/theme/**',
        ],
    },
    vite: {
        customLogger: viteLogger,
        resolve: {
            alias: [
                {
                    find: /^or3-scroll$/,
                    replacement: resolve(
                        __dirname,
                        '../or3-vsc/src/lib/index.ts',
                    ),
                },
                {
                    find: /^or3-workflow-vue$/,
                    replacement: resolve(
                        __dirname,
                        '../or3-workflows/packages/workflow-vue/src/index.ts',
                    ),
                },
                {
                    find: /^or3-workflow-core$/,
                    replacement: resolve(
                        __dirname,
                        '../or3-workflows/packages/workflow-core/src/index.ts',
                    ),
                },
            ],
        },
        optimizeDeps: {
            exclude: [
                'or3-scroll',
                'or3-workflow-core',
                'or3-workflow-vue',
            ],
        },
        server: {
            fs: {
                allow: [resolve(__dirname, '..')],
            },
            watch: {
                ignored: isWizardUiProcess
                    ? [
                          '**/.env',
                          '**/.env.local',
                          '**/or3.providers.generated.ts',
                      ]
                    : [],
            },
        },
        plugins: [
            themeCompilerPlugin({
                failOnError: true,
                showWarnings: true,
            }),
        ],
        worker: {
            format: 'es',
        },
        build: {
            rolldownOptions: {
                output: {
                    codeSplitting: {
                        groups: [
                            {
                                name: 'gpt-tokenizer',
                                test: /[\\/]node_modules[\\/]gpt-tokenizer[\\/]/,
                            },
                        ],
                    },
                },
            },
        },
    },
    // Exclude test artifacts & example plugins from scanning and server bundle (saves build time & size)
    ignore: [
        '**/*.test.*',
        '**/__tests__/**',
        'tests/**',
        // Example plugins and test pages (dev only); keep them out of production build
        ...(process.env.NODE_ENV === 'production'
            ? [
                  'app/plugins/examples/**',
                  'app/pages/_tests/**',
                  'app/pages/tests/**',
                  'app/pages/_test.vue',
              ]
            : []),
        // Note: Admin pages are no longer excluded based on ssrAuthEnabled.
        // The new super admin feature uses JWT-based authentication and is gated
        // at runtime via isAdminEnabled() check in server/middleware/admin-gate.ts.
    ].filter(Boolean) as string[],
    hooks: {
        'pages:extend'(pages) {
            if (isScrollTestHarnessEnabled) {
                pages.push({
                    name: 'or3-scroll-test-harness',
                    path: '/__or3-scroll-test',
                    file: resolve(
                        __dirname,
                        'tests/e2e/fixtures/Or3ScrollCanary.vue'
                    ),
                });
            }
            if (isProductionJourneyTestHarnessEnabled) {
                pages.push(
                    {
                        name: 'or3-chat-journey-test-harness',
                        path: '/__or3-chat-journey-test',
                        file: resolve(
                            __dirname,
                            'tests/e2e/fixtures/ProductionChatJourney.vue'
                        ),
                    },
                    {
                        name: 'or3-document-journey-test-harness',
                        path: '/__or3-document-journey-test',
                        file: resolve(
                            __dirname,
                            'tests/e2e/fixtures/ProductionDocumentJourney.vue'
                        ),
                    }
                );
            }
        },
        listen(_server, listener) {
            if (isWizardUiProcess) return;
            const url =
                listener &&
                typeof (listener as { url?: unknown }).url === 'string'
                    ? (listener as { url: string }).url
                    : undefined;
            // Defer so this prints after Nuxt's own URL output.
            setTimeout(() => {
                printOr3StartupBanner({
                    appUrl: url,
                    ssrAuthEnabled: effectiveSsrAuthEnabled,
                    degradedCloud:
                        isSsrAuthEnabled &&
                        !effectiveSsrAuthEnabled &&
                        !isStaticGenerateBuild,
                    authProvider: or3CloudConfig.auth.provider,
                    syncEnabled: effectiveSyncEnabled,
                    syncProvider: or3CloudConfig.sync.provider,
                    storageEnabled: effectiveStorageEnabled,
                    storageProvider: or3CloudConfig.storage.provider,
                });
            }, 1200);
        },
    },
});
