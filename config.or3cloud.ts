import { defineOr3CloudConfig } from './utils/or3-cloud-config';

const authEnabled = process.env.SSR_AUTH_ENABLED === 'true';
const syncEnabled =
    process.env.OR3_SYNC_ENABLED === 'true' || authEnabled;
const storageEnabled =
    process.env.OR3_STORAGE_ENABLED === 'true' || authEnabled;

export const or3CloudConfig = defineOr3CloudConfig({
    /**
     * Authentication configuration (SSR auth providers).
     */
    auth: {
        enabled: authEnabled,
        provider: (process.env.AUTH_PROVIDER as 'clerk' | 'custom') || 'clerk',
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
        provider:
            (process.env.OR3_SYNC_PROVIDER as
                | 'convex'
                | 'firebase'
                | 'custom') || 'convex',
        convex: {
            url:
                process.env.NUXT_PUBLIC_CONVEX_URL ||
                process.env.VITE_CONVEX_URL ||
                undefined,
        },
    },
    /**
     * Storage configuration for file uploads.
     */
    storage: {
        enabled: storageEnabled,
        provider:
            (process.env.NUXT_PUBLIC_STORAGE_PROVIDER as
                | 'convex'
                | 's3'
                | 'custom') || 'convex',
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
    },
    /**
     * Branding for the UI and theme defaults.
     */
    branding: {
        appName: process.env.OR3_APP_NAME || 'OR3',
        logoUrl: process.env.OR3_LOGO_URL,
        defaultTheme: process.env.OR3_DEFAULT_THEME || 'system',
    },
    /**
     * Legal URLs for footer links.
     */
    legal: {
        termsUrl: process.env.OR3_TERMS_URL,
        privacyUrl: process.env.OR3_PRIVACY_URL,
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
    extensions: {},
});
