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
        provider: string;
        /**
         * Allow unauthenticated users to use the app with their own OpenRouter key.
         * Requires allowUserOverride to also be true.
         * @default false
         */
        guestAccessEnabled?: boolean;
        /**
         * Automatically provision users/workspaces on first authenticated session.
         * When false, only pre-provisioned users can sign in.
         * @default true
         */
        autoProvision?: boolean;
        /**
         * Behavior when workspace provisioning fails during session resolution.
         * - 'throw': preserve current behavior and throw (default)
         * - 'unauthenticated': return unauthenticated session
         * - 'service-unavailable': throw 503 for session endpoint
         * @default 'throw'
         */
        sessionProvisioningFailure?: 'throw' | 'unauthenticated' | 'service-unavailable';
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
        provider: string;
        /**
         * Convex specific configuration.
         */
        convex?: {
            /**
             * Convex deployment URL.
             */
            url?: string;
            /**
             * Convex admin key for server-side admin operations.
             * Required to use the admin dashboard without a user auth session.
             * @env CONVEX_SELF_HOSTED_ADMIN_KEY
             */
            adminKey?: string;
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
        provider: string;
        /**
         * Allowlisted MIME types for upload presign requests.
         * @env OR3_STORAGE_ALLOWED_MIME_TYPES
         */
        allowedMimeTypes?: string[];
        /**
         * Optional per-workspace storage quota in bytes.
         * When unset, quota enforcement is disabled.
         * @env OR3_STORAGE_WORKSPACE_QUOTA_BYTES
         */
        workspaceQuotaBytes?: number;
        /**
         * Default GC retention window in seconds.
         * Used when `/api/storage/gc/run` omits `retention_seconds`.
         * @default 2592000 (30 days)
         * @env OR3_STORAGE_GC_RETENTION_SECONDS
         */
        gcRetentionSeconds?: number;
        /**
         * Cooldown window for manual storage GC runs.
         * @default 60000
         * @env OR3_STORAGE_GC_COOLDOWN_MS
         */
        gcCooldownMs?: number;
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
                /**
                 * Base URL for OpenRouter-compatible API endpoints.
                 * Useful for proxy setups.
                 * @default 'https://openrouter.ai/api/v1'
                 * @env OR3_OPENROUTER_BASE_URL
                 */
                baseUrl?: string;
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
        storageProvider?: string;
        /**
         * Optional per-operation rate limit overrides.
         * Keyed by operation name (e.g. 'sync:push', 'storage:upload').
         * @env OR3_RATE_LIMIT_OVERRIDES_JSON
         */
        operationRateLimits?: Record<
            string,
            {
                windowMs?: number;
                maxRequests?: number;
            }
        >;
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
        storageProvider?: string;
        /**
         * Maximum concurrent background jobs.
         * @default 20
         */
        maxConcurrentJobs?: number;
        /**
         * Maximum concurrent background jobs per user.
         * @default 5
         */
        maxConcurrentJobsPerUser?: number;
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

        /**
         * Proxy trust configuration for secure deployments behind reverse proxies.
         * When trustProxy is true, the server uses X-Forwarded-* headers for
         * client IP and host resolution instead of socket addresses.
         */
        proxy?: {
            /**
             * Trust X-Forwarded-* headers from proxies.
             * @default false
             */
            trustProxy?: boolean;

            /**
             * Header name for client IP resolution.
             * @default 'x-forwarded-for'
             */
            forwardedForHeader?: 'x-forwarded-for' | 'x-real-ip';

            /**
             * Header name for forwarded host.
             * @default 'x-forwarded-host'
             */
            forwardedHostHeader?: 'x-forwarded-host';
        };
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

        /**
         * Admin authentication configuration.
         * Enables dedicated super-admin authentication for the admin dashboard.
         */
        auth?: {
            /**
             * Super admin username (required to enable admin auth).
             * @env OR3_ADMIN_USERNAME
             */
            username?: string;

            /**
             * Super admin password (required to enable admin auth).
             * @env OR3_ADMIN_PASSWORD
             */
            password?: string;

            /**
             * JWT signing secret (auto-generated if not provided).
             * @env OR3_ADMIN_JWT_SECRET
             */
            jwtSecret?: string;

            /**
             * JWT expiration time (e.g., '24h', '7d').
             * @default '24h'
             * @env OR3_ADMIN_JWT_EXPIRY
             */
            jwtExpiry?: string;

            /**
             * Days to retain soft-deleted workspaces (unset = retain indefinitely).
             * @env OR3_ADMIN_DELETED_WORKSPACE_RETENTION_DAYS
             */
            deletedWorkspaceRetentionDays?: number;
        };
    };
}

export interface Or3CloudConfigOptions {
    /**
     * If true, throws at startup if required secrets are missing.
     * @default true in production, false in development
     */
    strict?: boolean;
}
