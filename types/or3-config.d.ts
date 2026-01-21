export interface Or3Config {
    /**
     * Site branding and identity settings.
     */
    site: {
        /**
         * Display name for the site.
         * @default "OR3"
         */
        name: string;

        /**
         * Site description for meta tags.
         */
        description?: string;

        /**
         * URL to custom logo image.
         */
        logoUrl?: string;

        /**
         * URL to custom favicon.
         */
        faviconUrl?: string;

        /**
         * Default theme for new users.
         * @default "blank"
         */
        defaultTheme?: string;
    };

    /**
     * Feature toggles for enabling/disabling capabilities.
     */
    features: {
        /**
         * Workflow automation feature with granular controls.
         */
        workflows?: {
            /** Master toggle - disables all workflow functionality when false */
            enabled?: boolean;
            /** Allow access to workflow editor UI */
            editor?: boolean;
            /** Enable workflow slash commands (/) */
            slashCommands?: boolean;
            /** Allow workflow execution */
            execution?: boolean;
        };

        /**
         * Document editor feature.
         */
        documents?: {
            /** Enable/disable the document editor */
            enabled?: boolean;
        };

        /**
         * Workspace backup/restore feature.
         */
        backup?: {
            /** Enable/disable workspace backup functionality */
            enabled?: boolean;
        };

        /**
         * @mentions autocomplete with granular source controls.
         */
        mentions?: {
            /** Master toggle - disables all mention functionality when false */
            enabled?: boolean;
            /** Allow @mentions for documents */
            documents?: boolean;
            /** Allow @mentions for past conversations */
            conversations?: boolean;
        };

        /**
         * Dashboard settings panel.
         */
        dashboard?: {
            /** Enable/disable the dashboard */
            enabled?: boolean;
        };
    };

    /**
     * Upload and storage limits.
     */
    limits: {
        /**
         * Maximum file size for local uploads (bytes).
         * @default 20971520 (20MB)
         */
        maxFileSizeBytes?: number;

        /**
         * Maximum file size for cloud uploads (bytes).
         * @default 104857600 (100MB)
         */
        maxCloudFileSizeBytes?: number;

        /**
         * Maximum files per chat message.
         * @default 10
         */
        maxFilesPerMessage?: number;

        /**
         * Local storage quota warning threshold (MB).
         * When set, warnings appear when usage approaches this limit.
         */
        localStorageQuotaMB?: number;
    };

    /**
     * UI experience defaults.
     */
    ui?: {
        /**
         * Default number of panes for new users.
         * @default 1
         */
        defaultPaneCount?: number;

        /**
         * Maximum number of panes allowed.
         * @default 4
         */
        maxPanes?: number;

        /**
         * Whether sidebar starts collapsed by default.
         * @default false
         */
        sidebarCollapsedByDefault?: boolean;
    };

    /**
     * Plugin/extension configuration namespace.
     * Allows third-party plugins to register their own config.
     */
    extensions?: Record<string, unknown>;

    /**
     * Legal URLs for compliance and footer links.
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
}

export interface Or3ConfigOptions {
    /**
     * If true, throws at startup if required values are missing.
     * @default true in production, false in development
     */
    strict?: boolean;
}

/**
 * Resolved config with all defaults applied.
 * All optional fields are guaranteed to have values.
 */
export interface ResolvedOr3Config {
    site: {
        name: string;
        description: string;
        logoUrl: string;
        faviconUrl: string;
        defaultTheme: string;
    };
    features: {
        workflows: {
            enabled: boolean;
            editor: boolean;
            slashCommands: boolean;
            execution: boolean;
        };
        documents: {
            enabled: boolean;
        };
        backup: {
            enabled: boolean;
        };
        mentions: {
            enabled: boolean;
            documents: boolean;
            conversations: boolean;
        };
        dashboard: {
            enabled: boolean;
        };
    };
    limits: {
        maxFileSizeBytes: number;
        maxCloudFileSizeBytes: number;
        maxFilesPerMessage: number;
        localStorageQuotaMB: number | null;
    };
    ui: {
        defaultPaneCount: number;
        maxPanes: number;
        sidebarCollapsedByDefault: boolean;
    };
    extensions: Record<string, unknown>;
    legal: {
        termsUrl: string;
        privacyUrl: string;
    };
}
