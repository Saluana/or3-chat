/**
 * Metadata for configuration entries
 * Maps environment variable keys to human-readable names, descriptions, and grouping
 */

export type ConfigMetadata = {
    label: string;
    description: string;
    group: ConfigGroup;
    order?: number;
    valueType?: 'string' | 'boolean' | 'number';
};

export type ConfigGroup = 
    | 'Auth'
    | 'Sync'
    | 'Storage'
    | 'UI & Branding'
    | 'Features'
    | 'Limits & Security'
    | 'Admin'
    | 'Background Processing'
    | 'External Services';

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

    // Sync
    'OR3_SYNC_ENABLED': {
        label: 'Enable Sync',
        description: 'Enable real-time data synchronization across devices',
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

    // Storage
    'OR3_STORAGE_ENABLED': {
        label: 'Enable Cloud Storage',
        description: 'Enable cloud storage for file uploads and attachments',
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
    'OR3_MAX_FILE_SIZE_BYTES': {
        label: 'Max Local File Size',
        description: 'Maximum file size for local uploads in bytes (e.g., 10485760 for 10MB)',
        group: 'Storage',
        order: 3,
        valueType: 'number',
    },
    'OR3_MAX_CLOUD_FILE_SIZE_BYTES': {
        label: 'Max Cloud File Size',
        description: 'Maximum file size for cloud uploads in bytes',
        group: 'Storage',
        order: 4,
        valueType: 'number',
    },
    'OR3_MAX_FILES_PER_MESSAGE': {
        label: 'Max Files Per Message',
        description: 'Maximum number of files that can be attached to a single message',
        group: 'Storage',
        order: 5,
        valueType: 'number',
    },
    'OR3_LOCAL_STORAGE_QUOTA_MB': {
        label: 'Local Storage Quota (MB)',
        description: 'Maximum local storage quota in megabytes for browser storage',
        group: 'Storage',
        order: 6,
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
    'OR3_BACKGROUND_JOB_TIMEOUT': {
        label: 'Job Timeout (seconds)',
        description: 'Timeout for background jobs in seconds',
        group: 'Background Processing',
        order: 4,
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
    'OR3_OPENROUTER_ALLOW_USER_OVERRIDE': {
        label: 'Allow User API Key Override',
        description: 'Allow users to provide their own OpenRouter API keys',
        group: 'External Services',
        order: 2,
        valueType: 'boolean',
    },
};

export function getConfigMetadata(key: string): ConfigMetadata | undefined {
    return CONFIG_METADATA[key];
}

export function getConfigGroups(): ConfigGroup[] {
    return [
        'Auth',
        'Sync',
        'Storage',
        'UI & Branding',
        'Features',
        'Limits & Security',
        'Background Processing',
        'Admin',
        'External Services',
    ];
}

export type EnrichedConfigEntry = {
    key: string;
    value: string | null;
    masked: boolean;
    label: string;
    description: string;
    group: ConfigGroup;
    order: number;
    valueType: 'string' | 'boolean' | 'number';
};
