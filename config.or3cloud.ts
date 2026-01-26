import 'dotenv/config';
import { defineOr3CloudConfig } from './utils/or3-cloud-config';

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
        provider: (process.env.AUTH_PROVIDER ?? 'clerk') as 'clerk' | 'custom',
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
        provider: (process.env.OR3_SYNC_PROVIDER ?? 'convex') as
            | 'convex'
            | 'firebase'
            | 'custom',
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
        provider: (process.env.NUXT_PUBLIC_STORAGE_PROVIDER ?? 'convex') as
            | 'convex'
            | 's3'
            | 'custom',
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
        storageProvider: (process.env.OR3_LIMITS_STORAGE_PROVIDER ?? (syncEnabled ? 'convex' : 'memory')) as
            | 'memory'
            | 'convex'
            | 'redis'
            | 'postgres',
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
        storageProvider: (process.env.OR3_BACKGROUND_STREAMING_PROVIDER ?? (syncEnabled ? 'convex' : 'memory')) as
            | 'memory'
            | 'convex'
            | 'redis',
        maxConcurrentJobs: process.env.OR3_BACKGROUND_MAX_JOBS
            ? Number(process.env.OR3_BACKGROUND_MAX_JOBS)
            : 20,
        jobTimeoutSeconds: process.env.OR3_BACKGROUND_JOB_TIMEOUT
            ? Number(process.env.OR3_BACKGROUND_JOB_TIMEOUT)
            : 300,
    },
});
