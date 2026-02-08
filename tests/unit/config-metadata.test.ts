import { describe, it, expect } from 'vitest';
import { getConfigMetadata } from '../../server/admin/config/config-metadata';

// Import WHITELIST - we need to make it exportable or duplicate it here
// For now, let's duplicate the list to test
const WHITELIST_KEYS = [
    'SSR_AUTH_ENABLED',
    'AUTH_PROVIDER',
    'OR3_AUTH_PROVIDER',
    'OR3_GUEST_ACCESS_ENABLED',
    'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET',
    'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
    'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS',
    'OR3_BASIC_AUTH_DB_PATH',
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
    'OR3_SYNC_ENABLED',
    'OR3_CLOUD_SYNC_ENABLED',
    'OR3_SYNC_PROVIDER',
    'VITE_CONVEX_URL',
    'CONVEX_SELF_HOSTED_ADMIN_KEY',
    'OR3_SQLITE_DB_PATH',
    'OR3_SQLITE_PRAGMA_JOURNAL_MODE',
    'OR3_SQLITE_PRAGMA_SYNCHRONOUS',
    'OR3_SQLITE_ALLOW_IN_MEMORY',
    'OR3_SQLITE_STRICT',
    'OR3_STORAGE_ENABLED',
    'OR3_CLOUD_STORAGE_ENABLED',
    'NUXT_PUBLIC_STORAGE_PROVIDER',
    'OR3_STORAGE_FS_ROOT',
    'OR3_STORAGE_FS_TOKEN_SECRET',
    'OR3_STORAGE_FS_URL_TTL_SECONDS',
    'OR3_ALLOWED_ORIGINS',
    'OR3_FORCE_HTTPS',
    'OR3_TRUST_PROXY',
    'OR3_FORWARDED_FOR_HEADER',
    'OR3_STRICT_CONFIG',
    'OR3_LIMITS_ENABLED',
    'OR3_REQUESTS_PER_MINUTE',
    'OR3_MAX_MESSAGES_PER_DAY',
    'OR3_MAX_CONVERSATIONS',
    'OR3_LIMITS_STORAGE_PROVIDER',
    'OR3_BACKGROUND_STREAMING_ENABLED',
    'OR3_BACKGROUND_STREAMING_PROVIDER',
    'OR3_BACKGROUND_MAX_JOBS',
    'OR3_BACKGROUND_JOB_TIMEOUT',
    'OR3_ADMIN_BASE_PATH',
    'OR3_ADMIN_ALLOWED_HOSTS',
    'OR3_ADMIN_ALLOW_RESTART',
    'OR3_ADMIN_ALLOW_REBUILD',
    'OR3_ADMIN_REBUILD_COMMAND',
    'OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES',
    'OR3_ADMIN_EXTENSION_MAX_FILES',
    'OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES',
    'OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS',
    'OPENROUTER_API_KEY',
    'OR3_OPENROUTER_ALLOW_USER_OVERRIDE',
    'OR3_OPENROUTER_REQUIRE_USER_KEY',
    'OR3_SITE_NAME',
    'OR3_SITE_DESCRIPTION',
    'OR3_LOGO_URL',
    'OR3_FAVICON_URL',
    'OR3_DEFAULT_THEME',
    'OR3_WORKFLOWS_ENABLED',
    'OR3_WORKFLOWS_EDITOR',
    'OR3_WORKFLOWS_SLASH_COMMANDS',
    'OR3_WORKFLOWS_EXECUTION',
    'OR3_DOCUMENTS_ENABLED',
    'OR3_BACKUP_ENABLED',
    'OR3_MENTIONS_ENABLED',
    'OR3_MENTIONS_DOCUMENTS',
    'OR3_MENTIONS_CONVERSATIONS',
    'OR3_DASHBOARD_ENABLED',
    'OR3_MAX_FILE_SIZE_BYTES',
    'OR3_MAX_CLOUD_FILE_SIZE_BYTES',
    'OR3_MAX_FILES_PER_MESSAGE',
    'OR3_LOCAL_STORAGE_QUOTA_MB',
    'OR3_DEFAULT_PANE_COUNT',
    'OR3_MAX_PANES',
    'OR3_SIDEBAR_COLLAPSED',
    'OR3_TERMS_URL',
    'OR3_PRIVACY_URL',
    'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'NUXT_CLERK_SECRET_KEY',
];

describe('config metadata', () => {
    it('all whitelisted keys have metadata', () => {
        const missingMetadata: string[] = [];
        
        for (const key of WHITELIST_KEYS) {
            const metadata = getConfigMetadata(key);
            if (!metadata) {
                missingMetadata.push(key);
            }
        }
        
        if (missingMetadata.length > 0) {
            throw new Error(
                `The following whitelisted keys are missing metadata:\n${missingMetadata.join('\n')}`
            );
        }
        
        expect(missingMetadata).toHaveLength(0);
    });
    
    it('all metadata entries have required fields', () => {
        const invalidEntries: string[] = [];
        
        for (const key of WHITELIST_KEYS) {
            const metadata = getConfigMetadata(key);
            if (metadata) {
                if (!metadata.label || metadata.label.trim() === '') {
                    invalidEntries.push(`${key}: missing label`);
                }
                if (!metadata.description || metadata.description.trim() === '') {
                    invalidEntries.push(`${key}: missing description`);
                }
                if (!metadata.group) {
                    invalidEntries.push(`${key}: missing group`);
                }
            }
        }
        
        if (invalidEntries.length > 0) {
            throw new Error(
                `The following metadata entries are invalid:\n${invalidEntries.join('\n')}`
            );
        }
        
        expect(invalidEntries).toHaveLength(0);
    });
});
