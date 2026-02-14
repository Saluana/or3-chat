import 'dotenv/config';
import { defineOr3CloudConfig } from './utils/or3-cloud-config';
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
} from './shared/cloud/provider-ids';
import { DEFAULT_OPENROUTER_BASE_URL } from './shared/config/constants';

function parseRateLimitOverrides(
    input: string | undefined
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

const authEnabled = process.env.SSR_AUTH_ENABLED === 'true';
// Auth is the gate - sync/storage require auth but can be individually disabled
const syncEnabled = authEnabled && process.env.OR3_SYNC_ENABLED !== 'false';
const storageEnabled = authEnabled && process.env.OR3_STORAGE_ENABLED !== 'false';

export const or3CloudConfig = defineOr3CloudConfig({
    auth: {
        enabled: authEnabled,
        provider: (process.env.AUTH_PROVIDER ?? AUTH_PROVIDER_IDS.clerk) as AuthProviderId,
        guestAccessEnabled: process.env.OR3_GUEST_ACCESS_ENABLED === 'true',
        autoProvision: process.env.OR3_AUTH_AUTO_PROVISION !== 'false',
        sessionProvisioningFailure: process.env.OR3_SESSION_PROVISIONING_FAILURE as
            | 'throw'
            | 'unauthenticated'
            | 'service-unavailable'
            | undefined,
        clerk: {
            publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
            secretKey: process.env.NUXT_CLERK_SECRET_KEY,
        },
    },
    sync: {
        enabled: syncEnabled,
        provider: (process.env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID) as SyncProviderId,
        convex: {
            url: process.env.VITE_CONVEX_URL,
            adminKey: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY,
        },
    },
    storage: {
        enabled: storageEnabled,
        provider: (process.env.NUXT_PUBLIC_STORAGE_PROVIDER ?? DEFAULT_STORAGE_PROVIDER_ID) as StorageProviderId,
        allowedMimeTypes: process.env.OR3_STORAGE_ALLOWED_MIME_TYPES
            ? process.env.OR3_STORAGE_ALLOWED_MIME_TYPES.split(',')
                  .map((mime) => mime.trim())
                  .filter(Boolean)
            : undefined,
        workspaceQuotaBytes: process.env.OR3_STORAGE_WORKSPACE_QUOTA_BYTES
            ? Number(process.env.OR3_STORAGE_WORKSPACE_QUOTA_BYTES)
            : undefined,
        gcRetentionSeconds: process.env.OR3_STORAGE_GC_RETENTION_SECONDS
            ? Number(process.env.OR3_STORAGE_GC_RETENTION_SECONDS)
            : undefined,
        gcCooldownMs: process.env.OR3_STORAGE_GC_COOLDOWN_MS
            ? Number(process.env.OR3_STORAGE_GC_COOLDOWN_MS)
            : undefined,
    },
    services: {
        llm: {
            openRouter: {
                instanceApiKey: process.env.OPENROUTER_API_KEY,
                allowUserOverride:
                    process.env.OR3_OPENROUTER_ALLOW_USER_OVERRIDE !== 'false',
                requireUserKey:
                    process.env.OR3_OPENROUTER_REQUIRE_USER_KEY === 'true',
                baseUrl:
                    process.env.OR3_OPENROUTER_BASE_URL ??
                    DEFAULT_OPENROUTER_BASE_URL,
            },
        },
    },
    limits: {
        enabled: process.env.OR3_LIMITS_ENABLED !== 'false',
        requestsPerMinute: process.env.OR3_REQUESTS_PER_MINUTE
            ? Number(process.env.OR3_REQUESTS_PER_MINUTE)
            : 20,
        maxConversations: process.env.OR3_MAX_CONVERSATIONS
            ? Number(process.env.OR3_MAX_CONVERSATIONS)
            : 0,
        maxMessagesPerDay: process.env.OR3_MAX_MESSAGES_PER_DAY
            ? Number(process.env.OR3_MAX_MESSAGES_PER_DAY)
            : 0,
        // Derive limits provider from sync provider when available, otherwise memory
        storageProvider: (process.env.OR3_LIMITS_STORAGE_PROVIDER ?? (syncEnabled ? (process.env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID) : LIMITS_PROVIDER_IDS.memory)) as LimitsProviderId,
        operationRateLimits: parseRateLimitOverrides(
            process.env.OR3_RATE_LIMIT_OVERRIDES_JSON
        ),
    },
    security: {
        allowedOrigins: process.env.OR3_ALLOWED_ORIGINS
            ? process.env.OR3_ALLOWED_ORIGINS.split(',')
                  .map((origin) => origin.trim())
                  .filter(Boolean)
            : [],
        forceHttps:
            process.env.OR3_FORCE_HTTPS !== undefined
                ? process.env.OR3_FORCE_HTTPS === 'true'
                : process.env.NODE_ENV === 'production',
        proxy: {
            trustProxy: process.env.OR3_TRUST_PROXY === 'true',
            forwardedForHeader:
                process.env.OR3_FORWARDED_FOR_HEADER === 'x-real-ip'
                    ? 'x-real-ip'
                    : 'x-forwarded-for',
            forwardedHostHeader: 'x-forwarded-host' as const,
        },
    },
    admin: {
        basePath: process.env.OR3_ADMIN_BASE_PATH || '/admin',
        allowedHosts: process.env.OR3_ADMIN_ALLOWED_HOSTS
            ? process.env.OR3_ADMIN_ALLOWED_HOSTS.split(',')
                  .map((host) => host.trim())
                  .filter(Boolean)
            : [],
        allowRestart: process.env.OR3_ADMIN_ALLOW_RESTART === 'true',
        allowRebuild: process.env.OR3_ADMIN_ALLOW_REBUILD === 'true',
        rebuildCommand: process.env.OR3_ADMIN_REBUILD_COMMAND || 'bun run build',
        extensionMaxZipBytes: process.env.OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES
            ? Number(process.env.OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES)
            : undefined,
        extensionMaxFiles: process.env.OR3_ADMIN_EXTENSION_MAX_FILES
            ? Number(process.env.OR3_ADMIN_EXTENSION_MAX_FILES)
            : undefined,
        extensionMaxTotalBytes: process.env.OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES
            ? Number(process.env.OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES)
            : undefined,
        extensionAllowedExtensions: process.env.OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS
            ? process.env.OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS.split(',')
                  .map((ext) => ext.trim())
                  .filter(Boolean)
            : undefined,
        auth: {
            username: process.env.OR3_ADMIN_USERNAME,
            password: process.env.OR3_ADMIN_PASSWORD,
            jwtSecret: process.env.OR3_ADMIN_JWT_SECRET,
            jwtExpiry: process.env.OR3_ADMIN_JWT_EXPIRY || '24h',
            deletedWorkspaceRetentionDays: process.env.OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS
                ? Number(process.env.OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS)
                : undefined,
        },
    },
    // Enables AI streaming to continue on server when users navigate away (SSR only)
    backgroundStreaming: {
        enabled: process.env.OR3_BACKGROUND_STREAMING_ENABLED === 'true',
        storageProvider: (process.env.OR3_BACKGROUND_STREAMING_PROVIDER ?? (syncEnabled ? (process.env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID) : DEFAULT_BACKGROUND_PROVIDER_ID)) as BackgroundProviderId,
        maxConcurrentJobs: process.env.OR3_BACKGROUND_MAX_JOBS
            ? Number(process.env.OR3_BACKGROUND_MAX_JOBS)
            : 20,
        maxConcurrentJobsPerUser: process.env.OR3_BACKGROUND_MAX_JOBS_PER_USER
            ? Number(process.env.OR3_BACKGROUND_MAX_JOBS_PER_USER)
            : 5,
        jobTimeoutSeconds: process.env.OR3_BACKGROUND_JOB_TIMEOUT
            ? Number(process.env.OR3_BACKGROUND_JOB_TIMEOUT)
            : 300,
    },
});
