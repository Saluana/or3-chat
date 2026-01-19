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
    };

    /**
     * Branding and customization options.
     * Allows cloud hosters to customize the app appearance.
     */
    branding?: {
        /**
         * Custom application name.
         * @default 'OR3'
         */
        appName?: string;

        /**
         * URL to a custom logo image.
         */
        logoUrl?: string;

        /**
         * Default theme for new users.
         * @default 'system'
         */
        defaultTheme?: 'light' | 'dark' | 'system' | string;
    };

    /**
     * Legal URLs for compliance.
     * Required for public deployments.
     */
    legal?: {
        /**
         * URL to Terms of Service page.
         */
        termsUrl?: string;

        /**
         * URL to Privacy Policy page.
         */
        privacyUrl?: string;
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
     * Plugin/extension configuration namespace.
     * Allows third-party plugins to register their own config.
     * @example { myPlugin: { settingA: true } }
     */
    extensions?: Record<string, unknown>;
}

export interface Or3CloudConfigOptions {
    /**
     * If true, throws at startup if required secrets are missing.
     * @default true in production, false in development
     */
    strict?: boolean;
}
