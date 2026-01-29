import { readEnvFile, writeEnvFile } from './env-file';
import {
    buildOr3CloudConfigFromEnv,
    buildOr3ConfigFromEnv,
} from './resolve-config';
import {
    getConfigMetadata,
    type EnrichedConfigEntry,
} from './config-metadata';

const WHITELIST = [
    'SSR_AUTH_ENABLED',
    'AUTH_PROVIDER',
    'OR3_SYNC_ENABLED',
    'OR3_SYNC_PROVIDER',
    'VITE_CONVEX_URL',
    'OR3_STORAGE_ENABLED',
    'NUXT_PUBLIC_STORAGE_PROVIDER',
    'OR3_ALLOWED_ORIGINS',
    'OR3_FORCE_HTTPS',
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

const SECRET_PATTERN = /(SECRET|KEY|TOKEN|PASSWORD)/i;

export type ConfigEntry = {
    key: string;
    value: string | null;
    masked: boolean;
};

export async function readConfigEntries(): Promise<ConfigEntry[]> {
    const { map } = await readEnvFile();
    return WHITELIST.map((key) => {
        const value = map[key] ?? null;
        const masked = value !== null && SECRET_PATTERN.test(key);
        return { key, value: masked ? '******' : value, masked };
    });
}

const DEFAULT_CONFIG_GROUP = 'External Services' as const;
const DEFAULT_CONFIG_ORDER = 999;

export async function readEnrichedConfigEntries(): Promise<EnrichedConfigEntry[]> {
    const { map } = await readEnvFile();
    return WHITELIST.map((key) => {
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

export async function writeConfigEntries(
    updates: Array<{ key: string; value: string | null }>
): Promise<void> {
    const { map } = await readEnvFile();

    const updateMap: Record<string, string | null> = {};
    for (const update of updates) {
        if (!WHITELIST.includes(update.key)) {
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
