/**
 * Environment-variable contracts shared by runtime configuration and the
 * source wizard. Aliases intentionally remain supported for existing
 * deployments; this module owns their precedence and serialization.
 */
export type EnvMap = Record<string, string | undefined>;

export const ENV_ALIASES = {
    authProvider: ['OR3_AUTH_PROVIDER', 'AUTH_PROVIDER'],
    syncEnabled: ['OR3_CLOUD_SYNC_ENABLED', 'OR3_SYNC_ENABLED'],
    storageEnabled: ['OR3_CLOUD_STORAGE_ENABLED', 'OR3_STORAGE_ENABLED'],
} as const;

/** Keys the source wizard may modify during a non-destructive .env merge. */
const wizardOwnedEnvKeys = [
    'SSR_AUTH_ENABLED', 'AUTH_PROVIDER', 'OR3_AUTH_PROVIDER',
    'OR3_GUEST_ACCESS_ENABLED', 'OR3_AUTH_LOCK_PAGE_ENABLED',
    'OR3_AUTH_LOCK_PAGE_ADAPTER', 'OR3_SYNC_ENABLED',
    'OR3_CLOUD_SYNC_ENABLED', 'OR3_SYNC_PROVIDER', 'VITE_CONVEX_URL',
    'OR3_CONVEX_ALLOW_INSECURE_HTTP', 'CONVEX_SELF_HOSTED_URL',
    'CONVEX_SELF_HOSTED_ADMIN_KEY', 'VITE_CONVEX_SITE_URL',
    'OR3_STORAGE_ENABLED', 'OR3_CLOUD_STORAGE_ENABLED',
    'NUXT_PUBLIC_STORAGE_PROVIDER', 'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET', 'OR3_AUTH_INVITE_TOKEN_SECRET',
    'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
    'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS', 'OR3_BASIC_AUTH_DB_PATH',
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL', 'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
    'OR3_AUTH_REGISTRATION_MODE', 'OR3_AUTH_AUTO_PROVISION',
    'OR3_PLUGIN_ZIP_INSTALL_ENABLED', 'OR3_ADMIN_ALLOW_REBUILD',
    'OR3_SQLITE_DB_PATH', 'OR3_SQLITE_DRIVER',
    'OR3_SQLITE_PRAGMA_JOURNAL_MODE', 'OR3_SQLITE_PRAGMA_SYNCHRONOUS',
    'OR3_SQLITE_ALLOW_IN_MEMORY', 'OR3_SQLITE_STRICT',
    'OR3_SQLITE_TURSO_URL', 'OR3_SQLITE_TURSO_AUTH_TOKEN',
    'OR3_SQLITE_D1_BINDING', 'OR3_CONNECT_ENABLED',
    'OR3_CONNECT_PROVIDER', 'OR3_CONNECT_RELAY_PROVIDER',
    'OR3_CONNECT_PUBLIC_URL', 'OR3_CONNECT_ENCRYPTION_KEY',
    'OR3_CONNECT_MAX_COMPUTERS', 'OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID',
    'OR3_CONNECT_CLOUDFLARE_ZONE_ID', 'OR3_CONNECT_CLOUDFLARE_API_TOKEN',
    'OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION',
    'OR3_CONNECT_HOSTNAME_SUFFIX', 'OR3_STORAGE_FS_ROOT',
    'OR3_STORAGE_FS_TOKEN_SECRET', 'OR3_STORAGE_FS_URL_TTL_SECONDS',
    'OR3_STORAGE_S3_ENDPOINT', 'OR3_STORAGE_S3_REGION',
    'OR3_STORAGE_S3_BUCKET', 'OR3_STORAGE_S3_ACCESS_KEY_ID',
    'OR3_STORAGE_S3_SECRET_ACCESS_KEY', 'OR3_STORAGE_S3_SESSION_TOKEN',
    'OR3_STORAGE_S3_FORCE_PATH_STYLE', 'OR3_STORAGE_S3_KEY_PREFIX',
    'OR3_STORAGE_S3_URL_TTL_SECONDS', 'OR3_STORAGE_S3_REQUIRE_CHECKSUM',
    'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NUXT_CLERK_SECRET_KEY',
    'OPENROUTER_API_KEY', 'OR3_OPENROUTER_ALLOW_USER_OVERRIDE',
    'OR3_OPENROUTER_REQUIRE_USER_KEY', 'OR3_SITE_NAME',
    'OR3_DEFAULT_THEME', 'OR3_LOGO_URL', 'OR3_FAVICON_URL',
    'OR3_WORKFLOWS_ENABLED', 'OR3_DOCUMENTS_ENABLED', 'OR3_BACKUP_ENABLED',
    'OR3_MENTIONS_ENABLED', 'OR3_DASHBOARD_ENABLED', 'OR3_LIMITS_ENABLED',
    'OR3_REQUESTS_PER_MINUTE', 'OR3_MAX_CONVERSATIONS',
    'OR3_MAX_MESSAGES_PER_DAY', 'OR3_LIMITS_STORAGE_PROVIDER',
    'OR3_PUBLIC_DOMAIN', 'OR3_ALLOWED_ORIGINS', 'OR3_FORCE_HTTPS',
    'OR3_STRICT_CONFIG', 'OR3_TRUST_PROXY', 'OR3_FORWARDED_FOR_HEADER',
    'OR3_ADMIN_USERNAME', 'OR3_ADMIN_PASSWORD',
] as const;

/** Explicit security boundary for keys editable through the admin API. */
const adminWritableEnvKeys = [
    'SSR_AUTH_ENABLED', 'AUTH_PROVIDER', 'OR3_AUTH_PROVIDER',
    'OR3_GUEST_ACCESS_ENABLED', 'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET', 'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
    'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS', 'OR3_BASIC_AUTH_DB_PATH',
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL', 'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
    'OR3_SYNC_ENABLED', 'OR3_CLOUD_SYNC_ENABLED', 'OR3_SYNC_PROVIDER',
    'VITE_CONVEX_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'OR3_SQLITE_DRIVER',
    'OR3_SQLITE_DB_PATH', 'OR3_SQLITE_PRAGMA_JOURNAL_MODE',
    'OR3_SQLITE_PRAGMA_SYNCHRONOUS', 'OR3_SQLITE_ALLOW_IN_MEMORY',
    'OR3_SQLITE_STRICT', 'OR3_SQLITE_TURSO_URL',
    'OR3_SQLITE_TURSO_AUTH_TOKEN', 'OR3_SQLITE_D1_BINDING',
    'OR3_STORAGE_ENABLED', 'OR3_CLOUD_STORAGE_ENABLED',
    'NUXT_PUBLIC_STORAGE_PROVIDER', 'OR3_STORAGE_ALLOWED_MIME_TYPES',
    'OR3_STORAGE_WORKSPACE_QUOTA_BYTES', 'OR3_STORAGE_GC_RETENTION_SECONDS',
    'OR3_STORAGE_GC_COOLDOWN_MS', 'OR3_STORAGE_FS_ROOT',
    'OR3_STORAGE_FS_TOKEN_SECRET', 'OR3_STORAGE_FS_URL_TTL_SECONDS',
    'OR3_ALLOWED_ORIGINS', 'OR3_FORCE_HTTPS', 'OR3_TRUST_PROXY',
    'OR3_FORWARDED_FOR_HEADER', 'OR3_STRICT_CONFIG', 'OR3_LIMITS_ENABLED',
    'OR3_REQUESTS_PER_MINUTE', 'OR3_MAX_MESSAGES_PER_DAY',
    'OR3_MAX_CONVERSATIONS', 'OR3_LIMITS_STORAGE_PROVIDER',
    'OR3_RATE_LIMIT_OVERRIDES_JSON', 'OR3_BACKGROUND_STREAMING_ENABLED',
    'OR3_BACKGROUND_STREAMING_PROVIDER', 'OR3_BACKGROUND_MAX_JOBS',
    'OR3_BACKGROUND_MAX_JOBS_PER_USER', 'OR3_BACKGROUND_JOB_TIMEOUT',
    'OR3_BACKGROUND_ENCRYPTION_KEY',
    'OR3_ADMIN_BASE_PATH', 'OR3_ADMIN_ALLOWED_HOSTS',
    'OR3_ADMIN_ALLOW_RESTART', 'OR3_ADMIN_ALLOW_REBUILD',
    'OR3_ADMIN_REBUILD_COMMAND', 'OR3_DISABLE_NON_CORE_PLUGINS',
    'OR3_PLUGIN_RUNTIME_SHADOW_ENABLED', 'OR3_ADMIN_EXTENSION_MAX_ZIP_BYTES',
    'OR3_ADMIN_EXTENSION_MAX_FILES', 'OR3_ADMIN_EXTENSION_MAX_TOTAL_BYTES',
    'OR3_ADMIN_EXTENSION_ALLOWED_EXTENSIONS', 'OPENROUTER_API_KEY',
    'OR3_OPENROUTER_BASE_URL', 'OR3_OPENROUTER_ALLOW_USER_OVERRIDE',
    'OR3_OPENROUTER_REQUIRE_USER_KEY', 'OR3_SITE_NAME',
    'OR3_SITE_DESCRIPTION', 'OR3_LOGO_URL', 'OR3_FAVICON_URL',
    'OR3_DEFAULT_THEME', 'OR3_DISABLED_THEMES', 'OR3_WORKFLOWS_ENABLED',
    'OR3_WORKFLOWS_EDITOR', 'OR3_WORKFLOWS_SLASH_COMMANDS',
    'OR3_WORKFLOWS_EXECUTION', 'OR3_DOCUMENTS_ENABLED', 'OR3_BACKUP_ENABLED',
    'OR3_MENTIONS_ENABLED', 'OR3_MENTIONS_DOCUMENTS',
    'OR3_MENTIONS_CONVERSATIONS', 'OR3_DASHBOARD_ENABLED',
    'OR3_MAX_FILE_SIZE_BYTES', 'OR3_MAX_CLOUD_FILE_SIZE_BYTES',
    'OR3_MAX_FILES_PER_MESSAGE', 'OR3_LOCAL_STORAGE_QUOTA_MB',
    'OR3_DEFAULT_PANE_COUNT', 'OR3_MAX_PANES', 'OR3_SIDEBAR_COLLAPSED',
    'OR3_TERMS_URL', 'OR3_PRIVACY_URL', 'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'NUXT_CLERK_SECRET_KEY',
] as const;

export type EnvKeyContract = {
    adminWritable: boolean;
    wizardOwned: boolean;
    secret: boolean;
};

const adminWritableSet = new Set<string>(adminWritableEnvKeys);
const wizardOwnedSet = new Set<string>(wizardOwnedEnvKeys);

/** One access contract; callers derive their allowlists from these flags. */
export const ENV_KEY_CONTRACT: Readonly<Record<string, EnvKeyContract>> =
    Object.freeze(
        Object.fromEntries(
            [...new Set([...adminWritableEnvKeys, ...wizardOwnedEnvKeys])].map(
                (key) => [
                    key,
                    {
                        adminWritable: adminWritableSet.has(key),
                        wizardOwned: wizardOwnedSet.has(key),
                        secret: /(SECRET|KEY|TOKEN|PASSWORD|ATTESTATION)/i.test(key),
                    },
                ],
            ),
        ),
    );

export const ADMIN_WRITABLE_ENV_KEYS = Object.keys(ENV_KEY_CONTRACT).filter(
    (key) => ENV_KEY_CONTRACT[key]!.adminWritable,
);

export const WIZARD_OWNED_ENV_KEYS = Object.keys(ENV_KEY_CONTRACT).filter(
    (key) => ENV_KEY_CONTRACT[key]!.wizardOwned,
);

export type EnvAliasName = keyof typeof ENV_ALIASES;

export function readEnvAlias(
    env: EnvMap,
    alias: EnvAliasName,
): string | undefined {
    for (const key of ENV_ALIASES[alias]) {
        const value = env[key];
        if (value !== undefined) return value;
    }
    return undefined;
}

export function writeEnvAlias(
    env: Record<string, string>,
    alias: EnvAliasName,
    value: string | undefined,
): void {
    if (value === undefined || value === '') return;
    for (const key of ENV_ALIASES[alias]) {
        env[key] = value;
    }
}

export function parseEnvBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

export function readEnvBoolean(
    value: string | undefined,
    fallback: boolean,
): boolean {
    return parseEnvBoolean(value) ?? fallback;
}

/** Feature switches remain enabled unless the exact compatibility value is false. */
export function readEnvFeature(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    return value !== 'false';
}

export function resolveStrictMode(input: {
    env?: EnvMap;
    explicit?: boolean;
    deploymentTarget?: string;
    nodeEnv?: string | undefined;
    strictEnv?: string | undefined;
}): boolean {
    if (input.explicit !== undefined) return input.explicit;
    if (input.strictEnv === 'true') return true;
    if (input.env?.OR3_STRICT_CONFIG === 'true') return true;
    if ((input.nodeEnv ?? input.env?.NODE_ENV) === 'production') return true;
    return (
        input.deploymentTarget === 'prod-build' ||
        input.deploymentTarget === 'docker'
    );
}
