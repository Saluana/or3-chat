/**
 * @module server/admin/config/config-manager.ts
 *
 * Purpose:
 * Orchestrates high-level configuration management by integrating low-level
 * environment variable persistence with human-readable schema metadata.
 *
 * Responsibilities:
 * - Gating configuration access via a strict WHITELIST.
 * - Protecting sensitive data via automatic mask patterns (SECRET_PATTERN).
 * - Providing enriched data structures for the Admin Dashboard Settings UI.
 * - Coordinating updates across persistence (`env-file.ts`) and validation (`resolve-config.ts`).
 *
 * Architecture:
 * This is the primary entry point for the Admin API. It ensures that changes
 * made by administrators are validated against the current system's capabilities
 * before being committed to the `.env` file.
 *
 * Non-goals:
 * - Does not handle direct file system operations (delegated to env-file.ts).
 * - Does not manage runtime process environment (handled by process manager/host).
 */
import { readEnvFile, writeEnvFile } from './env-file';
import {
    buildOr3CloudConfigFromEnv,
    buildOr3ConfigFromEnv,
} from './resolve-config';
import {
    getConfigMetadata,
    type EnrichedConfigEntry,
} from './config-metadata';

/**
 * Set of configuration keys that are permitted to be read/written by the admin API.
 *
 * Purpose:
 * Provides a security boundary by ensuring that internal-only or highly sensitive
 * server settings are never accidentally exposed or modified via the UI.
 */
const WHITELIST = new Set([
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
    'OR3_STORAGE_ALLOWED_MIME_TYPES',
    'OR3_STORAGE_WORKSPACE_QUOTA_BYTES',
    'OR3_STORAGE_GC_RETENTION_SECONDS',
    'OR3_STORAGE_GC_COOLDOWN_MS',
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
    'OR3_RATE_LIMIT_OVERRIDES_JSON',
    'OR3_BACKGROUND_STREAMING_ENABLED',
    'OR3_BACKGROUND_STREAMING_PROVIDER',
    'OR3_BACKGROUND_MAX_JOBS',
    'OR3_BACKGROUND_MAX_JOBS_PER_USER',
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
    'OR3_OPENROUTER_BASE_URL',
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
]);

/**
 * Regex pattern used to identify sensitive configuration keys that should be masked.
 *
 * Behavior:
 * Keys containing 'SECRET', 'KEY', 'TOKEN', or 'PASSWORD' are automatically replaced
 * with a placeholder ('******') when read, preventing their exposure in API logs
 * or non-secure UI fields.
 */
const SECRET_PATTERN = /(SECRET|KEY|TOKEN|PASSWORD)/i;

/**
 * A basic configuration entry.
 */
export type ConfigEntry = {
    /** The configuration key (e.g., 'SSR_AUTH_ENABLED') */
    key: string;
    /** The configuration value (masked if secret) */
    value: string | null;
    /** Whether the value has been masked for security */
    masked: boolean;
};

/**
 * Reads all whitelisted configuration entries from the .env file.
 *
 * Behavior:
 * 1. Fetches current variables from `readEnvFile()`.
 * 2. Filters entries using the `WHITELIST`.
 * 3. Applies masking to keys matching `SECRET_PATTERN`.
 */
export async function readConfigEntries(): Promise<ConfigEntry[]> {
    const { map } = await readEnvFile();
    return Array.from(WHITELIST).map((key) => {
        const value = map[key] ?? null;
        const masked = value !== null && SECRET_PATTERN.test(key);
        return { key, value: masked ? '******' : value, masked };
    });
}

const DEFAULT_CONFIG_GROUP = 'External Services' as const;
const DEFAULT_CONFIG_ORDER = 999;

/**
 * Reads all whitelisted configuration entries and augments them with metadata.
 *
 * Purpose:
 * Provides the data for the Settings page in the Admin Dashboard.
 *
 * Behavior:
 * Iterates through the WHITELIST and joins each entry with its corresponding
 * schema information from `config-metadata.ts`.
 */
export async function readEnrichedConfigEntries(): Promise<EnrichedConfigEntry[]> {
    const { map } = await readEnvFile();
    return Array.from(WHITELIST).map((key) => {
        const value = map[key] ?? null;
        const masked = value !== null && SECRET_PATTERN.test(key);
        const metadata = getConfigMetadata(key);
        return {
            key,
            value: masked ? '******' : value,
            masked,
            label: metadata?.label ?? key,
            description: metadata?.description ?? '',
            group: metadata?.group ?? DEFAULT_CONFIG_GROUP,
            order: metadata?.order ?? DEFAULT_CONFIG_ORDER,
            valueType: metadata?.valueType ?? 'string',
        };
    });
}

/**
 * Updates multiple configuration entries simultaneously.
 *
 * Behavior:
 * 1. Validates every key against the WHITELIST.
 * 2. Skips updates where the value is the masking placeholder ('******').
 * 3. Interprets empty strings as a request to unset (delete) the key.
 * 4. Runs a "dry-build" of the refined configuration objects to ensure validity.
 * 5. Commits changes to the `.env` file via `writeEnvFile()`.
 *
 * @param updates - An array of key-value pairs to update.
 * @throws Error if any key is not in the whitelist.
 */
export async function writeConfigEntries(
    updates: Array<{ key: string; value: string | null }>
): Promise<void> {
    const { map } = await readEnvFile();

    const updateMap: Record<string, string | null> = {};
    for (const update of updates) {
        if (!WHITELIST.has(update.key)) {
            throw new Error(`Key not allowed: ${update.key}`);
        }
        if (update.value === '******') {
            continue;
        }
        if (update.value === '') {
            updateMap[update.key] = null;
            continue;
        }
        updateMap[update.key] = update.value;
    }

    const nextEnv: Record<string, string | undefined> = { ...map };
    for (const [key, value] of Object.entries(updateMap)) {
        if (value === null) {
            delete nextEnv[key];
        } else {
            nextEnv[key] = value;
        }
    }

    buildOr3ConfigFromEnv(nextEnv);
    buildOr3CloudConfigFromEnv(nextEnv);

    await writeEnvFile(updateMap);
}
