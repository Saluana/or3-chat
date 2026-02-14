/**
 * @module server/admin/config/config-metadata.ts
 *
 * Purpose:
 * Defines the schema and human-readable metadata for all system configuration options.
 * Serves as the source of truth for UI labels, descriptions, and logical grouping
 * in the admin dashboard.
 *
 * Responsibilities:
 * - Maintenance of the global CONFIG_METADATA registry.
 * - Definition of the EnrichedConfigEntry type for UI consumption.
 * - Providing lookup utilities for configuration groups and individual keys.
 *
 * Non-goals:
 * - Does not handle environment variable resolution (see resolve-config.ts).
 * - Does not handle persistence to disk (see env-file.ts).
 */

/**
 * Metadata for a single configuration entry.
 *
 * Purpose:
 * Provides the necessary context to render a configuration field in the UI
 * and validate its value type.
 */
export type ConfigMetadata = {
    /** Human-readable label for the configuration setting */
    label: string;
    /** Detailed description of what the setting does and its impact */
    description: string;
    /** Group category for UI organization and navigation */
    group: ConfigGroup;
    /** Relative display order within the assigned group */
    order?: number;
    /** Expected data type of the value for UI input selection */
    valueType?: 'string' | 'boolean' | 'number';
};

/**
 * Human-readable categories for grouping configuration settings in the UI.
 *
 * Architecture:
 * These groups are used to generate the navigation tabs or sections in the
 * Admin Dashboard > Settings interface.
 */
export const CONFIG_GROUPS = [
    'Auth',
    'Sync',
    'Storage',
    'UI & Branding',
    'Features',
    'Limits & Security',
    'Background Processing',
    'Admin',
    'External Services',
] as const;

export type ConfigGroup = (typeof CONFIG_GROUPS)[number];

/**
 * Central registry of configuration metadata.
 *
 * Maps environment variable names to their descriptive metadata. Every key
 * intended for editing via the admin dashboard should be registered here.
 */
export const CONFIG_METADATA: Record<string, ConfigMetadata> = {
    // Auth
    'SSR_AUTH_ENABLED': {
        label: 'Enable Server-Side Auth',
        description: 'Enable server-side rendering with authentication (required for cloud deployments)',
        group: 'Auth',
        order: 1,
        valueType: 'boolean',
    },
    'AUTH_PROVIDER': {
        label: 'Auth Provider',
        description: 'Authentication provider to use (e.g., clerk, local)',
        group: 'Auth',
        order: 2,
    },
    'OR3_AUTH_PROVIDER': {
        label: 'Auth Provider (Alias)',
        description: 'Alias for AUTH_PROVIDER used by the cloud install wizard.',
        group: 'Auth',
        order: 2,
    },
    'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY': {
        label: 'Clerk Publishable Key',
        description: 'Clerk publishable API key for client-side authentication',
        group: 'Auth',
        order: 3,
    },
    'NUXT_CLERK_SECRET_KEY': {
        label: 'Clerk Secret Key',
        description: 'Clerk secret API key for server-side authentication',
        group: 'Auth',
        order: 4,
    },
    'OR3_GUEST_ACCESS_ENABLED': {
        label: 'Allow Guest Access',
        description: 'Allow unauthenticated users to chat using their own OpenRouter key',
        group: 'Auth',
        order: 5,
        valueType: 'boolean',
    },
    'OR3_BASIC_AUTH_JWT_SECRET': {
        label: 'Basic Auth JWT Secret',
        description: 'Signing secret for the basic-auth access token JWT',
        group: 'Auth',
        order: 6,
    },
    'OR3_BASIC_AUTH_REFRESH_SECRET': {
        label: 'Basic Auth Refresh Secret',
        description: 'Optional separate signing secret for basic-auth refresh tokens',
        group: 'Auth',
        order: 7,
    },
    'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS': {
        label: 'Basic Auth Access TTL',
        description: 'Access token TTL in seconds for basic-auth sessions',
        group: 'Auth',
        order: 8,
        valueType: 'number',
    },
    'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS': {
        label: 'Basic Auth Refresh TTL',
        description: 'Refresh token TTL in seconds for basic-auth sessions',
        group: 'Auth',
        order: 9,
        valueType: 'number',
    },
    'OR3_BASIC_AUTH_DB_PATH': {
        label: 'Basic Auth DB Path',
        description: 'Filesystem path for the basic-auth provider SQLite database',
        group: 'Auth',
        order: 10,
    },
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL': {
        label: 'Basic Auth Bootstrap Email',
        description: 'Initial admin account email used on first boot of basic-auth',
        group: 'Auth',
        order: 11,
    },
    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD': {
        label: 'Basic Auth Bootstrap Password',
        description: 'Initial admin account password used on first boot of basic-auth',
        group: 'Auth',
        order: 12,
    },

    // Sync
    'OR3_SYNC_ENABLED': {
        label: 'Enable Sync',
        description: 'Enable real-time data synchronization across devices',
        group: 'Sync',
        order: 1,
        valueType: 'boolean',
    },
    'OR3_CLOUD_SYNC_ENABLED': {
        label: 'Enable Sync (Alias)',
        description: 'Alias for OR3_SYNC_ENABLED used by the cloud install wizard',
        group: 'Sync',
        order: 1,
        valueType: 'boolean',
    },
    'OR3_SYNC_PROVIDER': {
        label: 'Sync Provider',
        description: 'Backend provider for data synchronization (e.g., convex, local)',
        group: 'Sync',
        order: 2,
    },
    'VITE_CONVEX_URL': {
        label: 'Convex URL',
        description: 'Convex backend URL for sync and storage services',
        group: 'Sync',
        order: 3,
    },
    'CONVEX_SELF_HOSTED_ADMIN_KEY': {
        label: 'Convex Admin Key',
        description: 'Server-side Convex admin key for super admin dashboard access',
        group: 'Sync',
        order: 4,
    },
    'OR3_SQLITE_DB_PATH': {
        label: 'SQLite DB Path',
        description: 'Path to the SQLite database file used by the sqlite sync provider',
        group: 'Sync',
        order: 5,
    },
    'OR3_SQLITE_PRAGMA_JOURNAL_MODE': {
        label: 'SQLite Journal Mode',
        description: 'PRAGMA journal_mode value for sqlite sync provider (recommended: WAL)',
        group: 'Sync',
        order: 6,
    },
    'OR3_SQLITE_PRAGMA_SYNCHRONOUS': {
        label: 'SQLite Synchronous',
        description: 'PRAGMA synchronous value for sqlite sync provider (recommended: NORMAL)',
        group: 'Sync',
        order: 7,
    },
    'OR3_SQLITE_ALLOW_IN_MEMORY': {
        label: 'SQLite Allow In Memory',
        description: 'Allow sqlite sync provider to use an in-memory DB in non-test environments',
        group: 'Sync',
        order: 8,
        valueType: 'boolean',
    },
    'OR3_SQLITE_STRICT': {
        label: 'SQLite Strict Mode',
        description: 'Reject in-memory sqlite DB configuration when true',
        group: 'Sync',
        order: 9,
        valueType: 'boolean',
    },

    // Storage
    'OR3_STORAGE_ENABLED': {
        label: 'Enable Cloud Storage',
        description: 'Enable cloud storage for file uploads and attachments',
        group: 'Storage',
        order: 1,
        valueType: 'boolean',
    },
    'OR3_CLOUD_STORAGE_ENABLED': {
        label: 'Enable Cloud Storage (Alias)',
        description: 'Alias for OR3_STORAGE_ENABLED used by the cloud install wizard',
        group: 'Storage',
        order: 1,
        valueType: 'boolean',
    },
    'NUXT_PUBLIC_STORAGE_PROVIDER': {
        label: 'Storage Provider',
        description: 'Backend provider for cloud file storage (e.g., convex, local)',
        group: 'Storage',
        order: 2,
    },
    'OR3_STORAGE_ALLOWED_MIME_TYPES': {
        label: 'Allowed MIME Types',
        description: 'Comma-separated allowlist for upload MIME types',
        group: 'Storage',
        order: 3,
    },
    'OR3_STORAGE_WORKSPACE_QUOTA_BYTES': {
        label: 'Workspace Storage Quota (Bytes)',
        description: 'Optional per-workspace storage quota in bytes',
        group: 'Storage',
        order: 4,
        valueType: 'number',
    },
    'OR3_STORAGE_GC_RETENTION_SECONDS': {
        label: 'Storage GC Retention (Seconds)',
        description: 'Default retention window used by storage GC',
        group: 'Storage',
        order: 5,
        valueType: 'number',
    },
    'OR3_STORAGE_GC_COOLDOWN_MS': {
        label: 'Storage GC Cooldown (ms)',
        description: 'Cooldown period between manual storage GC runs',
        group: 'Storage',
        order: 6,
        valueType: 'number',
    },
    'OR3_MAX_FILE_SIZE_BYTES': {
        label: 'Max Local File Size',
        description: 'Maximum file size for local uploads in bytes (e.g., 10485760 for 10MB)',
        group: 'Storage',
        order: 7,
        valueType: 'number',
    },
    'OR3_MAX_CLOUD_FILE_SIZE_BYTES': {
        label: 'Max Cloud File Size',
        description: 'Maximum file size for cloud uploads in bytes',
        group: 'Storage',
        order: 8,
        valueType: 'number',
    },
    'OR3_MAX_FILES_PER_MESSAGE': {
        label: 'Max Files Per Message',
        description: 'Maximum number of files that can be attached to a single message',
        group: 'Storage',
        order: 9,
        valueType: 'number',
    },
    'OR3_LOCAL_STORAGE_QUOTA_MB': {
        label: 'Local Storage Quota (MB)',
        description: 'Maximum local storage quota in megabytes for browser storage',
        group: 'Storage',
        order: 10,
        valueType: 'number',
    },
    'OR3_STORAGE_FS_ROOT': {
        label: 'FS Storage Root',
        description: 'Absolute path used by the filesystem storage provider for blob data',
        group: 'Storage',
        order: 11,
    },
    'OR3_STORAGE_FS_TOKEN_SECRET': {
        label: 'FS Storage Token Secret',
        description: 'Signing secret used by filesystem storage presigned URL tokens',
        group: 'Storage',
        order: 12,
    },
    'OR3_STORAGE_FS_URL_TTL_SECONDS': {
        label: 'FS Storage URL TTL',
        description: 'Presigned URL lifetime in seconds for filesystem storage',
        group: 'Storage',
        order: 13,
        valueType: 'number',
    },

    // UI & Branding
    'OR3_SITE_NAME': {
        label: 'Site Name',
        description: 'Name of your application displayed in the UI',
        group: 'UI & Branding',
        order: 1,
    },
    'OR3_SITE_DESCRIPTION': {
        label: 'Site Description',
        description: 'Short description of your application',
        group: 'UI & Branding',
        order: 2,
    },
    'OR3_LOGO_URL': {
        label: 'Logo URL',
        description: 'URL to your application logo image',
        group: 'UI & Branding',
        order: 3,
    },
    'OR3_FAVICON_URL': {
        label: 'Favicon URL',
        description: 'URL to your application favicon',
        group: 'UI & Branding',
        order: 4,
    },
    'OR3_DEFAULT_THEME': {
        label: 'Default Theme',
        description: 'Default theme to use (e.g., system, dark, light)',
        group: 'UI & Branding',
        order: 5,
    },
    'OR3_DEFAULT_PANE_COUNT': {
        label: 'Default Pane Count',
        description: 'Default number of chat panes to display',
        group: 'UI & Branding',
        order: 6,
        valueType: 'number',
    },
    'OR3_MAX_PANES': {
        label: 'Max Pane Count',
        description: 'Maximum number of chat panes allowed',
        group: 'UI & Branding',
        order: 7,
        valueType: 'number',
    },
    'OR3_SIDEBAR_COLLAPSED': {
        label: 'Sidebar Collapsed by Default',
        description: 'Whether the sidebar should be collapsed on page load',
        group: 'UI & Branding',
        order: 8,
        valueType: 'boolean',
    },
    'OR3_TERMS_URL': {
        label: 'Terms of Service URL',
        description: 'URL to your terms of service page',
        group: 'UI & Branding',
        order: 9,
    },
    'OR3_PRIVACY_URL': {
        label: 'Privacy Policy URL',
        description: 'URL to your privacy policy page',
        group: 'UI & Branding',
        order: 10,
    },

    // Features
    'OR3_WORKFLOWS_ENABLED': {
        label: 'Enable Workflows',
        description: 'Enable workflow automation features',
        group: 'Features',
        order: 1,
        valueType: 'boolean',
    },
    'OR3_WORKFLOWS_EDITOR': {
        label: 'Enable Workflow Editor',
        description: 'Enable visual workflow editor interface',
        group: 'Features',
        order: 2,
        valueType: 'boolean',
    },
    'OR3_WORKFLOWS_SLASH_COMMANDS': {
        label: 'Enable Workflow Slash Commands',
        description: 'Allow workflows to be triggered via slash commands',
        group: 'Features',
        order: 3,
        valueType: 'boolean',
    },
    'OR3_WORKFLOWS_EXECUTION': {
        label: 'Enable Workflow Execution',
        description: 'Enable execution of configured workflows',
        group: 'Features',
        order: 4,
        valueType: 'boolean',
    },
    'OR3_DOCUMENTS_ENABLED': {
        label: 'Enable Documents',
        description: 'Enable document creation and management features',
        group: 'Features',
        order: 5,
        valueType: 'boolean',
    },
    'OR3_BACKUP_ENABLED': {
        label: 'Enable Backups',
        description: 'Enable workspace backup and restore functionality',
        group: 'Features',
        order: 6,
        valueType: 'boolean',
    },
    'OR3_MENTIONS_ENABLED': {
        label: 'Enable Mentions',
        description: 'Enable @mentions in conversations',
        group: 'Features',
        order: 7,
        valueType: 'boolean',
    },
    'OR3_MENTIONS_DOCUMENTS': {
        label: 'Enable Document Mentions',
        description: 'Allow mentioning documents in conversations',
        group: 'Features',
        order: 8,
        valueType: 'boolean',
    },
    'OR3_MENTIONS_CONVERSATIONS': {
        label: 'Enable Conversation Mentions',
        description: 'Allow mentioning other conversations',
        group: 'Features',
        order: 9,
        valueType: 'boolean',
    },
    'OR3_DASHBOARD_ENABLED': {
        label: 'Enable Dashboard',
        description: 'Enable analytics and dashboard features',
        group: 'Features',
        order: 10,
        valueType: 'boolean',
    },

    // Limits & Security
    'OR3_ALLOWED_ORIGINS': {
        label: 'Allowed Origins',
        description: 'Comma-separated list of allowed CORS origins',
        group: 'Limits & Security',
        order: 1,
    },
    'OR3_FORCE_HTTPS': {
        label: 'Force HTTPS',
        description: 'Redirect all HTTP requests to HTTPS',
        group: 'Limits & Security',
        order: 2,
        valueType: 'boolean',
    },
    'OR3_TRUST_PROXY': {
        label: 'Trust Proxy',
        description: 'Trust proxy forwarded headers for client IP and host resolution',
        group: 'Limits & Security',
        order: 2,
        valueType: 'boolean',
    },
    'OR3_FORWARDED_FOR_HEADER': {
        label: 'Forwarded For Header',
        description: 'Header to treat as the canonical client IP',
        group: 'Limits & Security',
        order: 2,
    },
    'OR3_STRICT_CONFIG': {
        label: 'Strict Config Validation',
        description: 'Enable strict cloud config validation in non-production environments',
        group: 'Limits & Security',
        order: 2,
        valueType: 'boolean',
    },
    'OR3_LIMITS_ENABLED': {
        label: 'Enable Rate Limiting',
        description: 'Enable rate limiting for API requests',
        group: 'Limits & Security',
        order: 3,
        valueType: 'boolean',
    },
    'OR3_REQUESTS_PER_MINUTE': {
        label: 'Requests Per Minute',
        description: 'Maximum API requests allowed per minute per user',
        group: 'Limits & Security',
        order: 4,
        valueType: 'number',
    },
    'OR3_MAX_MESSAGES_PER_DAY': {
        label: 'Max Messages Per Day',
        description: 'Maximum messages a user can send per day',
        group: 'Limits & Security',
        order: 5,
        valueType: 'number',
    },
    'OR3_MAX_CONVERSATIONS': {
        label: 'Max Conversations',
        description: 'Maximum number of conversations per user',
        group: 'Limits & Security',
        order: 6,
        valueType: 'number',
    },
    'OR3_LIMITS_STORAGE_PROVIDER': {
        label: 'Rate Limit Storage Provider',
        description: 'Backend for storing rate limit data (e.g., memory, redis)',
        group: 'Limits & Security',
        order: 7,
    },
    'OR3_RATE_LIMIT_OVERRIDES_JSON': {
        label: 'Rate Limit Overrides (JSON)',
        description: 'JSON map of per-operation rate limit overrides',
        group: 'Limits & Security',
        order: 8,
    },

    // Background Processing
    'OR3_BACKGROUND_STREAMING_ENABLED': {
        label: 'Enable Background Streaming',
        description: 'Enable background job processing for AI streaming',
        group: 'Background Processing',
        order: 1,
        valueType: 'boolean',
    },
    'OR3_BACKGROUND_STREAMING_PROVIDER': {
        label: 'Background Job Provider',
        description: 'Backend provider for background job processing',
        group: 'Background Processing',
        order: 2,
    },
    'OR3_BACKGROUND_MAX_JOBS': {
        label: 'Max Concurrent Jobs',
        description: 'Maximum number of background jobs running concurrently',
        group: 'Background Processing',
        order: 3,
        valueType: 'number',
    },
    'OR3_BACKGROUND_MAX_JOBS_PER_USER': {
        label: 'Max Concurrent Jobs Per User',
        description: 'Maximum concurrent background jobs allowed per user',
        group: 'Background Processing',
        order: 4,
        valueType: 'number',
    },
    'OR3_BACKGROUND_JOB_TIMEOUT': {
        label: 'Job Timeout (seconds)',
        description: 'Timeout for background jobs in seconds',
        group: 'Background Processing',
        order: 5,
        valueType: 'number',
    },

    // Admin
    'OR3_ADMIN_BASE_PATH': {
        label: 'Admin Base Path',
        description: 'Alias URL path for admin panel (redirects to /admin)',
        group: 'Admin',
        order: 1,
    },
    'OR3_ADMIN_ALLOWED_HOSTS': {
        label: 'Admin Allowed Hosts',
        description: 'Comma-separated list of hosts allowed to access admin panel',
        group: 'Admin',
        order: 2,
    },
    'OR3_ADMIN_ALLOW_RESTART': {
        label: 'Allow Server Restart',
        description: 'Enable the server restart button in admin panel (use with caution)',
        group: 'Admin',
        order: 3,
        valueType: 'boolean',
    },
    'OR3_ADMIN_ALLOW_REBUILD': {
        label: 'Allow Rebuild & Restart',
        description: 'Enable the rebuild & restart button in admin panel (use with caution)',
        group: 'Admin',
        order: 4,
        valueType: 'boolean',
    },
    'OR3_ADMIN_REBUILD_COMMAND': {
        label: 'Rebuild Command',
        description: 'Command to execute when rebuilding (e.g., "bun run build")',
        group: 'Admin',
        order: 5,
    },
    'OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES': {
        label: 'Max Extension Zip Size',
        description: 'Maximum size for uploaded extension ZIP files in bytes',
        group: 'Admin',
        order: 6,
        valueType: 'number',
    },
    'OR3_ADMIN_EXTENSION_MAX_FILES': {
        label: 'Max Files Per Extension',
        description: 'Maximum number of files allowed in an extension package',
        group: 'Admin',
        order: 7,
        valueType: 'number',
    },
    'OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES': {
        label: 'Max Total Extension Size',
        description: 'Maximum total size of all files in an extension package',
        group: 'Admin',
        order: 8,
        valueType: 'number',
    },
    'OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS': {
        label: 'Allowed File Extensions',
        description: 'Comma-separated list of allowed file extensions in plugins (e.g., .js,.ts,.vue)',
        group: 'Admin',
        order: 9,
    },

    // External Services
    'OPENROUTER_API_KEY': {
        label: 'OpenRouter API Key',
        description: 'API key for OpenRouter AI model access',
        group: 'External Services',
        order: 1,
    },
    'OR3_OPENROUTER_BASE_URL': {
        label: 'OpenRouter Base URL',
        description: 'Base URL for OpenRouter-compatible API requests',
        group: 'External Services',
        order: 2,
    },
    'OR3_OPENROUTER_ALLOW_USER_OVERRIDE': {
        label: 'Allow User API Key Override',
        description: 'Allow users to provide their own OpenRouter API keys',
        group: 'External Services',
        order: 3,
        valueType: 'boolean',
    },
    'OR3_OPENROUTER_REQUIRE_USER_KEY': {
        label: 'Require User API Key',
        description: 'Require users to provide their own OpenRouter API keys (ignore instance key)',
        group: 'External Services',
        order: 4,
        valueType: 'boolean',
    },
};

/**
 * Retrieves metadata for a specific configuration key.
 *
 * Purpose:
 * Allows the configuration manager to pull schema information during enrichment.
 *
 * @param key - The environment variable key (e.g., 'SSR_AUTH_ENABLED')
 */
export function getConfigMetadata(key: string): ConfigMetadata | undefined {
    return CONFIG_METADATA[key];
}

/**
 * Returns the list of all available configuration groups.
 *
 * @returns A readonly array of group names used for UI layout
 */
export function getConfigGroups(): readonly ConfigGroup[] {
    return CONFIG_GROUPS;
}

/**
 * A configuration entry augmented with its schema metadata.
 *
 * Purpose:
 * This is the primary data structure sent to the Admin Dashboard. It combines
 * raw environment values with human-friendly display information.
 *
 * Constraints:
 * - Key names must match the whitelist in config-manager.ts.
 * - Value may be masked (e.g., '******') before reaching this structure.
 */
export type EnrichedConfigEntry = {
    /** The environment variable key name */
    key: string;
    /** The current value (masked if it's a secret) */
    value: string | null;
    /** Whether the value is currently masked (e.g., '******') */
    masked: boolean;
    /** Human-readable label from CONFIG_METADATA */
    label: string;
    /** Detailed description from CONFIG_METADATA */
    description: string;
    /** UI group category for navigation */
    group: ConfigGroup;
    /** Display order within the group */
    order: number;
    /** Value type for UI input rendering (e.g., checkboxes for booleans) */
    valueType: 'string' | 'boolean' | 'number';
};
