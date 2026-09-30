import type { ResolvedOr3Config } from '../../types/or3-config';
import type { Or3CloudConfig } from '../../types/or3-cloud-config';
import type { EnvMap } from '../cloud/env-contract';
import { resolveStrictMode } from '../cloud/env-contract';
import {
    requiredProviderModules,
    providerIdToModuleId,
} from '../cloud/provider-compatibility';
import { resolveConnectCloudflareReadiness } from '../cloud/wizard/cloudflare-attestation';
import { isNonCorePluginDiscoveryDisabled } from '../plugins/safe-mode';
import { DEFAULT_WEBHOOKS_BLOCK_PRIVATE_IPS } from './constants';
import { modulePackageName, type ModuleResolution } from './module-resolution';

/** Pure policy and runtime projection. Filesystem discovery belongs to the caller. */
export function buildApplicationPlan(input: {
    or3Config: ResolvedOr3Config;
    or3CloudConfig: Or3CloudConfig;
    env: Readonly<EnvMap>;
    modules: ReadonlyMap<string, ModuleResolution>;
    isStaticGenerateBuild: boolean;
    now: number;
}) {
    const { or3Config, or3CloudConfig, env } = input;
    if (input.isStaticGenerateBuild && or3CloudConfig.auth.enabled) {
        return {
            ok: false as const,
            errors: [
                'Static generation cannot enable server auth. Use bun run generate:static or a server build.',
            ],
        };
    }
    const requirements = requiredProviderModules(or3CloudConfig, env);
    const errors: string[] = [];
    for (const { moduleId, setting } of requirements) {
        const result = input.modules.get(moduleId);
        if (!result?.ok)
            errors.push(
                `${setting} requires "${moduleId}". ${result && !result.ok ? result.message : 'The module entry is unavailable.'} Install/build the selected provider and rebuild; use bun run dev:offline for intentional local-only development.`,
            );
    }
    if (errors.length) return { ok: false as const, errors };
    const warnings: string[] = [];
    const modules: string[] = [];
    for (const [id, result] of input.modules) {
        if (result.ok) modules.push(result.entry);
        else
            warnings.push(
                `[or3-module] Ignoring optional module "${id}": ${result.message}`,
            );
    }
    const effectiveSsrAuthEnabled =
        or3CloudConfig.auth.enabled && env.OR3_WIZARD_UI_ENABLED !== 'true';
    const effectiveSyncEnabled =
        effectiveSsrAuthEnabled && or3CloudConfig.sync.enabled;
    const effectiveStorageEnabled =
        effectiveSsrAuthEnabled && or3CloudConfig.storage.enabled;
    const effectiveBackgroundEnabled =
        effectiveSsrAuthEnabled &&
        (or3CloudConfig.backgroundStreaming?.enabled ?? false);
    const requestedConnectEnabled =
        effectiveSsrAuthEnabled && env.OR3_CONNECT_ENABLED === 'true';
    const connectProvider =
        env.OR3_CONNECT_PROVIDER?.trim() || or3CloudConfig.sync.provider;
    const connectRelayProvider =
        env.OR3_CONNECT_RELAY_PROVIDER?.trim() || 'cloudflare';
    const strictConnectConfig = resolveStrictMode({ env });
    const connectReadiness = resolveConnectCloudflareReadiness({
        requestedEnabled: requestedConnectEnabled,
        strict: strictConnectConfig,
        relayProvider: connectRelayProvider,
        attestation: env.OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION,
        config: {
            accountId: env.OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID || '',
            zoneId: env.OR3_CONNECT_CLOUDFLARE_ZONE_ID || '',
            apiToken: env.OR3_CONNECT_CLOUDFLARE_API_TOKEN || '',
            hostnameSuffix: env.OR3_CONNECT_HOSTNAME_SUFFIX || '',
        },
        now: input.now,
    });
    const effectiveConnectEnabled = connectReadiness.enabled;
    if (connectReadiness.message)
        warnings.push(`[or3-connect] ${connectReadiness.message}`);
    const resolvedRegistrationMode =
        or3CloudConfig.auth.registrationMode ??
        ((or3CloudConfig.auth.autoProvision ?? true) ? 'open' : 'disabled');
    const disableNonCorePlugins = isNonCorePluginDiscoveryDisabled(
        or3CloudConfig.admin,
    );
    const convexUrl = or3CloudConfig.sync.convex?.url || '';
    const convexAdminKey = or3CloudConfig.sync.convex?.adminKey || '';
    const appName = or3Config.site.name;
    const isProductionJourneyTestHarnessEnabled =
        env.OR3_PRODUCTION_JOURNEY_TEST_HARNESS === 'true';
    const productionJourneyPort = Number(env.PW_PORT || 3000);
    const productionJourneyOpenRouterBaseUrl = `http://127.0.0.1:${Number.isInteger(productionJourneyPort) ? productionJourneyPort : 3000}/api/__or3-e2e`;
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
        pluginModuleLoaderV2WorkspaceIds:
            or3CloudConfig.admin?.pluginModuleLoaderV2WorkspaceIds ?? [],
        pluginIsolationEnabled:
            or3CloudConfig.admin?.pluginIsolationEnabled === true,
        pluginZipInstallEnabled:
            or3CloudConfig.admin?.pluginZipInstallEnabled !== false,
        pluginRouteDispatcherEnabled:
            or3CloudConfig.admin?.pluginRouteDispatcherEnabled !== false,
        /**
         * Serves the host-owned containment probe assets used by real-browser
         * qualification (task 4.13). Off by default and never required at runtime.
         */
        containmentProbeEnabled: env.OR3_CONTAINMENT_PROBE_ENABLED === 'true',
        /**
         * Approved models a plugin may use, and their trusted prices (USD per 1M
         * tokens). Both are operator configuration; an unpriced model is refused
         * rather than recorded as free, and an empty allowlist means plugins have no
         * approved models at all. Parsed strictly at the boundary
         * (`shared/plugins/ai/model-catalog.ts`).
         */
        pluginAllowedModels: (env.OR3_PLUGIN_ALLOWED_MODELS ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        pluginModelPrices: (() => {
            const raw = (env.OR3_PLUGIN_MODEL_PRICES ?? '').trim();
            if (!raw) return {};
            try {
                const parsed: unknown = JSON.parse(raw);
                return parsed &&
                    typeof parsed === 'object' &&
                    !Array.isArray(parsed)
                    ? parsed
                    : {};
            } catch {
                return {};
            }
        })(),
        /**
         * AES-256-GCM key for plugin connection secrets. Held outside the database
         * (env/secret store); empty means connections are unavailable, never stored
         * in plaintext.
         *
         * Deliberately never read from the build environment: a prebuilt image must
         * take it from the runtime override `NUXT_ADMIN_PLUGIN_CONNECTION_SECRET`
         * (translated from `OR3_PLUGIN_CONNECTION_SECRET` by the container entrypoint)
         * so the key is not baked into an image layer.
         */
        pluginConnectionSecret: '',
        /**
         * AES-256-GCM key for the personal Library link credential
         * (`OR3_LIBRARY_LINK_SECRET`). Held outside the database and never read from
         * the build environment; empty means linking is unavailable rather than
         * storing a polling secret or token in plaintext.
         */
        libraryLinkSecret: '',
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
        extensionAllowedExtensions: or3CloudConfig.admin
            ?.extensionAllowedExtensions
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
                          or3CloudConfig.admin?.auth
                              ?.deletedWorkspaceRetentionDays,
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
        enabled:
            effectiveSsrAuthEnabled &&
            (or3CloudConfig.webhooks?.enabled ?? false),
        maxPerUser: or3CloudConfig.webhooks?.maxPerUser ?? 20,
        adminMax: or3CloudConfig.webhooks?.adminMax ?? 50,
        rateLimitPerMinute: or3CloudConfig.webhooks?.rateLimitPerMinute ?? 120,
        deliveryTimeoutMs: or3CloudConfig.webhooks?.deliveryTimeoutMs ?? 10_000,
        blockPrivateIps:
            or3CloudConfig.webhooks?.blockPrivateIps ??
            DEFAULT_WEBHOOKS_BLOCK_PRIVATE_IPS,
        encryptionKey: or3CloudConfig.webhooks?.encryptionKey ?? '',
        maxRetryHours: or3CloudConfig.webhooks?.maxRetryHours ?? 1,
        logRetentionHours: or3CloudConfig.webhooks?.logRetentionHours ?? 72,
    };

    const runtimeConfig = {
        // Server-only env variables (auto-mapped from NUXT_*)
        openrouterApiKey:
            or3CloudConfig.services.llm?.openRouter?.instanceApiKey || '',
        openrouterBaseUrl: isProductionJourneyTestHarnessEnabled
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
                tokenSecret: env.OR3_AUTH_INVITE_TOKEN_SECRET,
                tokenTtlSeconds: env.OR3_AUTH_INVITE_TOKEN_TTL_SECONDS
                    ? Number(env.OR3_AUTH_INVITE_TOKEN_TTL_SECONDS)
                    : 7 * 24 * 60 * 60,
            },
            bootstrapEmail: env.OR3_BASIC_AUTH_BOOTSTRAP_EMAIL || '',
        },
        sync: {
            enabled: effectiveSyncEnabled,
            provider: or3CloudConfig.sync.provider,
            convexUrl,
            convexAdminKey,
        },
        connect: {
            enabled: effectiveConnectEnabled,
            requestedEnabled: requestedConnectEnabled,
            readinessStatus: connectReadiness.status,
            readinessMessage: connectReadiness.message || '',
            cloudflareValidationAttestation:
                env.OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION || '',
            provider: connectProvider,
            relayProvider: connectRelayProvider,
            publicURL: env.OR3_CONNECT_PUBLIC_URL || '',
            encryptionKey: env.OR3_CONNECT_ENCRYPTION_KEY || '',
            maxComputers: env.OR3_CONNECT_MAX_COMPUTERS ?? '3',
            cloudflare: {
                accountId: env.OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID || '',
                zoneId: env.OR3_CONNECT_CLOUDFLARE_ZONE_ID || '',
                apiToken: env.OR3_CONNECT_CLOUDFLARE_API_TOKEN || '',
                hostnameSuffix: env.OR3_CONNECT_HOSTNAME_SUFFIX || '',
            },
        },
        storage: {
            enabled: effectiveStorageEnabled,
            provider: or3CloudConfig.storage.provider,
            allowedMimeTypes:
                or3CloudConfig.storage.allowedMimeTypes ?? undefined,
            allowAnyFileType: or3CloudConfig.storage.allowAnyFileType ?? false,
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
            enabled: env.OR3_WIZARD_UI_ENABLED === 'true',
            token: env.OR3_WIZARD_UI_TOKEN ?? '',
        },
        // Background streaming configuration (SSR mode only)
        backgroundJobs: {
            enabled: effectiveBackgroundEnabled,
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
            // Terminal jobs are the durable buffer the browser uses to persist
            // completed output after navigation/disconnect. Keep them
            // retrievable for a full day instead of minutes so returning
            // clients and reattachment can still recover the result.
            completedJobRetentionMs: 24 * 60 * 60 * 1000,
            encryptionKey:
                or3CloudConfig.backgroundStreaming?.encryptionKey ?? '',
        },
        public: {
            appVersion: env.npm_package_version || '0.1.0',
            pluginDevelopment:
                env.NODE_ENV !== 'production' &&
                Boolean(env.OR3_PLUGIN_WATCH_ROOT),
            /**
             * Mirrors the server-side probe flag so the qualification harness can
             * exercise the real startup API from a page. Off in every other profile.
             */
            containmentProbeEnabled:
                env.OR3_CONTAINMENT_PROBE_ENABLED === 'true',
            // Declaring these keys makes NUXT_PUBLIC_OPENROUTER_* available to
            // the client instead of silently falling back to the current URL.
            openRouterRedirectUri:
                env.NUXT_PUBLIC_OPENROUTER_REDIRECT_URI || '',
            openRouterClientId: env.NUXT_PUBLIC_OPENROUTER_CLIENT_ID || '',
            openRouterAuthUrl: env.NUXT_PUBLIC_OPENROUTER_AUTH_URL || '',
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
                baseUrl: isProductionJourneyTestHarnessEnabled
                    ? productionJourneyOpenRouterBaseUrl
                    : or3CloudConfig.services.llm?.openRouter?.baseUrl ||
                      'https://openrouter.ai/api/v1',
            },
            storage: {
                enabled: effectiveStorageEnabled,
                provider: or3CloudConfig.storage.provider,
                allowAnyFileType:
                    or3CloudConfig.storage.allowAnyFileType ?? false,
            },
            sync: {
                enabled: effectiveSyncEnabled,
                provider: or3CloudConfig.sync.provider,
                convexUrl,
            },
            connect: {
                enabled: effectiveConnectEnabled,
                status: connectReadiness.status,
                statusMessage: connectReadiness.message || '',
                provider: connectProvider,
                relayProvider: connectRelayProvider,
                publicUrl: env.OR3_CONNECT_PUBLIC_URL || '',
            },
            limits: publicLimitsConfig,
            branding: brandingConfig,
            legal: legalConfig,
            backgroundStreaming: {
                enabled: effectiveBackgroundEnabled,
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
                pluginModuleLoaderV2WorkspaceIds:
                    adminConfig.pluginModuleLoaderV2WorkspaceIds,
                pluginIsolationEnabled: adminConfig.pluginIsolationEnabled,
                pluginRouteDispatcherEnabled:
                    adminConfig.pluginRouteDispatcherEnabled,
                pluginZipInstallEnabled: adminConfig.pluginZipInstallEnabled,
                allowRestart: adminConfig.allowRestart,
                allowRebuild: adminConfig.allowRebuild,
            },
            webhooks: {
                enabled: webhooksConfig.enabled,
            },
            wizardUi: {
                enabled: env.OR3_WIZARD_UI_ENABLED === 'true',
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
                workspaceTabs: {
                    enabled: or3Config.features.workspaceTabs.enabled,
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
                            (id) => modulePackageName(id) !== null,
                        ) ?? [],
                },
            },
            // Auto-mapped from NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
            clerkPublishableKey: '',
        },
    };

    const feature = (enabled: boolean, provider: string) =>
        enabled
            ? {
                  enabled: true as const,
                  provider,
                  moduleId: providerIdToModuleId(provider) ?? undefined,
              }
            : {
                  enabled: false as const,
                  reason: effectiveSsrAuthEnabled
                      ? 'Disabled in configuration or provider readiness policy.'
                      : 'Server authentication is disabled.',
              };
    return {
        ok: true as const,
        warnings,
        plan: {
            modules: [...new Set(modules)],
            features: {
                auth: feature(
                    effectiveSsrAuthEnabled,
                    or3CloudConfig.auth.provider,
                ),
                workspaceStore: feature(
                    effectiveSsrAuthEnabled,
                    or3CloudConfig.sync.provider,
                ),
                sync: feature(
                    effectiveSyncEnabled,
                    or3CloudConfig.sync.provider,
                ),
                storage: feature(
                    effectiveStorageEnabled,
                    or3CloudConfig.storage.provider,
                ),
                connect: feature(effectiveConnectEnabled, connectProvider),
                background: feature(
                    effectiveBackgroundEnabled,
                    or3CloudConfig.backgroundStreaming?.storageProvider ||
                        'memory',
                ),
            },
            runtimeConfig,
        },
    };
}
