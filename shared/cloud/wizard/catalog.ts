/**
 * @module shared/cloud/wizard/catalog
 *
 * Purpose:
 * Defines the provider catalog, built-in presets, secret key lists,
 * wizard-owned env keys, and default answer factory. This is the
 * single source of provider metadata for the wizard engine.
 *
 * Responsibilities:
 * - Provider descriptors with fields, dependencies, and implementation status
 * - Built-in presets (`recommended` = Basic Auth + SQLite + FS;
 *   `legacy-clerk-convex` = Clerk + Convex + Convex)
 * - `SECRET_ANSWER_KEYS` list for redaction and preset exclusion
 * - `WIZARD_OWNED_ENV_KEYS` whitelist for non-destructive env merging
 * - `createDefaultAnswers()` factory for initializing sessions
 *
 * Non-responsibilities:
 * - Provider runtime registration (handled by provider packages)
 * - Validation logic (see validation.ts)
 * - Env derivation (see derive.ts)
 *
 * Constraints:
 * - The catalog is static metadata. Provider discovery is not dynamic in v1.
 * - Local provider IDs (`custom`, `memory`, `redis`, `postgres`) are excluded
 *   from module ID generation since they have no publishable package.
 *
 * @see types.ts for WizardProviderDescriptor shape
 * @see planning/or3-cloud-launch-wizard/design.md for catalog design rationale
 */
import type {
    WizardAnswers,
    WizardPreset,
    WizardProviderDescriptor,
} from './types';

/** Available built-in theme identifiers for the theme selection step. */
export const BUILTIN_THEMES = ['blank', 'retro'] as const;
/**
 * Answer keys that contain secrets.
 * Used by `sanitizeAnswersForSession()` to strip secrets before persistence,
 * and by `savePreset()` to exclude secrets from stored presets.
 */
export const SECRET_ANSWER_KEYS: Array<keyof WizardAnswers> = [
    'basicAuthJwtSecret',
    'basicAuthRefreshSecret',
    'basicAuthBootstrapPassword',
    'clerkSecretKey',
    'openrouterInstanceApiKey',
    'convexAdminJwtSecret',
    'fsTokenSecret',
    'convexSelfHostedAdminKey',
];

/**
 * Provider IDs that are local/built-in and do not have a publishable
 * `or3-provider-${id}` package. These are excluded from
 * `or3.providers.generated.ts` module list generation.
 */
export const LOCAL_PROVIDER_IDS = new Set([
    'custom',
    'memory',
    'redis',
    'postgres',
]);

/**
 * Complete whitelist of env var keys that the wizard is allowed to write.
 * During env file merging, only these keys are updated; all other existing
 * keys and comments in the env file are preserved.
 *
 * @see deriveWizardOwnedEnvUpdates for the merge logic
 */
export const WIZARD_OWNED_ENV_KEYS = [
    'SSR_AUTH_ENABLED',
    'AUTH_PROVIDER',
    'OR3_AUTH_PROVIDER',
    'OR3_GUEST_ACCESS_ENABLED',
    'OR3_SYNC_ENABLED',
    'OR3_CLOUD_SYNC_ENABLED',
    'OR3_SYNC_PROVIDER',
    'VITE_CONVEX_URL',
    'CONVEX_SELF_HOSTED_ADMIN_KEY',
    'OR3_STORAGE_ENABLED',
    'OR3_CLOUD_STORAGE_ENABLED',
    'NUXT_PUBLIC_STORAGE_PROVIDER',
    'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET',
    'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
    'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS',
    'OR3_BASIC_AUTH_DB_PATH',
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
    'OR3_SQLITE_DB_PATH',
    'OR3_SQLITE_PRAGMA_JOURNAL_MODE',
    'OR3_SQLITE_PRAGMA_SYNCHRONOUS',
    'OR3_SQLITE_ALLOW_IN_MEMORY',
    'OR3_SQLITE_STRICT',
    'OR3_STORAGE_FS_ROOT',
    'OR3_STORAGE_FS_TOKEN_SECRET',
    'OR3_STORAGE_FS_URL_TTL_SECONDS',
    'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'NUXT_CLERK_SECRET_KEY',
    'OPENROUTER_API_KEY',
    'OR3_OPENROUTER_ALLOW_USER_OVERRIDE',
    'OR3_OPENROUTER_REQUIRE_USER_KEY',
    'OR3_SITE_NAME',
    'OR3_DEFAULT_THEME',
    'OR3_LOGO_URL',
    'OR3_FAVICON_URL',
    'OR3_WORKFLOWS_ENABLED',
    'OR3_DOCUMENTS_ENABLED',
    'OR3_BACKUP_ENABLED',
    'OR3_MENTIONS_ENABLED',
    'OR3_DASHBOARD_ENABLED',
    'OR3_LIMITS_ENABLED',
    'OR3_REQUESTS_PER_MINUTE',
    'OR3_MAX_CONVERSATIONS',
    'OR3_MAX_MESSAGES_PER_DAY',
    'OR3_LIMITS_STORAGE_PROVIDER',
    'OR3_ALLOWED_ORIGINS',
    'OR3_FORCE_HTTPS',
    'OR3_STRICT_CONFIG',
    'OR3_TRUST_PROXY',
    'OR3_FORWARDED_FOR_HEADER',
] as const;

/**
 * Static provider catalog. Drives selection lists, provider-scoped
 * prompt steps, and dependency install plans.
 *
 * v1 providers:
 * - Auth: `basic-auth` (recommended), `clerk` (legacy)
 * - Sync: `sqlite` (recommended), `convex` (legacy)
 * - Storage: `fs` (recommended), `convex` (legacy)
 *
 * Future providers (e.g. `firebase`, `s3`) are added by extending
 * this array and setting `implemented: true` once the runtime exists.
 */
export const providerCatalog: WizardProviderDescriptor[] = [
    {
        kind: 'auth',
        id: 'basic-auth',
        label: 'Basic Auth (Recommended)',
        implemented: true,
        docsUrl: '/cloud/provider-basic-auth',
        dependencies: [
            {
                packageName: 'or3-provider-basic-auth',
                reason: 'Password-based auth provider and UI adapter.',
            },
            {
                packageName: 'better-sqlite3',
                reason: 'Credential/session database used by basic-auth provider.',
            },
        ],
        fields: [
            {
                key: 'basicAuthJwtSecret',
                type: 'password',
                label: 'Security key for login sessions',
                help: 'A long random string (32+ characters) used to sign login tokens. Keep this secret!',
                required: true,
                secret: true,
            },
            {
                key: 'basicAuthBootstrapEmail',
                type: 'text',
                label: 'Your admin email',
                help: 'This will be the first admin account. You\'ll use it to log in after setup.',
                required: true,
            },
            {
                key: 'basicAuthBootstrapPassword',
                type: 'password',
                label: 'Your admin password',
                help: 'Choose a strong password for your admin account.',
                required: true,
                secret: true,
                validate: (value) => {
                    const password = String(value ?? '').trim();
                    if (password.length < 8) {
                        return 'Admin password must be at least 8 characters.';
                    }
                    return null;
                },
            },
            {
                key: 'basicAuthRefreshSecret',
                type: 'password',
                label: 'Refresh key (optional, press Enter to auto-generate)',
                help: 'Used for long-lived sessions. If left blank, one will be derived from the main key.',
                secret: true,
            },
            {
                key: 'basicAuthAccessTtlSeconds',
                type: 'number',
                label: 'Session length in seconds (default: 900 = 15 minutes)',
                help: 'How long before a user\'s session expires and they need to re-authenticate.',
                defaultValue: 900,
            },
            {
                key: 'basicAuthRefreshTtlSeconds',
                type: 'number',
                label: 'Remember-me length in seconds (default: 2592000 = 30 days)',
                help: 'How long a user stays logged in if they have a "remember me" token.',
                defaultValue: 2592000,
            },
            {
                key: 'basicAuthDbPath',
                type: 'text',
                label: 'Where to store user accounts',
                help: 'File path for the login database. The default location is fine for most setups.',
                defaultValue: './.data/or3-basic-auth.sqlite',
            },
        ],
    },
    {
        kind: 'auth',
        id: 'clerk',
        label: 'Clerk (Legacy)',
        implemented: true,
        docsUrl: '/cloud/provider-clerk',
        dependencies: [
            {
                packageName: 'or3-provider-clerk',
                reason: 'Clerk SSR auth provider and broker integration.',
            },
        ],
        fields: [
            {
                key: 'clerkPublishableKey',
                type: 'text',
                label: 'Clerk Publishable Key',
                help: 'Find this in your Clerk dashboard at clerk.com → API Keys.',
                required: true,
            },
            {
                key: 'clerkSecretKey',
                type: 'password',
                label: 'Clerk Secret Key',
                help: 'The secret key from your Clerk dashboard. Never share this publicly.',
                required: true,
                secret: true,
            },
        ],
    },
    {
        kind: 'sync',
        id: 'sqlite',
        label: 'SQLite (Recommended)',
        implemented: true,
        docsUrl: '/cloud/provider-sqlite',
        dependencies: [
            {
                packageName: 'or3-provider-sqlite',
                reason: 'SQLite sync + workspace store provider.',
            },
            {
                packageName: 'better-sqlite3',
                reason: 'SQLite runtime used by sync provider.',
            },
        ],
        fields: [
            {
                key: 'sqliteDbPath',
                type: 'text',
                label: 'Where to store synced data',
                help: 'File path for the sync database. Example: ./.data/or3-sync.sqlite',
                required: true,
            },
            {
                key: 'sqlitePragmaJournalMode',
                type: 'text',
                label: 'Journal mode (default: WAL)',
                help: 'WAL is the recommended setting for best performance. Leave as-is unless you know what this does.',
                defaultValue: 'WAL',
            },
            {
                key: 'sqlitePragmaSynchronous',
                type: 'text',
                label: 'Sync mode (default: NORMAL)',
                help: 'NORMAL is a good balance of speed and safety. Leave as-is unless you know what this does.',
                defaultValue: 'NORMAL',
            },
            {
                key: 'sqliteAllowInMemory',
                type: 'boolean',
                label: 'Allow in-memory database (testing only)',
                help: 'Only enable this for automated tests. Data is lost when the server restarts.',
                defaultValue: false,
            },
            {
                key: 'sqliteStrict',
                type: 'boolean',
                label: 'Strict mode',
                help: 'Enforces stricter type checking in the database. Off by default.',
                defaultValue: false,
            },
        ],
    },
    {
        kind: 'sync',
        id: 'convex',
        label: 'Convex (Legacy)',
        implemented: true,
        docsUrl: '/cloud/provider-convex',
        dependencies: [
            {
                packageName: 'or3-provider-convex',
                reason: 'Convex sync gateway and workspace store provider.',
            },
        ],
        fields: [
            {
                key: 'convexUrl',
                type: 'text',
                label: 'Convex URL',
                help: 'Your Convex deployment URL. Find it in your Convex dashboard.',
                required: true,
            },
            {
                key: 'convexSelfHostedAdminKey',
                type: 'password',
                label: 'Admin Key (only for self-hosted Convex)',
                help: 'Only needed if you\'re running your own Convex server. Skip this for Convex Cloud.',
                secret: true,
            },
        ],
    },
    {
        kind: 'storage',
        id: 'fs',
        label: 'Filesystem (Recommended)',
        implemented: true,
        docsUrl: '/cloud/provider-fs',
        dependencies: [
            {
                packageName: 'or3-provider-fs',
                reason: 'Filesystem-backed storage gateway provider.',
            },
        ],
        fields: [
            {
                key: 'fsRoot',
                type: 'text',
                label: 'Upload folder (absolute path)',
                help: 'Where uploaded files are saved on disk. Must be an absolute path. Example: /var/data/or3-files',
                required: true,
            },
            {
                key: 'fsTokenSecret',
                type: 'password',
                label: 'File access key',
                help: 'A random string used to generate secure download links. Keep this secret!',
                required: true,
                secret: true,
            },
            {
                key: 'fsUrlTtlSeconds',
                type: 'number',
                label: 'Download link expiry (default: 900 = 15 minutes)',
                help: 'How long a download link stays valid before it expires.',
                defaultValue: 900,
            },
        ],
    },
    {
        kind: 'storage',
        id: 'convex',
        label: 'Convex (Legacy)',
        implemented: true,
        docsUrl: '/cloud/provider-convex',
        dependencies: [
            {
                packageName: 'or3-provider-convex',
                reason: 'Convex storage adapter.',
            },
        ],
        fields: [],
    },
];

/**
 * Returns provider descriptors filtered to a specific kind that are
 * marked as implemented. Used by the step engine to populate selection lists.
 */
export function listImplementedProviders(kind: WizardProviderDescriptor['kind']) {
    return providerCatalog.filter((provider) => provider.kind === kind && provider.implemented);
}

/**
 * Looks up a single provider descriptor by kind and ID.
 * Returns `undefined` if no matching provider exists in the catalog.
 */
export function getProviderDescriptor(kind: WizardProviderDescriptor['kind'], id: string) {
    return providerCatalog.find((provider) => provider.kind === kind && provider.id === id);
}

/**
 * Creates a complete `WizardAnswers` object populated with sensible defaults.
 *
 * Behavior:
 * - When `presetName` is `'legacy-clerk-convex'`, providers default to
 *   Clerk + Convex + Convex instead of Basic Auth + SQLite + FS.
 * - All non-secret fields receive a value; secret fields remain `undefined`.
 * - `instanceDir` defaults to `process.cwd()` when not provided.
 *
 * @example
 * ```ts
 * const answers = createDefaultAnswers({ instanceDir: '/opt/or3' });
 * // answers.authProvider === 'basic-auth'
 * // answers.syncProvider === 'sqlite'
 * // answers.storageProvider === 'fs'
 * ```
 */
export function createDefaultAnswers(
    input: {
        instanceDir: string;
        envFile?: '.env' | '.env.local';
        presetName?: string;
    } = {
        instanceDir: process.cwd(),
    }
): WizardAnswers {
    const presetName = input.presetName ?? 'recommended';
    const base: WizardAnswers = {
        instanceDir: input.instanceDir,
        envFile: input.envFile ?? '.env',
        deploymentTarget: 'local-dev',
        dryRun: false,
        skipWriteBackup: false,
        presetName,
        or3SiteName: 'OR3',
        or3DefaultTheme: 'retro',
        themeInstallMode: 'use-existing',
        themesToInstall: ['blank', 'retro'],
        workflowsEnabled: true,
        documentsEnabled: true,
        backupEnabled: true,
        mentionsEnabled: true,
        dashboardEnabled: true,
        ssrAuthEnabled: true,
        authProvider: 'basic-auth',
        guestAccessEnabled: false,
        basicAuthAccessTtlSeconds: 900,
        basicAuthRefreshTtlSeconds: 2592000,
        basicAuthDbPath: './.data/or3-basic-auth.sqlite',
        syncEnabled: true,
        syncProvider: 'sqlite',
        sqliteDbPath: './.data/or3-sync.sqlite',
        sqlitePragmaJournalMode: 'WAL',
        sqlitePragmaSynchronous: 'NORMAL',
        sqliteAllowInMemory: false,
        sqliteStrict: false,
        storageEnabled: true,
        storageProvider: 'fs',
        fsRoot: '/tmp/or3-storage',
        fsUrlTtlSeconds: 900,
        openrouterAllowUserOverride: true,
        openrouterRequireUserKey: false,
        limitsEnabled: true,
        requestsPerMinute: 20,
        maxConversations: 0,
        maxMessagesPerDay: 0,
        allowedOrigins: [],
        strictConfig: false,
        trustProxy: false,
        forwardedForHeader: 'x-forwarded-for',
    };

    if (presetName === 'legacy-clerk-convex') {
        return {
            ...base,
            authProvider: 'clerk',
            syncProvider: 'convex',
            storageProvider: 'convex',
        };
    }

    return base;
}

/**
 * Built-in preset: Basic Auth + SQLite + FS.
 * This is the recommended self-hosted stack for new deployments.
 */
export const recommendedPreset: WizardPreset = {
    name: 'recommended',
    createdAt: new Date(0).toISOString(),
    answers: {
        presetName: 'recommended',
        authProvider: 'basic-auth',
        syncProvider: 'sqlite',
        storageProvider: 'fs',
        ssrAuthEnabled: true,
        syncEnabled: true,
        storageEnabled: true,
        deploymentTarget: 'local-dev',
    },
};

/**
 * Built-in preset: Clerk + Convex + Convex.
 * Retained for backward compatibility with existing Clerk/Convex deployments.
 */
export const legacyPreset: WizardPreset = {
    name: 'legacy-clerk-convex',
    createdAt: new Date(0).toISOString(),
    answers: {
        presetName: 'legacy-clerk-convex',
        authProvider: 'clerk',
        syncProvider: 'convex',
        storageProvider: 'convex',
        ssrAuthEnabled: true,
        syncEnabled: true,
        storageEnabled: true,
        deploymentTarget: 'local-dev',
    },
};
