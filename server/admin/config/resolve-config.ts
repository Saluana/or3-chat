import { defineOr3Config } from '~~/utils/or3-config';
import { defineOr3CloudConfig } from '~~/utils/or3-cloud-config';
import type { Or3CloudConfig } from '~~/types/or3-cloud-config';
import {
    AUTH_PROVIDER_IDS,
    BACKGROUND_PROVIDER_IDS,
    DEFAULT_BACKGROUND_PROVIDER_ID,
    DEFAULT_STORAGE_PROVIDER_ID,
    DEFAULT_SYNC_PROVIDER_ID,
    LIMITS_PROVIDER_IDS,
    type AuthProviderId,
    type BackgroundProviderId,
    type LimitsProviderId,
    type StorageProviderId,
    type SyncProviderId,
} from '~~/shared/cloud/provider-ids';
import {
    DEFAULT_SITE_NAME,
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_MAX_CONVERSATIONS,
    DEFAULT_MAX_MESSAGES_PER_DAY,
    DEFAULT_ADMIN_BASE_PATH,
    DEFAULT_REBUILD_COMMAND,
    DEFAULT_BACKGROUND_MAX_JOBS,
    DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
} from '~~/shared/config/constants';

type EnvMap = Record<string, string | undefined>;

function envBool(val: string | undefined, defaultValue: boolean): boolean {
    if (val === undefined) return defaultValue;
    return ['true', '1', 'yes', 'on'].includes(val.toLowerCase());
}

function envNum(val: string | undefined, fallback?: number): number | undefined {
    if (val === undefined) return fallback;
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// Helper for feature toggles that default to true unless explicitly 'false'
function envFeature(val: string | undefined): boolean | undefined {
    if (val === undefined) return undefined;
    return val !== 'false';
}

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
                enabled: envFeature(env.OR3_WORKFLOWS_ENABLED),
                editor: envFeature(env.OR3_WORKFLOWS_EDITOR),
                slashCommands: envFeature(env.OR3_WORKFLOWS_SLASH_COMMANDS),
                execution: envFeature(env.OR3_WORKFLOWS_EXECUTION),
            },
            documents: {
                enabled: envFeature(env.OR3_DOCUMENTS_ENABLED),
            },
            backup: {
                enabled: envFeature(env.OR3_BACKUP_ENABLED),
            },
            mentions: {
                enabled: envFeature(env.OR3_MENTIONS_ENABLED),
                documents: envFeature(env.OR3_MENTIONS_DOCUMENTS),
                conversations: envFeature(env.OR3_MENTIONS_CONVERSATIONS),
            },
            dashboard: {
                enabled: envFeature(env.OR3_DASHBOARD_ENABLED),
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

export function buildOr3CloudConfigFromEnv(env: EnvMap) {
    const authEnabled = env.SSR_AUTH_ENABLED === 'true';
    const syncEnabled = authEnabled && env.OR3_SYNC_ENABLED !== 'false';
    const storageEnabled = authEnabled && env.OR3_STORAGE_ENABLED !== 'false';

    const config: Or3CloudConfig = {
        auth: {
            enabled: authEnabled,
            provider: (env.AUTH_PROVIDER ?? AUTH_PROVIDER_IDS.clerk) as AuthProviderId,
            clerk: {
                publishableKey: env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined,
                secretKey: env.NUXT_CLERK_SECRET_KEY || undefined,
            },
        },
        sync: {
            enabled: syncEnabled,
            provider: (env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID) as SyncProviderId,
            convex: {
                url: env.VITE_CONVEX_URL || undefined,
                adminKey: env.CONVEX_SELF_HOSTED_ADMIN_KEY || undefined,
            },
        },
        storage: {
            enabled: storageEnabled,
            provider: (env.NUXT_PUBLIC_STORAGE_PROVIDER ?? DEFAULT_STORAGE_PROVIDER_ID) as StorageProviderId,
        },
        services: {
            llm: {
                openRouter: {
                    instanceApiKey: env.OPENROUTER_API_KEY || undefined,
                    allowUserOverride:
                        env.OR3_OPENROUTER_ALLOW_USER_OVERRIDE !== 'false',
                    requireUserKey:
                        env.OR3_OPENROUTER_REQUIRE_USER_KEY === 'true',
                },
            },
        },
        limits: {
            enabled: env.OR3_LIMITS_ENABLED !== 'false',
            requestsPerMinute: envNum(env.OR3_REQUESTS_PER_MINUTE, DEFAULT_REQUESTS_PER_MINUTE) ?? DEFAULT_REQUESTS_PER_MINUTE,
            maxConversations: envNum(env.OR3_MAX_CONVERSATIONS, DEFAULT_MAX_CONVERSATIONS) ?? DEFAULT_MAX_CONVERSATIONS,
            maxMessagesPerDay: envNum(env.OR3_MAX_MESSAGES_PER_DAY, DEFAULT_MAX_MESSAGES_PER_DAY) ?? DEFAULT_MAX_MESSAGES_PER_DAY,
            storageProvider: (env.OR3_LIMITS_STORAGE_PROVIDER ??
                (syncEnabled ? LIMITS_PROVIDER_IDS.convex : LIMITS_PROVIDER_IDS.memory)) as LimitsProviderId,
        },
        security: {
            allowedOrigins: env.OR3_ALLOWED_ORIGINS
                ? env.OR3_ALLOWED_ORIGINS.split(',')
                      .map((origin) => origin.trim())
                      .filter(Boolean)
                : [],
            forceHttps: envBool(
                env.OR3_FORCE_HTTPS,
                env.NODE_ENV === 'production'
            ),
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
            rebuildCommand: env.OR3_ADMIN_REBUILD_COMMAND || DEFAULT_REBUILD_COMMAND,
            extensionMaxZipBytes: envNum(env.OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES),
            extensionMaxFiles: envNum(env.OR3_ADMIN_EXTENSION_MAX_FILES),
            extensionMaxTotalBytes: envNum(env.OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES),
            extensionAllowedExtensions: env.OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS
                ? env.OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS.split(',')
                      .map((ext) => ext.trim())
                      .filter(Boolean)
                : undefined,
        },
        backgroundStreaming: {
            enabled: env.OR3_BACKGROUND_STREAMING_ENABLED === 'true',
            storageProvider: (env.OR3_BACKGROUND_STREAMING_PROVIDER ??
                (syncEnabled ? BACKGROUND_PROVIDER_IDS.convex : DEFAULT_BACKGROUND_PROVIDER_ID)) as BackgroundProviderId,
            maxConcurrentJobs: envNum(env.OR3_BACKGROUND_MAX_JOBS, DEFAULT_BACKGROUND_MAX_JOBS) ?? DEFAULT_BACKGROUND_MAX_JOBS,
            jobTimeoutSeconds: envNum(env.OR3_BACKGROUND_JOB_TIMEOUT, DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS) ?? DEFAULT_BACKGROUND_JOB_TIMEOUT_SECONDS,
        },
    };

    const strict =
        process.env.NODE_ENV === 'production' ||
        process.env.OR3_STRICT_CONFIG === 'true';
    return defineOr3CloudConfig(config, { strict });
}
