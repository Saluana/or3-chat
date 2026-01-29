export interface Or3CloudConfig {
    /**
     * Authentication configuration.
     * Controls SSR authentication, providers, and permissions.
     */
    auth: {
        /**
         * Enable SSR authentication.
         * When false, the app runs in local-only mode (static compatible).
         * @default false
         */
        enabled: boolean;
        /**
         * Selected authentication provider.
         * @default 'clerk'
         */
        provider: 'clerk' | 'custom';
        /**
         * Provider-specific configuration.
         */
        clerk?: {
            /**
             * Clerk publishable key for the client.
             */
            publishableKey?: string;
            /**
             * Clerk secret key for server-side auth.
             */
            secretKey?: string;
        };
    };

    /**
     * Data Synchronization configuration.
     * Controls real-time sync, database providers, and offline capabilities.
     */
    sync: {
        /**
         * Enable data synchronization.
         * @default false
         */
        enabled: boolean;
        /**
         * Sync provider backend.
         * @default 'convex'
         */
        provider: 'convex' | 'firebase' | 'custom';
        /**
         * Convex specific configuration.
         */
        convex?: {
            /**
             * Convex deployment URL.
             */
            url?: string;
        };
    };

    /**
     * Storage configuration.
     * Controls file uploads, blob storage, and media handling.
     */
    storage: {
        /**
         * Enable cloud storage.
         * @default false
         */
        enabled: boolean;
        /**
         * Storage provider.
         * @default 'convex'
         */
        provider: 'convex' | 's3' | 'custom';
    };

    /**
     * Core cloud services and integrations.
     */
    services: {
        /**
         * AI/LLM integration settings.
         */
        llm?: {
            openRouter?: {
                /**
                 * Instance-level API key provided by the cloud hoster.
                 * Used as a fallback when users haven't configured their own key.
                 * @env OPENROUTER_API_KEY
                 */
                instanceApiKey?: string;

                /**
                 * If true, users can override with their own API key in settings.
                 * If false, only the instance key is used (enterprise deployments).
                 * @default true
                 */
                allowUserOverride?: boolean;

                /**
                 * If true, requires users to provide their own key and ignores
                 * the instance key even if it is set.
                 * @env OR3_OPENROUTER_REQUIRE_USER_KEY
                 * @default false
                 */
                requireUserKey?: boolean;
            };
        };
    };

    /**
     * Rate limiting and usage quotas.
     * Controls API usage limits for the instance.
     */
    limits?: {
        /**
         * Enable rate limiting.
         * @default true
         */
        enabled?: boolean;

        /**
         * Maximum LLM requests per user per minute.
         * @default 20
         */
        requestsPerMinute?: number;

        /**
         * Maximum conversations per user (0 = unlimited).
         * @default 0
         */
        maxConversations?: number;

        /**
         * Maximum messages per user per day (0 = unlimited).
         * @default 0
         */
        maxMessagesPerDay?: number;

        /**
         * Storage provider for rate limits.
         * - 'memory': In-memory (default, resets on restart)
         * - 'convex': Persistent via Convex
         * @default 'memory'
         */
        storageProvider?: 'memory' | 'convex' | 'redis' | 'postgres';
    };

    /**
     * Background streaming configuration (SSR mode only).
     * Enables AI streaming to continue on the server when users navigate away.
     */
    backgroundStreaming?: {
        /**
         * Enable background streaming.
         * @default false
         */
        enabled?: boolean;
        /**
         * Storage provider for background jobs.
         * @default 'memory'
         */
        storageProvider?: 'memory' | 'convex' | 'redis';
        /**
         * Maximum concurrent background jobs.
         * @default 20
         */
        maxConcurrentJobs?: number;
        /**
         * Background job timeout in seconds.
         * @default 300
         */
        jobTimeoutSeconds?: number;
    };

    /**
     * Security hardening options.
     */
    security?: {
        /**
         * Allowed origins for CORS. Empty array means all origins allowed.
         */
        allowedOrigins?: string[];

        /**
         * Force HTTPS redirects.
         * @default true in production
         */
        forceHttps?: boolean;
    };

    /**
     * Admin dashboard routing and access constraints.
     * SSR-only; ignored in static builds.
     */
    admin?: {
        /**
         * Base path for admin UI/routes.
         * @default '/admin'
         */
        basePath?: string;

        /**
         * Allowed hostnames for admin routes (optional).
         * If set, admin routes return 404 when Host does not match.
         */
        allowedHosts?: string[];

        /**
         * Allow admin-initiated restarts.
         * @default false
         */
        allowRestart?: boolean;

        /**
         * Allow admin-initiated rebuild + restart.
         * @default false
         */
        allowRebuild?: boolean;

        /**
         * Optional rebuild command (used when allowRebuild is true).
         * @default 'bun run build'
         */
        rebuildCommand?: string;

        /**
         * Maximum zip size for extension installs (bytes).
         * @default 26214400 (25MB)
         */
        extensionMaxZipBytes?: number;

        /**
         * Maximum number of files in an extension install.
         * @default 2000
         */
        extensionMaxFiles?: number;

        /**
         * Maximum total unpacked bytes for an extension install.
         * @default 209715200 (200MB)
         */
        extensionMaxTotalBytes?: number;

        /**
         * Allowed file extensions for extension installs.
         */
        extensionAllowedExtensions?: string[];
    };
}

export interface Or3CloudConfigOptions {
    /**
     * If true, throws at startup if required secrets are missing.
     * @default true in production, false in development
     */
    strict?: boolean;
}
