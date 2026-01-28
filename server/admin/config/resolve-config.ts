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
} from '~~/shared/cloud/provider-ids';

type EnvMap = Record<string, string | undefined>;

function envBool(val: string | undefined, defaultValue: boolean): boolean {
    if (val === undefined) return defaultValue;
    return val === 'true';
}

function envNum(val: string | undefined, fallback?: number): number | undefined {
    if (val === undefined) return fallback;
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildOr3ConfigFromEnv(env: EnvMap) {
    return defineOr3Config({
        site: {
            name: env.OR3_SITE_NAME ?? 'OR3',
            description: env.OR3_SITE_DESCRIPTION || undefined,
            logoUrl: env.OR3_LOGO_URL || undefined,
            faviconUrl: env.OR3_FAVICON_URL || undefined,
            defaultTheme: env.OR3_DEFAULT_THEME || undefined,
        },
        features: {
            workflows: {
                enabled: env.OR3_WORKFLOWS_ENABLED
                    ? env.OR3_WORKFLOWS_ENABLED !== 'false'
                    : undefined,
                editor: env.OR3_WORKFLOWS_EDITOR
                    ? env.OR3_WORKFLOWS_EDITOR !== 'false'
                    : undefined,
                slashCommands: env.OR3_WORKFLOWS_SLASH_COMMANDS
                    ? env.OR3_WORKFLOWS_SLASH_COMMANDS !== 'false'
                    : undefined,
                execution: env.OR3_WORKFLOWS_EXECUTION
                    ? env.OR3_WORKFLOWS_EXECUTION !== 'false'
                    : undefined,
            },
            documents: {
                enabled: env.OR3_DOCUMENTS_ENABLED
                    ? env.OR3_DOCUMENTS_ENABLED !== 'false'
                    : undefined,
            },
            backup: {
                enabled: env.OR3_BACKUP_ENABLED
                    ? env.OR3_BACKUP_ENABLED !== 'false'
                    : undefined,
            },
            mentions: {
                enabled: env.OR3_MENTIONS_ENABLED
                    ? env.OR3_MENTIONS_ENABLED !== 'false'
                    : undefined,
                documents: env.OR3_MENTIONS_DOCUMENTS
                    ? env.OR3_MENTIONS_DOCUMENTS !== 'false'
                    : undefined,
                conversations: env.OR3_MENTIONS_CONVERSATIONS
                    ? env.OR3_MENTIONS_CONVERSATIONS !== 'false'
                    : undefined,
            },
            dashboard: {
                enabled: env.OR3_DASHBOARD_ENABLED
                    ? env.OR3_DASHBOARD_ENABLED !== 'false'
                    : undefined,
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
            provider: (env.AUTH_PROVIDER ?? AUTH_PROVIDER_IDS.clerk) as 'clerk' | 'custom',
            clerk: {
                publishableKey: env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined,
                secretKey: env.NUXT_CLERK_SECRET_KEY || undefined,
            },
        },
        sync: {
            enabled: syncEnabled,
            provider: (env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID) as
                | 'convex'
                | 'firebase'
                | 'custom',
            convex: {
                url: env.VITE_CONVEX_URL || undefined,
            },
        },
        storage: {
            enabled: storageEnabled,
            provider: (env.NUXT_PUBLIC_STORAGE_PROVIDER ?? DEFAULT_STORAGE_PROVIDER_ID) as
                | 'convex'
                | 's3'
                | 'custom',
        },
        services: {
            llm: {
                openRouter: {
                    instanceApiKey: env.OPENROUTER_API_KEY || undefined,
                    allowUserOverride:
                        env.OR3_OPENROUTER_ALLOW_USER_OVERRIDE !== 'false',
                },
            },
        },
        limits: {
            enabled: env.OR3_LIMITS_ENABLED !== 'false',
            requestsPerMinute: envNum(env.OR3_REQUESTS_PER_MINUTE, 20) ?? 20,
            maxConversations: envNum(env.OR3_MAX_CONVERSATIONS, 0) ?? 0,
            maxMessagesPerDay: envNum(env.OR3_MAX_MESSAGES_PER_DAY, 0) ?? 0,
            storageProvider: (env.OR3_LIMITS_STORAGE_PROVIDER ??
                (syncEnabled ? LIMITS_PROVIDER_IDS.convex : LIMITS_PROVIDER_IDS.memory)) as
                | 'memory'
                | 'convex'
                | 'redis'
                | 'postgres',
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
            basePath: env.OR3_ADMIN_BASE_PATH || '/admin',
            allowedHosts: env.OR3_ADMIN_ALLOWED_HOSTS
                ? env.OR3_ADMIN_ALLOWED_HOSTS.split(',')
                      .map((host) => host.trim())
                      .filter(Boolean)
                : [],
            allowRestart: env.OR3_ADMIN_ALLOW_RESTART === 'true',
            allowRebuild: env.OR3_ADMIN_ALLOW_REBUILD === 'true',
            rebuildCommand: env.OR3_ADMIN_REBUILD_COMMAND || 'bun run build',
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
                (syncEnabled ? BACKGROUND_PROVIDER_IDS.convex : DEFAULT_BACKGROUND_PROVIDER_ID)) as 'memory' | 'convex' | 'redis',
            maxConcurrentJobs: envNum(env.OR3_BACKGROUND_MAX_JOBS, 20) ?? 20,
            jobTimeoutSeconds: envNum(env.OR3_BACKGROUND_JOB_TIMEOUT, 300) ?? 300,
        },
    };

    const strict =
        process.env.NODE_ENV === 'production' ||
        process.env.OR3_STRICT_CONFIG === 'true';
    return defineOr3CloudConfig(config, { strict });
}
