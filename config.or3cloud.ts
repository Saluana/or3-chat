import 'dotenv/config';
import { defineOr3CloudConfig } from './utils/or3-cloud-config';
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
} from './shared/cloud/provider-ids';

const authEnabled = process.env.SSR_AUTH_ENABLED === 'true';
// Auth is the gate - sync/storage require auth but can be individually disabled
const syncEnabled = authEnabled && process.env.OR3_SYNC_ENABLED !== 'false';
const storageEnabled = authEnabled && process.env.OR3_STORAGE_ENABLED !== 'false';

export const or3CloudConfig = defineOr3CloudConfig({
    /**
     * Authentication configuration (SSR auth providers).
     */
    auth: {
        enabled: authEnabled,
        provider: (process.env.AUTH_PROVIDER ?? AUTH_PROVIDER_IDS.clerk) as AuthProviderId,
        clerk: {
            publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
            secretKey: process.env.NUXT_CLERK_SECRET_KEY,
        },
    },
    /**
     * Sync configuration (Convex gateway/direct).
     */
    sync: {
        enabled: syncEnabled,
        provider: (process.env.OR3_SYNC_PROVIDER ?? DEFAULT_SYNC_PROVIDER_ID) as SyncProviderId,
        convex: {
            url:
                process.env.VITE_CONVEX_URL ||
                undefined,
        },
    },
    /**
     * Storage configuration for file uploads.
     */
    storage: {
        enabled: storageEnabled,
        provider: (process.env.NUXT_PUBLIC_STORAGE_PROVIDER ?? DEFAULT_STORAGE_PROVIDER_ID) as StorageProviderId,
    },
    /**
     * Service integrations (LLM, etc.).
     */
    services: {
        llm: {
            openRouter: {
                instanceApiKey: process.env.OPENROUTER_API_KEY,
                allowUserOverride:
                    process.env.OR3_OPENROUTER_ALLOW_USER_OVERRIDE !== 'false',
            },
        },
    },
    /**
     * Usage limits and rate limiting.
     */
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
        // Use Convex for persistent limits when sync is enabled, otherwise memory
        storageProvider: (process.env.OR3_LIMITS_STORAGE_PROVIDER ?? (syncEnabled ? LIMITS_PROVIDER_IDS.convex : LIMITS_PROVIDER_IDS.memory)) as LimitsProviderId,
    },
    /**
     * Security options (CORS + HTTPS redirects).
     */
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
    },
    /**
     * Admin dashboard routing constraints.
     */
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
    },
    /**
     * Background streaming configuration (SSR mode only).
     * Enables AI streaming to continue on the server when users navigate away.
     */
    backgroundStreaming: {
        enabled: process.env.OR3_BACKGROUND_STREAMING_ENABLED === 'true',
        storageProvider: (process.env.OR3_BACKGROUND_STREAMING_PROVIDER ?? (syncEnabled ? BACKGROUND_PROVIDER_IDS.convex : DEFAULT_BACKGROUND_PROVIDER_ID)) as BackgroundProviderId,
        maxConcurrentJobs: process.env.OR3_BACKGROUND_MAX_JOBS
            ? Number(process.env.OR3_BACKGROUND_MAX_JOBS)
            : 20,
        jobTimeoutSeconds: process.env.OR3_BACKGROUND_JOB_TIMEOUT
            ? Number(process.env.OR3_BACKGROUND_JOB_TIMEOUT)
            : 300,
    },
});
