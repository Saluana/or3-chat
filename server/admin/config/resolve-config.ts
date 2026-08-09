/**
 * @module server/admin/config/resolve-config.ts
 *
 * Purpose:
 * Transforms raw, flat environment variable strings into structured, type-safe
 * configuration objects used throughout the OR3 application.
 *
 * Responsibilities:
 * - Parsing string values into booleans, numbers, and complex nested objects.
 * - Applying system-wide defaults for missing values.
 * - Enforcing strict configuration validation for production environments.
 *
 * Architecture:
 * This module bridges the gap between the process environment and the typed
 * configuration system (Or3Config and Or3CloudConfig). It is used during system
 * initialization and by the admin manager to validate pending changes.
 *
 * Constraints:
 * - Must handle undefined environment variables gracefully by providing defaults.
 * - Validates configuration against schemas provided by `defineOr3Config`.
 */
import { defineOr3Config } from '../../../utils/or3-config';
import { defineOr3CloudConfig } from '../../../utils/or3-cloud-config';
import type { Or3CloudConfig } from '../../../types/or3-cloud-config';
import {
    AUTH_PROVIDER_IDS,
    DEFAULT_BACKGROUND_PROVIDER_ID,
    DEFAULT_STORAGE_PROVIDER_ID,
    DEFAULT_SYNC_PROVIDER_ID,
    LIMITS_PROVIDER_IDS,
    type AuthProviderId,
    type BackgroundProviderId,
    type LimitsProviderId,
    type StorageProviderId,
    type SyncProviderId,
} from '../../../shared/cloud/provider-ids';
import {
    DEFAULT_SITE_NAME,
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_MAX_CONVERSATIONS,
    DEFAULT_MAX_MESSAGES_PER_DAY,
    DEFAULT_ADMIN_BASE_PATH,
    DEFAULT_REBUILD_COMMAND,
    DEFAULT_BACKGROUND_MAX_JOBS,
    DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
    DEFAULT_BACKGROUND_MAX_JOBS_PER_USER,
    DEFAULT_OPENROUTER_BASE_URL,
    DEFAULT_WEBHOOKS_MAX_PER_USER,
    DEFAULT_WEBHOOKS_ADMIN_MAX,
    DEFAULT_WEBHOOKS_RATE_LIMIT_PER_MINUTE,
    DEFAULT_WEBHOOKS_DELIVERY_TIMEOUT_MS,
    DEFAULT_WEBHOOKS_MAX_RETRY_HOURS,
    DEFAULT_WEBHOOKS_LOG_RETENTION_HOURS,
} from '../../../shared/config/constants';
import {
    readEnvAlias,
    readEnvBoolean,
    readEnvFeature,
    resolveStrictMode,
} from '../../../shared/cloud/env-contract';

export type { EnvMap } from '../../../shared/cloud/env-contract';
import type { EnvMap } from '../../../shared/cloud/env-contract';
export type BuildOr3CloudConfigFromEnvOptions = {
    strict?: boolean;
};

export function validateEnvConfig(
    env: EnvMap,
    options: BuildOr3CloudConfigFromEnvOptions = {},
) {
    return {
        or3Config: buildOr3ConfigFromEnv(env),
        cloudConfig: buildOr3CloudConfigFromEnv(env, options),
    };
}

/**
 * Safely converts an environment variable string to a number.
 *
 * Behavior:
 * Uses the global `Number()` constructor. If the result is not a finite number,
 * it returns the provided `fallback`.
 */
function envNum(
    val: string | undefined,
    fallback?: number,
): number | undefined {
    if (val === undefined) return fallback;
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSessionProvisioningFailureMode(
    value: string | undefined,
): 'throw' | 'unauthenticated' | 'service-unavailable' | undefined {
    if (
        value === 'throw' ||
        value === 'unauthenticated' ||
        value === 'service-unavailable'
    ) {
        return value;
    }
    return undefined;
}

function parseAuthRegistrationMode(
    value: string | undefined,
): 'open' | 'invite_only' | 'disabled' | undefined {
    if (value === 'open' || value === 'invite_only' || value === 'disabled') {
        return value;
    }
    return undefined;
}

function parseRateLimitOverrides(
    input: string | undefined,
): Record<string, { windowMs?: number; maxRequests?: number }> | undefined {
    if (!input) return undefined;
    try {
        const parsed = JSON.parse(input) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }

        const overrides: Record<
            string,
            { windowMs?: number; maxRequests?: number }
        > = {};
        for (const [operation, value] of Object.entries(parsed)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                continue;
            }
            const raw = value as { windowMs?: unknown; maxRequests?: unknown };
            const windowMs =
                typeof raw.windowMs === 'number' &&
                Number.isFinite(raw.windowMs) &&
                raw.windowMs > 0
                    ? Math.floor(raw.windowMs)
                    : undefined;
            const maxRequests =
                typeof raw.maxRequests === 'number' &&
                Number.isFinite(raw.maxRequests) &&
                raw.maxRequests > 0
                    ? Math.floor(raw.maxRequests)
                    : undefined;
            if (windowMs !== undefined || maxRequests !== undefined) {
                overrides[operation] = { windowMs, maxRequests };
            }
        }
        return Object.keys(overrides).length > 0 ? overrides : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Builds the standard OR3 configuration object from environment variables.
 *
 * Purpose:
 * Generates the application-level configuration for features like site branding,
 * workflow toggles, and UI limits.
 *
 * @param env - A map of environment variable keys and values
 */
export function buildOr3ConfigFromEnv(env: EnvMap) {
    return defineOr3Config({
        site: {
            name: env.OR3_SITE_NAME ?? DEFAULT_SITE_NAME,
            description: env.OR3_SITE_DESCRIPTION || undefined,
            logoUrl: env.OR3_LOGO_URL || undefined,
            faviconUrl: env.OR3_FAVICON_URL || undefined,
            defaultTheme: env.OR3_DEFAULT_THEME || undefined,
        },
        features: {
            workflows: {
                enabled: readEnvFeature(env.OR3_WORKFLOWS_ENABLED),
                editor: readEnvFeature(env.OR3_WORKFLOWS_EDITOR),
                slashCommands: readEnvFeature(env.OR3_WORKFLOWS_SLASH_COMMANDS),
                execution: readEnvFeature(env.OR3_WORKFLOWS_EXECUTION),
            },
            documents: {
                enabled: readEnvFeature(env.OR3_DOCUMENTS_ENABLED),
            },
            backup: {
                enabled: readEnvFeature(env.OR3_BACKUP_ENABLED),
            },
            mentions: {
                enabled: readEnvFeature(env.OR3_MENTIONS_ENABLED),
                documents: readEnvFeature(env.OR3_MENTIONS_DOCUMENTS),
                conversations: readEnvFeature(env.OR3_MENTIONS_CONVERSATIONS),
            },
            dashboard: {
                enabled: readEnvFeature(env.OR3_DASHBOARD_ENABLED),
            },
        },
        limits: {
            maxFileSizeBytes: envNum(env.OR3_MAX_FILE_SIZE_BYTES),
            maxCloudFileSizeBytes: envNum(env.OR3_MAX_CLOUD_FILE_SIZE_BYTES),
            maxFilesPerMessage: envNum(env.OR3_MAX_FILES_PER_MESSAGE),
            localStorageQuotaMB: envNum(env.OR3_LOCAL_STORAGE_QUOTA_MB),
        },
        ui: {
            defaultPaneCount: envNum(env.OR3_DEFAULT_PANE_COUNT),
            maxPanes: envNum(env.OR3_MAX_PANES),
            sidebarCollapsedByDefault: env.OR3_SIDEBAR_COLLAPSED
                ? env.OR3_SIDEBAR_COLLAPSED === 'true'
                : undefined,
        },
        legal: {
            termsUrl: env.OR3_TERMS_URL || undefined,
            privacyUrl: env.OR3_PRIVACY_URL || undefined,
        },
    });
}

/**
 * Builds the OR3 Cloud configuration object from environment variables.
 *
 * Purpose:
 * Generates the infrastructure-level configuration for Auth, Sync, Storage,
 * and security headers.
 *
 * Constraints:
 * - Automatically enables/disables Sync and Storage based on the state of
 *   `SSR_AUTH_ENABLED`.
 * - Enforces HTTPS in production environments by default.
 *
 * @param env - A map of environment variable keys and values
 */
export function buildOr3CloudConfigFromEnv(
    env: EnvMap,
    options: BuildOr3CloudConfigFromEnvOptions = {},
) {
    const authEnabled = env.SSR_AUTH_ENABLED === 'true';
    const syncEnabledFlag = readEnvAlias(env, 'syncEnabled');
    const storageEnabledFlag = readEnvAlias(env, 'storageEnabled');
    const syncEnabled = authEnabled && syncEnabledFlag !== 'false';
    const storageEnabled = authEnabled && storageEnabledFlag !== 'false';
    const authProvider =
        readEnvAlias(env, 'authProvider') ??
        AUTH_PROVIDER_IDS.clerk;
    const syncProvider = env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID;
    const storageProvider =
        env.NUXT_PUBLIC_STORAGE_PROVIDER ?? DEFAULT_STORAGE_PROVIDER_ID;
    const strict = resolveStrictMode({
        env,
        explicit: options.strict,
        nodeEnv: env.NODE_ENV ?? process.env.NODE_ENV,
        strictEnv: env.OR3_STRICT_CONFIG ?? process.env.OR3_STRICT_CONFIG,
    });
    if (
        env.OR3_BACKGROUND_STREAMING_ENABLED === 'true' &&
        (env.OR3_BACKGROUND_ENCRYPTION_KEY?.trim().length ?? 0) < 32
    ) {
        throw new Error(
            'OR3_BACKGROUND_ENCRYPTION_KEY must contain at least 32 characters when background streaming is enabled',
        );
    }

    const config: Or3CloudConfig = {
        auth: {
            enabled: authEnabled,
            provider: authProvider as AuthProviderId,
            guestAccessEnabled: env.OR3_GUEST_ACCESS_ENABLED === 'true',
            autoProvision: env.OR3_AUTH_AUTO_PROVISION !== 'false',
            registrationMode: parseAuthRegistrationMode(
                env.OR3_AUTH_REGISTRATION_MODE,
            ),
            sessionProvisioningFailure: parseSessionProvisioningFailureMode(
                env.OR3_SESSION_PROVISIONING_FAILURE,
            ),
            lockPage: {
                enabled: readEnvBoolean(env.OR3_AUTH_LOCK_PAGE_ENABLED, false),
                adapter: env.OR3_AUTH_LOCK_PAGE_ADAPTER || undefined,
            },
            clerk: {
                publishableKey:
                    env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined,
                secretKey: env.NUXT_CLERK_SECRET_KEY || undefined,
            },
        },
        sync: {
            enabled: syncEnabled,
            provider: syncProvider as SyncProviderId,
            convex: {
                url: env.VITE_CONVEX_URL || undefined,
                adminKey: env.CONVEX_SELF_HOSTED_ADMIN_KEY || undefined,
            },
        },
        storage: {
            enabled: storageEnabled,
            provider: storageProvider as StorageProviderId,
            allowedMimeTypes: env.OR3_STORAGE_ALLOWED_MIME_TYPES
                ? env.OR3_STORAGE_ALLOWED_MIME_TYPES.split(',')
                      .map((mime) => mime.trim())
                      .filter(Boolean)
                : undefined,
            workspaceQuotaBytes: envNum(env.OR3_STORAGE_WORKSPACE_QUOTA_BYTES),
            gcRetentionSeconds: envNum(env.OR3_STORAGE_GC_RETENTION_SECONDS),
            gcCooldownMs: envNum(env.OR3_STORAGE_GC_COOLDOWN_MS),
        },
        services: {
            llm: {
                openRouter: {
                    instanceApiKey: env.OPENROUTER_API_KEY || undefined,
                    allowUserOverride:
                        env.OR3_OPENROUTER_ALLOW_USER_OVERRIDE !== 'false',
                    requireUserKey:
                        env.OR3_OPENROUTER_REQUIRE_USER_KEY === 'true',
                    baseUrl:
                        env.OR3_OPENROUTER_BASE_URL ||
                        DEFAULT_OPENROUTER_BASE_URL,
                },
            },
        },
        limits: {
            enabled: env.OR3_LIMITS_ENABLED !== 'false',
            requestsPerMinute:
                envNum(
                    env.OR3_REQUESTS_PER_MINUTE,
                    DEFAULT_REQUESTS_PER_MINUTE,
                ) ?? DEFAULT_REQUESTS_PER_MINUTE,
            maxConversations:
                envNum(env.OR3_MAX_CONVERSATIONS, DEFAULT_MAX_CONVERSATIONS) ??
                DEFAULT_MAX_CONVERSATIONS,
            maxMessagesPerDay:
                envNum(
                    env.OR3_MAX_MESSAGES_PER_DAY,
                    DEFAULT_MAX_MESSAGES_PER_DAY,
                ) ?? DEFAULT_MAX_MESSAGES_PER_DAY,
            storageProvider: (env.OR3_LIMITS_STORAGE_PROVIDER ??
                (syncEnabled
                    ? syncProvider
                    : LIMITS_PROVIDER_IDS.memory)) as LimitsProviderId,
            operationRateLimits: parseRateLimitOverrides(
                env.OR3_RATE_LIMIT_OVERRIDES_JSON,
            ),
        },
        security: {
            allowedOrigins: env.OR3_ALLOWED_ORIGINS
                ? env.OR3_ALLOWED_ORIGINS.split(',')
                      .map((origin) => origin.trim())
                      .filter(Boolean)
                : [],
            forceHttps: readEnvBoolean(
                env.OR3_FORCE_HTTPS,
                env.NODE_ENV === 'production',
            ),
            proxy: {
                trustProxy: env.OR3_TRUST_PROXY === 'true',
                forwardedForHeader:
                    env.OR3_FORWARDED_FOR_HEADER === 'x-real-ip'
                        ? 'x-real-ip'
                        : 'x-forwarded-for',
                forwardedHostHeader: 'x-forwarded-host',
            },
        },
        admin: {
            basePath: env.OR3_ADMIN_BASE_PATH || DEFAULT_ADMIN_BASE_PATH,
            allowedHosts: env.OR3_ADMIN_ALLOWED_HOSTS
                ? env.OR3_ADMIN_ALLOWED_HOSTS.split(',')
                      .map((host) => host.trim())
                      .filter(Boolean)
                : [],
            allowRestart: env.OR3_ADMIN_ALLOW_RESTART === 'true',
            allowRebuild: env.OR3_ADMIN_ALLOW_REBUILD === 'true',
            disableNonCorePlugins: readEnvBoolean(
                env.OR3_DISABLE_NON_CORE_PLUGINS,
                false,
            ),
            pluginZipInstallEnabled: readEnvBoolean(
                env.OR3_PLUGIN_ZIP_INSTALL_ENABLED,
                true,
            ),
            pluginRuntimeShadowEnabled: readEnvBoolean(
                env.OR3_PLUGIN_RUNTIME_SHADOW_ENABLED,
                true,
            ),
            pluginRuntimeV2Enabled: readEnvBoolean(
                env.OR3_PLUGIN_RUNTIME_V2_ENABLED,
                true,
            ),
            pluginRuntimeV2WorkspaceIds: env.OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS
                ? env.OR3_PLUGIN_RUNTIME_V2_WORKSPACE_IDS.split(',')
                      .map((workspaceId) => workspaceId.trim())
                      .filter(Boolean)
                : [],
            pluginContributionV2Surfaces:
                env.OR3_PLUGIN_CONTRIBUTION_V2_SURFACES
                    ? env.OR3_PLUGIN_CONTRIBUTION_V2_SURFACES.split(',')
                          .map((surface) => surface.trim())
                          .filter(Boolean)
                    : [],
            hookEngineV2Enabled: readEnvBoolean(env.OR3_HOOK_ENGINE_V2_ENABLED, false),
            pluginModuleLoaderV2Enabled: readEnvBoolean(
                env.OR3_PLUGIN_MODULE_LOADER_V2_ENABLED,
                false,
            ),
            pluginModuleLoaderV2WorkspaceIds:
                env.OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS
                    ? env.OR3_PLUGIN_MODULE_LOADER_V2_WORKSPACE_IDS.split(',')
                          .map((workspaceId) => workspaceId.trim())
                          .filter(Boolean)
                    : [],
            pluginIsolationEnabled: readEnvBoolean(
                env.OR3_PLUGIN_ISOLATION_ENABLED,
                false,
            ),
            rebuildCommand:
                env.OR3_ADMIN_REBUILD_COMMAND || DEFAULT_REBUILD_COMMAND,
            extensionMaxZipBytes: envNum(env.OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES),
            extensionMaxFiles: envNum(env.OR3_ADMIN_EXTENSION_MAX_FILES),
            extensionMaxTotalBytes: envNum(
                env.OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES,
            ),
            extensionAllowedExtensions:
                env.OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS
                    ? env.OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS.split(',')
                          .map((ext) => ext.trim())
                          .filter(Boolean)
                    : undefined,
            auth: {
                username: env.OR3_ADMIN_USERNAME || undefined,
                password: env.OR3_ADMIN_PASSWORD || undefined,
                jwtSecret: env.OR3_ADMIN_JWT_SECRET || undefined,
                jwtExpiry: env.OR3_ADMIN_JWT_EXPIRY || undefined,
                deletedWorkspaceRetentionDays: envNum(
                    env.OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS,
                ),
            },
        },
        backgroundStreaming: {
            enabled: env.OR3_BACKGROUND_STREAMING_ENABLED === 'true',
            storageProvider: (env.OR3_BACKGROUND_STREAMING_PROVIDER ??
                (syncEnabled
                    ? syncProvider
                    : DEFAULT_BACKGROUND_PROVIDER_ID)) as BackgroundProviderId,
            maxConcurrentJobs:
                envNum(
                    env.OR3_BACKGROUND_MAX_JOBS,
                    DEFAULT_BACKGROUND_MAX_JOBS,
                ) ?? DEFAULT_BACKGROUND_MAX_JOBS,
            maxConcurrentJobsPerUser:
                envNum(
                    env.OR3_BACKGROUND_MAX_JOBS_PER_USER,
                    DEFAULT_BACKGROUND_MAX_JOBS_PER_USER,
                ) ?? DEFAULT_BACKGROUND_MAX_JOBS_PER_USER,
            jobTimeoutSeconds:
                envNum(
                    env.OR3_BACKGROUND_JOB_TIMEOUT,
                    DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
                ) ?? DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
            // Dedicated runtime-only key for durable job credentials. Never
            // derive this from an auth/build secret embedded in an image.
            encryptionKey: env.OR3_BACKGROUND_ENCRYPTION_KEY || undefined,
        },
        webhooks: {
            enabled: authEnabled && env.OR3_WEBHOOKS_ENABLED !== 'false',
            maxPerUser:
                envNum(
                    env.OR3_WEBHOOKS_MAX_PER_USER,
                    DEFAULT_WEBHOOKS_MAX_PER_USER,
                ) ?? DEFAULT_WEBHOOKS_MAX_PER_USER,
            adminMax:
                envNum(
                    env.OR3_WEBHOOKS_ADMIN_MAX,
                    DEFAULT_WEBHOOKS_ADMIN_MAX,
                ) ?? DEFAULT_WEBHOOKS_ADMIN_MAX,
            rateLimitPerMinute:
                envNum(
                    env.OR3_WEBHOOKS_RATE_LIMIT_PER_MINUTE,
                    DEFAULT_WEBHOOKS_RATE_LIMIT_PER_MINUTE,
                ) ?? DEFAULT_WEBHOOKS_RATE_LIMIT_PER_MINUTE,
            deliveryTimeoutMs:
                envNum(
                    env.OR3_WEBHOOKS_DELIVERY_TIMEOUT_MS,
                    DEFAULT_WEBHOOKS_DELIVERY_TIMEOUT_MS,
                ) ?? DEFAULT_WEBHOOKS_DELIVERY_TIMEOUT_MS,
            blockPrivateIps: readEnvBoolean(env.OR3_WEBHOOKS_BLOCK_PRIVATE_IPS, false),
            encryptionKey:
                env.OR3_WEBHOOKS_ENCRYPTION_KEY ||
                env.OR3_ADMIN_JWT_SECRET ||
                undefined,
            maxRetryHours:
                envNum(
                    env.OR3_WEBHOOKS_MAX_RETRY_HOURS,
                    DEFAULT_WEBHOOKS_MAX_RETRY_HOURS,
                ) ?? DEFAULT_WEBHOOKS_MAX_RETRY_HOURS,
            logRetentionHours:
                envNum(
                    env.OR3_WEBHOOKS_LOG_RETENTION_HOURS,
                    DEFAULT_WEBHOOKS_LOG_RETENTION_HOURS,
                ) ?? DEFAULT_WEBHOOKS_LOG_RETENTION_HOURS,
        },
    };

    return defineOr3CloudConfig(config, { strict });
}
