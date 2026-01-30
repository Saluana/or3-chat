import { defineOr3Config } from './utils/or3-config';

/**
 * Application version
 * Update this when releasing a new version, or use process.env.npm_package_version
 */
export const APP_VERSION = '0.1.0';

/**
 * OR3 Base Configuration
 *
 * This file configures site branding, feature toggles, and client-side limits.
 * All settings have sensible defaults - only override what you need.
 *
 * Environment Variables Reference:
 * - Branding:
 *   OR3_SITE_NAME          - Display name (default: "OR3")
 *   OR3_SITE_DESCRIPTION   - Meta description
 *   OR3_LOGO_URL           - Custom logo URL (default: /logos/logo-svg.svg)
 *   OR3_FAVICON_URL        - Custom favicon URL
 *   OR3_DEFAULT_THEME      - Default theme (default: "blank")
 *
 * - Feature Toggles (set to 'false' to disable):
 *   OR3_WORKFLOWS_ENABLED          - Master toggle for workflows
 *   OR3_WORKFLOWS_EDITOR           - Enable workflow editor UI
 *   OR3_WORKFLOWS_SLASH_COMMANDS   - Enable /workflow commands
 *   OR3_WORKFLOWS_EXECUTION        - Enable workflow execution
 *   OR3_DOCUMENTS_ENABLED          - Enable document editor
 *   OR3_BACKUP_ENABLED             - Enable backup dashboard
 *   OR3_MENTIONS_ENABLED           - Enable @mentions
 *   OR3_MENTIONS_DOCUMENTS         - Enable document mentions
 *   OR3_MENTIONS_CONVERSATIONS     - Enable chat mentions
 *   OR3_DASHBOARD_ENABLED          - Enable dashboard
 *
 * - Limits:
 *   OR3_MAX_FILE_SIZE_BYTES        - Max upload size in bytes (default: 20MB)
 *   OR3_MAX_CLOUD_FILE_SIZE_BYTES  - Max cloud upload size (default: 100MB)
 *   OR3_MAX_FILES_PER_MESSAGE      - Max attachments per message (default: 10)
 *   OR3_LOCAL_STORAGE_QUOTA_MB     - Local storage warning threshold
 *
 * - UI:
 *   OR3_DEFAULT_PANE_COUNT         - Default panes for new users (default: 1)
 *   OR3_MAX_PANES                  - Max panes allowed (default: 4)
 *   OR3_SIDEBAR_COLLAPSED          - Sidebar collapsed by default (default: false)
 *
 * For cloud features (auth, sync, storage), see config.or3cloud.ts
 */
export const or3Config = defineOr3Config({
    /**
     * Site branding and identity.
     */
    site: {
        name: process.env.OR3_SITE_NAME || 'OR3',
        description: process.env.OR3_SITE_DESCRIPTION || '',
        logoUrl: process.env.OR3_LOGO_URL || '',
        faviconUrl: process.env.OR3_FAVICON_URL || '',
        defaultTheme: process.env.OR3_DEFAULT_THEME || 'blank',
    },

    /**
     * Feature toggles.
     * All features are enabled by default.
     * Set to false to disable specific capabilities.
     */
    features: {
        // Workflow automation
        workflows: {
            enabled: process.env.OR3_WORKFLOWS_ENABLED !== 'false',
            editor: process.env.OR3_WORKFLOWS_EDITOR !== 'false',
            slashCommands: process.env.OR3_WORKFLOWS_SLASH_COMMANDS !== 'false',
            execution: process.env.OR3_WORKFLOWS_EXECUTION !== 'false',
        },
        // Document editor
        documents: {
            enabled: process.env.OR3_DOCUMENTS_ENABLED !== 'false',
        },
        // Workspace backup
        backup: {
            enabled: process.env.OR3_BACKUP_ENABLED !== 'false',
        },
        // @mentions system
        mentions: {
            enabled: process.env.OR3_MENTIONS_ENABLED !== 'false',
            documents: process.env.OR3_MENTIONS_DOCUMENTS !== 'false',
            conversations: process.env.OR3_MENTIONS_CONVERSATIONS !== 'false',
        },
        // Dashboard settings panel
        dashboard: {
            enabled: process.env.OR3_DASHBOARD_ENABLED !== 'false',
        },
    },

    /**
     * Upload and storage limits.
     */
    limits: {
        maxFileSizeBytes: process.env.OR3_MAX_FILE_SIZE_BYTES
            ? Number(process.env.OR3_MAX_FILE_SIZE_BYTES)
            : undefined,
        maxCloudFileSizeBytes: process.env.OR3_MAX_CLOUD_FILE_SIZE_BYTES
            ? Number(process.env.OR3_MAX_CLOUD_FILE_SIZE_BYTES)
            : undefined,
        maxFilesPerMessage: process.env.OR3_MAX_FILES_PER_MESSAGE
            ? Number(process.env.OR3_MAX_FILES_PER_MESSAGE)
            : undefined,
        localStorageQuotaMB: process.env.OR3_LOCAL_STORAGE_QUOTA_MB
            ? Number(process.env.OR3_LOCAL_STORAGE_QUOTA_MB)
            : undefined,
    },

    /**
     * UI experience defaults.
     */
    ui: {
        defaultPaneCount: process.env.OR3_DEFAULT_PANE_COUNT
            ? Number(process.env.OR3_DEFAULT_PANE_COUNT)
            : undefined,
        maxPanes: process.env.OR3_MAX_PANES ? Number(process.env.OR3_MAX_PANES) : undefined,
        sidebarCollapsedByDefault: process.env.OR3_SIDEBAR_COLLAPSED === 'true',
    },

    /**
     * Legal URLs for compliance and footer links.
     */
    legal: {
        termsUrl: process.env.OR3_TERMS_URL || '',
        privacyUrl: process.env.OR3_PRIVACY_URL || '',
    },
});
