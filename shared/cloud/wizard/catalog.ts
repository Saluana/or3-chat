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
import { resolve as resolvePath } from 'node:path';
import type {
    WizardAnswers,
    WizardMode,
    WizardPreset,
    WizardProviderDescriptor,
} from './types';
import { detectPackageManager } from './package-manager';

/** Recommended self-hosted modes. The legacy fast mode stays readable. */
export function isRecommendedSelfHostMode(mode: WizardMode): boolean {
    return mode === 'preset-local' || mode === 'preset-local-fast';
}

/** Absolute default for filesystem storage under the instance directory. */
export function defaultFsRoot(instanceDir: string): string {
    return resolvePath(instanceDir, '.data', 'or3-storage');
}

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
    'basicAuthInviteTokenSecret',
    'basicAuthBootstrapPassword',
    'clerkSecretKey',
    'openrouterInstanceApiKey',
    'convexAdminJwtSecret',
    'fsTokenSecret',
    's3AccessKeyId',
    's3SecretAccessKey',
    's3SessionToken',
    'convexSelfHostedAdminKey',
    'connectEncryptionKey',
    'connectCloudflareApiToken',
    'connectCloudflareValidationAttestation',
    'adminPassword',
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
    'OR3_AUTH_LOCK_PAGE_ENABLED',
    'OR3_AUTH_LOCK_PAGE_ADAPTER',
    'OR3_SYNC_ENABLED',
    'OR3_CLOUD_SYNC_ENABLED',
    'OR3_SYNC_PROVIDER',
    'VITE_CONVEX_URL',
    'OR3_CONVEX_ALLOW_INSECURE_HTTP',
    'CONVEX_SELF_HOSTED_URL',
    'CONVEX_SELF_HOSTED_ADMIN_KEY',
    'VITE_CONVEX_SITE_URL',
    'OR3_STORAGE_ENABLED',
    'OR3_CLOUD_STORAGE_ENABLED',
    'NUXT_PUBLIC_STORAGE_PROVIDER',
    'OR3_BASIC_AUTH_JWT_SECRET',
    'OR3_BASIC_AUTH_REFRESH_SECRET',
    'OR3_AUTH_INVITE_TOKEN_SECRET',
    'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
    'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS',
    'OR3_BASIC_AUTH_DB_PATH',
    'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
    'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
    'OR3_AUTH_REGISTRATION_MODE',
    'OR3_AUTH_AUTO_PROVISION',
    'OR3_PLUGIN_ZIP_INSTALL_ENABLED',
    'OR3_ADMIN_ALLOW_REBUILD',
    'OR3_SQLITE_DB_PATH',
    'OR3_SQLITE_PRAGMA_JOURNAL_MODE',
    'OR3_SQLITE_PRAGMA_SYNCHRONOUS',
    'OR3_SQLITE_ALLOW_IN_MEMORY',
    'OR3_SQLITE_STRICT',
    'OR3_CONNECT_ENABLED',
    'OR3_CONNECT_PROVIDER',
    'OR3_CONNECT_RELAY_PROVIDER',
    'OR3_CONNECT_PUBLIC_URL',
    'OR3_CONNECT_ENCRYPTION_KEY',
    'OR3_CONNECT_MAX_COMPUTERS',
    'OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID',
    'OR3_CONNECT_CLOUDFLARE_ZONE_ID',
    'OR3_CONNECT_CLOUDFLARE_API_TOKEN',
    'OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION',
    'OR3_CONNECT_HOSTNAME_SUFFIX',
    'OR3_STORAGE_FS_ROOT',
    'OR3_STORAGE_FS_TOKEN_SECRET',
    'OR3_STORAGE_FS_URL_TTL_SECONDS',
    'OR3_STORAGE_S3_ENDPOINT',
    'OR3_STORAGE_S3_REGION',
    'OR3_STORAGE_S3_BUCKET',
    'OR3_STORAGE_S3_ACCESS_KEY_ID',
    'OR3_STORAGE_S3_SECRET_ACCESS_KEY',
    'OR3_STORAGE_S3_SESSION_TOKEN',
    'OR3_STORAGE_S3_FORCE_PATH_STYLE',
    'OR3_STORAGE_S3_KEY_PREFIX',
    'OR3_STORAGE_S3_URL_TTL_SECONDS',
    'OR3_STORAGE_S3_REQUIRE_CHECKSUM',
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
    'OR3_PUBLIC_DOMAIN',
    'OR3_ALLOWED_ORIGINS',
    'OR3_FORCE_HTTPS',
    'OR3_STRICT_CONFIG',
    'OR3_TRUST_PROXY',
    'OR3_FORWARDED_FOR_HEADER',
    'OR3_ADMIN_USERNAME',
    'OR3_ADMIN_PASSWORD',
] as const;

/**
 * Static provider catalog. Drives selection lists, provider-scoped
 * prompt steps, and dependency install plans.
 *
 * v1 providers:
 * - Auth: `basic-auth`, `clerk`
 * - Sync: `sqlite`, `convex`
 * - Storage: `fs`, `s3`, `convex`
 *
 * Future providers (e.g. `firebase`, `s3`) are added by extending
 * this array and setting `implemented: true` once the runtime exists.
 */
export const providerCatalog: WizardProviderDescriptor[] = [
    {
        kind: 'auth',
        id: 'basic-auth',
        label: 'Basic Auth (Default)',
        pros: [
            'Zero external dependencies and quick local setup.',
            'Full control over auth data in your own infrastructure.',
        ],
        cons: [
            'You manage user lifecycle and credential security yourself.',
            'No built-in social login or enterprise SSO features.',
        ],
        idealUseCase: 'Self-hosted teams wanting a simple default stack.',
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
                help: 'Leave blank to auto-generate. A long random string (32+ characters) used to sign login tokens.',
                required: true,
                secret: true,
                autoGenerate: true,
                tier: 'advanced',
            },
            {
                key: 'basicAuthBootstrapEmail',
                type: 'text',
                label: 'Your admin email',
                help: 'This will be the first admin account. You\'ll use it to log in after setup.',
                required: true,
                tier: 'core',
            },
            {
                key: 'basicAuthBootstrapPassword',
                type: 'password',
                label: 'Your admin password (leave blank to auto-generate)',
                help: 'Leave blank and OR3 generates a strong password. You\'ll see it on the review screen after setup.',
                required: true,
                secret: true,
                autoGenerate: true,
                tier: 'advanced',
                validate: (value) => {
                    const password = String(value ?? '').trim();
                    if (!password) return null;
                    if (password.length < 12) {
                        return 'Admin password must be at least 12 characters.';
                    }
                    if (!/[A-Z]/.test(password)) {
                        return 'Password must contain at least one uppercase letter.';
                    }
                    if (!/[a-z]/.test(password)) {
                        return 'Password must contain at least one lowercase letter.';
                    }
                    if (!/[0-9]/.test(password)) {
                        return 'Password must contain at least one number.';
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
                tier: 'advanced',
            },
            {
                key: 'basicAuthAccessTtlSeconds',
                type: 'number',
                label: 'Session length in seconds (default: 900 = 15 minutes)',
                help: 'How long before a user\'s session expires and they need to re-authenticate.',
                defaultValue: 900,
                tier: 'advanced',
            },
            {
                key: 'basicAuthRefreshTtlSeconds',
                type: 'number',
                label: 'Remember-me length in seconds (default: 2592000 = 30 days)',
                help: 'How long a user stays logged in if they have a "remember me" token.',
                defaultValue: 2592000,
                tier: 'advanced',
            },
            {
                key: 'basicAuthDbPath',
                type: 'text',
                label: 'Where to store user accounts',
                help: 'File path for the login database. The default location is fine for most setups.',
                defaultValue: './.data/or3-basic-auth.sqlite',
                tier: 'advanced',
            },
        ],
    },
    {
        kind: 'auth',
        id: 'clerk',
        label: 'Clerk',
        pros: [
            'Managed auth with production-ready session handling.',
            'Strong ecosystem support for MFA, SSO, and user management.',
        ],
        cons: [
            'Requires an external SaaS dependency.',
            'More setup surface (keys, issuer, provider wiring).',
        ],
        idealUseCase: 'Teams that want managed auth and enterprise features fast.',
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
                tier: 'core',
            },
            {
                key: 'clerkSecretKey',
                type: 'password',
                label: 'Clerk Secret Key',
                help: 'The secret key from your Clerk dashboard. Never share this publicly.',
                required: true,
                secret: true,
                tier: 'core',
            },
        ],
    },
    {
        kind: 'sync',
        id: 'sqlite',
        label: 'SQLite (Default)',
        pros: [
            'Local durable storage with minimal operational overhead.',
            'Great performance for single-node and small-team deployments.',
        ],
        cons: [
            'Not horizontally distributed out of the box.',
            'Operational replication/backups are your responsibility.',
        ],
        idealUseCase: 'Single-instance deployments prioritizing simplicity.',
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
                help: 'File path for the sync database. Default: ./.data/or3-sync.sqlite',
                required: true,
                defaultValue: './.data/or3-sync.sqlite',
                tier: 'advanced',
            },
            {
                key: 'sqlitePragmaJournalMode',
                type: 'text',
                label: 'Journal mode (default: WAL)',
                help: 'WAL is the recommended setting for best performance. Leave as-is unless you know what this does.',
                defaultValue: 'WAL',
                tier: 'advanced',
            },
            {
                key: 'sqlitePragmaSynchronous',
                type: 'text',
                label: 'Sync mode (default: NORMAL)',
                help: 'NORMAL is a good balance of speed and safety. Leave as-is unless you know what this does.',
                defaultValue: 'NORMAL',
                tier: 'advanced',
            },
            {
                key: 'sqliteAllowInMemory',
                type: 'boolean',
                label: 'Allow in-memory database (testing only)',
                help: 'Only enable this for automated tests. Data is lost when the server restarts.',
                defaultValue: false,
                tier: 'advanced',
            },
            {
                key: 'sqliteStrict',
                type: 'boolean',
                label: 'Strict mode',
                help: 'Enforces stricter type checking in the database. Off by default.',
                defaultValue: false,
                tier: 'advanced',
            },
        ],
    },
    {
        kind: 'sync',
        id: 'convex',
        label: 'Convex',
        pros: [
            'Realtime-first sync and managed backend ergonomics.',
            'Scales multi-user collaboration without local DB ops.',
        ],
        cons: [
            'Adds external platform dependency and deployment model changes.',
            'Requires Convex project/bootstrap workflow.',
        ],
        idealUseCase: 'Collaborative apps needing managed realtime sync.',
        implemented: true,
        docsUrl: '/cloud/provider-convex',
        dependencies: [
            {
                packageName: 'or3-provider-convex',
                reason: 'Convex sync gateway and workspace store provider.',
            },
            {
                packageName: 'convex',
                reason: 'Convex CLI/runtime needed for `bunx convex dev --once` and generated types.',
            },
        ],
        fields: [
            {
                key: 'convexUrl',
                type: 'text',
                label: 'Convex URL',
                help: 'Your Convex deployment URL. Find it in your Convex dashboard.',
                required: true,
                tier: 'core',
            },
            {
                key: 'convexSelfHostedAdminKey',
                type: 'password',
                label: 'Server deployment key',
                help: 'Required for OR3 server operations. For Convex Cloud, create a deployment-scoped key with `npx convex deployment token create or3-server`; for self-hosted Convex, use the deployment admin key.',
                required: true,
                secret: true,
                tier: 'core',
            },
            {
                key: 'convexSelfHostedSiteUrl',
                type: 'text',
                label: 'Site URL (optional, self-hosted Convex only)',
                help: 'Optional HTTP actions URL (example: http://provider.example.com:3211). Leave blank for Convex Cloud.',
                tier: 'advanced',
            },
        ],
    },
    {
        kind: 'storage',
        id: 'fs',
        label: 'Filesystem (Default)',
        pros: [
            'Fast local file IO with low complexity.',
            'No extra cloud account required for development.',
        ],
        cons: [
            'Not ideal for multi-instance distributed deployments.',
            'Durability/backups depend on your host filesystem strategy.',
        ],
        idealUseCase: 'Local or single-node deployments with simple file storage.',
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
                help: 'Where uploaded files are saved on disk. Defaults to <project>/.data/or3-storage.',
                required: true,
                tier: 'advanced',
            },
            {
                key: 'fsTokenSecret',
                type: 'password',
                label: 'File access key (leave blank to auto-generate)',
                help: 'A random string used to generate secure download links. Leave blank to auto-generate.',
                required: true,
                secret: true,
                autoGenerate: true,
                tier: 'advanced',
            },
            {
                key: 'fsUrlTtlSeconds',
                type: 'number',
                label: 'Download link expiry (default: 900 = 15 minutes)',
                help: 'How long a download link stays valid before it expires.',
                defaultValue: 900,
                tier: 'advanced',
            },
        ],
    },
    {
        kind: 'storage',
        id: 's3',
        label: 'S3 Compatible (AWS / R2 / MinIO)',
        pros: [
            'Durable object storage with broad ecosystem compatibility.',
            'Works across AWS and S3-compatible providers.',
        ],
        cons: [
            'Requires credential and bucket policy management.',
            'Latency and egress costs depend on provider/region choices.',
        ],
        idealUseCase: 'Production deployments needing scalable object storage.',
        implemented: true,
        docsUrl: '/cloud/provider-s3',
        dependencies: [
            {
                packageName: 'or3-provider-s3',
                reason: 'S3-compatible storage gateway provider (server-signed presigned URLs).',
            },
        ],
        fields: [
            {
                key: 's3Endpoint',
                type: 'text',
                label: 'S3 endpoint URL (optional for AWS)',
                help: 'Required for most S3-compatible hosts (MinIO, R2, B2). Example: https://<account>.r2.cloudflarestorage.com',
                tier: 'advanced',
            },
            {
                key: 's3Region',
                type: 'text',
                label: 'Region (default: us-east-1)',
                help: 'AWS region, or a dummy region required by your S3 host. Most compat hosts accept "us-east-1".',
                defaultValue: 'us-east-1',
                required: true,
                tier: 'core',
            },
            {
                key: 's3Bucket',
                type: 'text',
                label: 'Bucket name',
                help: 'Bucket where OR3 stores blob objects. Must allow PUT/GET/HEAD with CORS from your OR3 origin.',
                required: true,
                tier: 'core',
            },
            {
                key: 's3AccessKeyId',
                type: 'password',
                label: 'Access key ID',
                help: 'Server-only credential used to sign presigned URLs. Never exposed to the browser.',
                required: true,
                secret: true,
                tier: 'core',
            },
            {
                key: 's3SecretAccessKey',
                type: 'password',
                label: 'Secret access key',
                help: 'Server-only credential used to sign presigned URLs. Never exposed to the browser.',
                required: true,
                secret: true,
                tier: 'core',
            },
            {
                key: 's3SessionToken',
                type: 'password',
                label: 'Session token (optional)',
                help: 'Only needed for temporary credentials (STS). Leave blank for long-lived access keys.',
                secret: true,
                tier: 'advanced',
            },
            {
                key: 's3ForcePathStyle',
                type: 'boolean',
                label: 'Force path-style URLs (MinIO/legacy)',
                help: 'Enable this for MinIO or hosts that do not support virtual-hosted-style buckets.',
                defaultValue: false,
                tier: 'advanced',
            },
            {
                key: 's3KeyPrefix',
                type: 'text',
                label: 'Key prefix (optional)',
                help: 'Optional prefix within the bucket. Example: or3-storage',
                tier: 'advanced',
            },
            {
                key: 's3UrlTtlSeconds',
                type: 'number',
                label: 'Presigned URL TTL seconds (default: 900 = 15 minutes)',
                help: 'How long presigned URLs stay valid. Keep this short.',
                defaultValue: 900,
                tier: 'advanced',
            },
            {
                key: 's3RequireChecksum',
                type: 'boolean',
                label: 'Require checksum on upload (optional hardening)',
                help: 'If enabled, uploads must include x-amz-checksum-sha256. Some S3-compatible hosts may not support this.',
                defaultValue: false,
                tier: 'advanced',
            },
        ],
    },
    {
        kind: 'storage',
        id: 'convex',
        label: 'Convex',
        pros: [
            'Unified backend when already using Convex for sync.',
            'Reduces provider surface area in Convex-centric stacks.',
        ],
        cons: [
            'Ties storage lifecycle to Convex setup and limits.',
            'Less portable than plain S3-compatible storage.',
        ],
        idealUseCase: 'Teams standardizing fully on Convex infrastructure.',
        implemented: true,
        docsUrl: '/cloud/provider-convex',
        dependencies: [
            {
                packageName: 'or3-provider-convex',
                reason: 'Convex storage adapter.',
            },
            {
                packageName: 'convex',
                reason: 'Convex CLI/runtime needed for `bunx convex dev --once` and generated types.',
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

export function inferWizardModeFromPresetName(
    presetName?: string
): WizardMode {
    if (presetName === 'personal-local') {
        return 'personal-local';
    }
    if (presetName === 'legacy-clerk-convex' || presetName === 'clerk-convex') {
        return 'preset-clerk-convex';
    }
    if (!presetName || presetName === 'recommended') {
        return 'preset-local';
    }
    return 'custom';
}

export function isWizardMode(value: unknown): value is WizardMode {
    return (
        value === 'personal-local' ||
        value === 'preset-local' ||
        value === 'preset-local-fast' ||
        value === 'preset-clerk-convex' ||
        value === 'custom'
    );
}

export function normalizeWizardMode(
    wizardMode: unknown,
    presetName?: string
): WizardMode {
    if (isWizardMode(wizardMode)) {
        return wizardMode;
    }
    return inferWizardModeFromPresetName(presetName);
}

function applyRecommendedSelfHostDefaults(
    answers: WizardAnswers,
    wizardMode: 'preset-local' | 'preset-local-fast'
): WizardAnswers {
    return {
        ...answers,
        wizardMode,
        presetName: 'recommended',
        ssrAuthEnabled: true,
        authProvider: 'basic-auth',
        syncEnabled: true,
        syncProvider: 'sqlite',
        storageEnabled: true,
        storageProvider: 'fs',
        connectProvider: 'sqlite',
    };
}

export function applyWizardModeDefaults(
    answers: WizardAnswers,
    wizardMode: WizardMode
): WizardAnswers {
    switch (wizardMode) {
        case 'personal-local':
            return {
                ...answers,
                wizardMode: 'personal-local',
                presetName: 'personal-local',
                ssrAuthEnabled: false,
                syncEnabled: false,
                storageEnabled: false,
                connectEnabled: false,
            };
        case 'preset-local':
            return applyRecommendedSelfHostDefaults(answers, 'preset-local');
        case 'preset-local-fast':
            // Older saved sessions remain valid, but must now collect a real
            // administrator identity like the recommended path.
            return applyRecommendedSelfHostDefaults(
                answers,
                'preset-local-fast'
            );
        case 'preset-clerk-convex':
            return {
                ...answers,
                wizardMode: 'preset-clerk-convex',
                presetName: 'legacy-clerk-convex',
                ssrAuthEnabled: true,
                authProvider: 'clerk',
                syncEnabled: true,
                syncProvider: 'convex',
                storageEnabled: true,
                storageProvider: 'convex',
                connectProvider: 'convex',
            };
        case 'custom':
            return {
                ...answers,
                wizardMode: 'custom',
            };
        default: {
            const _exhaustive: never = wizardMode;
            return _exhaustive;
        }
    }
}

export function normalizeAdvancedToggles(
    answers: WizardAnswers
): WizardAnswers {
    const allAdvancedEnabled = Boolean(answers.allAdvancedEnabled);
    return {
        ...answers,
        allAdvancedEnabled,
        baseAdvancedEnabled:
            allAdvancedEnabled || Boolean(answers.baseAdvancedEnabled),
        authAdvancedEnabled:
            allAdvancedEnabled || Boolean(answers.authAdvancedEnabled),
        syncAdvancedEnabled:
            allAdvancedEnabled || Boolean(answers.syncAdvancedEnabled),
        storageAdvancedEnabled:
            allAdvancedEnabled || Boolean(answers.storageAdvancedEnabled),
        cloudAdvancedEnabled:
            allAdvancedEnabled || Boolean(answers.cloudAdvancedEnabled),
        connectAdvancedEnabled:
            allAdvancedEnabled || Boolean(answers.connectAdvancedEnabled),
    };
}

const ADVANCED_SECTION_KEYS = {
    base: [
        'or3LogoUrl',
        'or3FaviconUrl',
        'themeInstallMode',
        'themesToInstall',
    ],
    auth: [
        'basicAuthRefreshSecret',
        'basicAuthAccessTtlSeconds',
        'basicAuthRefreshTtlSeconds',
        'basicAuthDbPath',
    ],
    sync: [
        'sqliteDbPath',
        'sqlitePragmaJournalMode',
        'sqlitePragmaSynchronous',
        'sqliteAllowInMemory',
        'sqliteStrict',
        'convexSelfHostedSiteUrl',
    ],
    storage: [
        'fsRoot',
        'fsUrlTtlSeconds',
        's3Endpoint',
        's3SessionToken',
        's3ForcePathStyle',
        's3KeyPrefix',
        's3UrlTtlSeconds',
        's3RequireChecksum',
    ],
    cloud: [
        'openrouterAllowUserOverride',
        'openrouterRequireUserKey',
        'requestsPerMinute',
        'maxConversations',
        'maxMessagesPerDay',
        'limitsStorageProvider',
        'allowedOrigins',
        'forwardedForHeader',
        'strictConfig',
    ],
    connect: [
        'connectProvider',
        'connectRelayProvider',
        'connectMaxComputers',
        'connectCloudflareAccountId',
        'connectCloudflareZoneId',
    ],
} as const satisfies Record<
    'base' | 'auth' | 'sync' | 'storage' | 'cloud' | 'connect',
    ReadonlyArray<keyof WizardAnswers>
>;

function resetAdvancedSectionToDefaults(
    answers: WizardAnswers,
    defaults: WizardAnswers,
    section: keyof typeof ADVANCED_SECTION_KEYS
): WizardAnswers {
    const next = { ...answers };
    for (const key of ADVANCED_SECTION_KEYS[section]) {
        (next as Record<keyof WizardAnswers, unknown>)[key] = defaults[key];
    }
    return next;
}

export function applySkippedAdvancedDefaults(
    answers: WizardAnswers
): WizardAnswers {
    if (answers.allAdvancedEnabled) {
        return answers;
    }

    const defaults = createDefaultAnswers({
        instanceDir: answers.instanceDir,
        envFile: answers.envFile,
        presetName: answers.presetName,
    });

    let next = { ...answers };
    if (!next.baseAdvancedEnabled) {
        next = resetAdvancedSectionToDefaults(next, defaults, 'base');
    }
    if (!next.authAdvancedEnabled) {
        next = resetAdvancedSectionToDefaults(next, defaults, 'auth');
    }
    if (!next.syncAdvancedEnabled) {
        next = resetAdvancedSectionToDefaults(next, defaults, 'sync');
    }
    if (!next.storageAdvancedEnabled) {
        next = resetAdvancedSectionToDefaults(next, defaults, 'storage');
    }
    if (!next.cloudAdvancedEnabled) {
        next = resetAdvancedSectionToDefaults(next, defaults, 'cloud');
    }
    if (!next.connectAdvancedEnabled) {
        next = resetAdvancedSectionToDefaults(next, defaults, 'connect');
        next.connectProvider =
            next.syncProvider === 'convex' ? 'convex' : 'sqlite';
    }

    return next;
}

function normalizeEnvValue(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed
            .slice(1, -1)
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n');
    }

    return trimmed;
}

function readEnvString(
    envMap: Record<string, string>,
    ...keys: string[]
): string | undefined {
    for (const key of keys) {
        const normalized = normalizeEnvValue(envMap[key]);
        if (normalized !== undefined) {
            return normalized;
        }
    }
    return undefined;
}

function readEnvBoolean(
    envMap: Record<string, string>,
    ...keys: string[]
): boolean | undefined {
    const value = readEnvString(envMap, ...keys);
    if (value === undefined) return undefined;
    if (value === '') return undefined;

    const normalized = value.toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }
    return undefined;
}

function readEnvNumber(
    envMap: Record<string, string>,
    ...keys: string[]
): number | undefined {
    const value = readEnvString(envMap, ...keys);
    if (value === undefined || value === '') return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

function inferWizardModeFromProviderSelection(
    answers: Pick<
        WizardAnswers,
        | 'ssrAuthEnabled'
        | 'authProvider'
        | 'syncProvider'
        | 'storageProvider'
    >
): WizardMode {
    if (!answers.ssrAuthEnabled) {
        return 'personal-local';
    }
    if (
        answers.authProvider === 'basic-auth' &&
        answers.syncProvider === 'sqlite' &&
        answers.storageProvider === 'fs'
    ) {
        return 'preset-local';
    }

    if (
        answers.authProvider === 'clerk' &&
        answers.syncProvider === 'convex' &&
        answers.storageProvider === 'convex'
    ) {
        return 'preset-clerk-convex';
    }

    return 'custom';
}

function presetNameFromWizardMode(wizardMode: WizardMode): string | undefined {
    if (wizardMode === 'personal-local') return 'personal-local';
    if (isRecommendedSelfHostMode(wizardMode)) return 'recommended';
    if (wizardMode === 'preset-clerk-convex') return 'legacy-clerk-convex';
    return undefined;
}

/**
 * Maps existing `.env` values to wizard answer keys for pre-fill behavior.
 */
export function mapEnvToWizardAnswers(
    envMap: Record<string, string>
): Partial<WizardAnswers> {
    const mapped: Partial<WizardAnswers> = {};

    const assignString = (key: keyof WizardAnswers, ...envKeys: string[]) => {
        const value = readEnvString(envMap, ...envKeys);
        if (value !== undefined) {
            (mapped as Record<keyof WizardAnswers, unknown>)[key] = value;
        }
    };

    const assignBoolean = (key: keyof WizardAnswers, ...envKeys: string[]) => {
        const value = readEnvBoolean(envMap, ...envKeys);
        if (value !== undefined) {
            (mapped as Record<keyof WizardAnswers, unknown>)[key] = value;
        }
    };

    const assignNumber = (key: keyof WizardAnswers, ...envKeys: string[]) => {
        const value = readEnvNumber(envMap, ...envKeys);
        if (value !== undefined) {
            (mapped as Record<keyof WizardAnswers, unknown>)[key] = value;
        }
    };

    assignBoolean('ssrAuthEnabled', 'SSR_AUTH_ENABLED');
    assignString('authProvider', 'OR3_AUTH_PROVIDER', 'AUTH_PROVIDER');
    assignBoolean('guestAccessEnabled', 'OR3_GUEST_ACCESS_ENABLED');

    assignBoolean('syncEnabled', 'OR3_CLOUD_SYNC_ENABLED', 'OR3_SYNC_ENABLED');
    assignString('syncProvider', 'OR3_SYNC_PROVIDER');
    assignBoolean(
        'storageEnabled',
        'OR3_CLOUD_STORAGE_ENABLED',
        'OR3_STORAGE_ENABLED'
    );
    assignString('storageProvider', 'NUXT_PUBLIC_STORAGE_PROVIDER');

    assignString('or3SiteName', 'OR3_SITE_NAME');
    assignString('or3DefaultTheme', 'OR3_DEFAULT_THEME');
    assignString('or3LogoUrl', 'OR3_LOGO_URL');
    assignString('or3FaviconUrl', 'OR3_FAVICON_URL');

    assignBoolean('workflowsEnabled', 'OR3_WORKFLOWS_ENABLED');
    assignBoolean('documentsEnabled', 'OR3_DOCUMENTS_ENABLED');
    assignBoolean('backupEnabled', 'OR3_BACKUP_ENABLED');
    assignBoolean('mentionsEnabled', 'OR3_MENTIONS_ENABLED');
    assignBoolean('dashboardEnabled', 'OR3_DASHBOARD_ENABLED');

    assignString('basicAuthJwtSecret', 'OR3_BASIC_AUTH_JWT_SECRET');
    assignString('basicAuthRefreshSecret', 'OR3_BASIC_AUTH_REFRESH_SECRET');
    assignNumber('basicAuthAccessTtlSeconds', 'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS');
    assignNumber('basicAuthRefreshTtlSeconds', 'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS');
    assignString('basicAuthDbPath', 'OR3_BASIC_AUTH_DB_PATH');
    assignString('basicAuthBootstrapEmail', 'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL');
    assignString(
        'basicAuthBootstrapPassword',
        'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD'
    );

    assignString('clerkPublishableKey', 'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    assignString('clerkSecretKey', 'NUXT_CLERK_SECRET_KEY');

    assignString('sqliteDbPath', 'OR3_SQLITE_DB_PATH');
    assignString('sqlitePragmaJournalMode', 'OR3_SQLITE_PRAGMA_JOURNAL_MODE');
    assignString('sqlitePragmaSynchronous', 'OR3_SQLITE_PRAGMA_SYNCHRONOUS');
    assignBoolean('sqliteAllowInMemory', 'OR3_SQLITE_ALLOW_IN_MEMORY');
    assignBoolean('sqliteStrict', 'OR3_SQLITE_STRICT');

    assignBoolean('connectEnabled', 'OR3_CONNECT_ENABLED');
    assignString('connectProvider', 'OR3_CONNECT_PROVIDER');
    assignString('connectRelayProvider', 'OR3_CONNECT_RELAY_PROVIDER');
    assignString('connectPublicUrl', 'OR3_CONNECT_PUBLIC_URL');
    assignString('connectEncryptionKey', 'OR3_CONNECT_ENCRYPTION_KEY');
    assignNumber('connectMaxComputers', 'OR3_CONNECT_MAX_COMPUTERS');
    assignString(
        'connectCloudflareAccountId',
        'OR3_CONNECT_CLOUDFLARE_ACCOUNT_ID'
    );
    assignString(
        'connectCloudflareZoneId',
        'OR3_CONNECT_CLOUDFLARE_ZONE_ID'
    );
    assignString(
        'connectCloudflareApiToken',
        'OR3_CONNECT_CLOUDFLARE_API_TOKEN'
    );
    assignString(
        'connectCloudflareValidationAttestation',
        'OR3_CONNECT_CLOUDFLARE_VALIDATION_ATTESTATION'
    );
    assignString('connectHostnameSuffix', 'OR3_CONNECT_HOSTNAME_SUFFIX');

    assignString('convexUrl', 'VITE_CONVEX_URL');
    assignString('convexSelfHostedAdminKey', 'CONVEX_SELF_HOSTED_ADMIN_KEY');
    assignString('convexSelfHostedSiteUrl', 'VITE_CONVEX_SITE_URL');
    assignString('convexClerkIssuerUrl', 'CLERK_ISSUER_URL');
    assignString('convexAdminJwtSecret', 'OR3_ADMIN_JWT_SECRET');

    assignString('fsRoot', 'OR3_STORAGE_FS_ROOT');
    assignString('fsTokenSecret', 'OR3_STORAGE_FS_TOKEN_SECRET');
    assignNumber('fsUrlTtlSeconds', 'OR3_STORAGE_FS_URL_TTL_SECONDS');

    assignString('s3Endpoint', 'OR3_STORAGE_S3_ENDPOINT');
    assignString('s3Region', 'OR3_STORAGE_S3_REGION');
    assignString('s3Bucket', 'OR3_STORAGE_S3_BUCKET');
    assignString('s3AccessKeyId', 'OR3_STORAGE_S3_ACCESS_KEY_ID');
    assignString('s3SecretAccessKey', 'OR3_STORAGE_S3_SECRET_ACCESS_KEY');
    assignString('s3SessionToken', 'OR3_STORAGE_S3_SESSION_TOKEN');
    assignBoolean('s3ForcePathStyle', 'OR3_STORAGE_S3_FORCE_PATH_STYLE');
    assignString('s3KeyPrefix', 'OR3_STORAGE_S3_KEY_PREFIX');
    assignNumber('s3UrlTtlSeconds', 'OR3_STORAGE_S3_URL_TTL_SECONDS');
    assignBoolean('s3RequireChecksum', 'OR3_STORAGE_S3_REQUIRE_CHECKSUM');

    assignString('openrouterInstanceApiKey', 'OPENROUTER_API_KEY');
    assignBoolean(
        'openrouterAllowUserOverride',
        'OR3_OPENROUTER_ALLOW_USER_OVERRIDE'
    );
    assignBoolean('openrouterRequireUserKey', 'OR3_OPENROUTER_REQUIRE_USER_KEY');

    assignBoolean('limitsEnabled', 'OR3_LIMITS_ENABLED');
    assignNumber('requestsPerMinute', 'OR3_REQUESTS_PER_MINUTE');
    assignNumber('maxConversations', 'OR3_MAX_CONVERSATIONS');
    assignNumber('maxMessagesPerDay', 'OR3_MAX_MESSAGES_PER_DAY');
    assignString('limitsStorageProvider', 'OR3_LIMITS_STORAGE_PROVIDER');

    const allowedOrigins = readEnvString(envMap, 'OR3_ALLOWED_ORIGINS');
    if (allowedOrigins !== undefined) {
        mapped.allowedOrigins = allowedOrigins
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
    }

    assignBoolean('forceHttps', 'OR3_FORCE_HTTPS');
    assignBoolean('strictConfig', 'OR3_STRICT_CONFIG');
    assignBoolean('trustProxy', 'OR3_TRUST_PROXY');

    const forwardedHeader = readEnvString(envMap, 'OR3_FORWARDED_FOR_HEADER');
    if (
        forwardedHeader === 'x-forwarded-for' ||
        forwardedHeader === 'x-real-ip'
    ) {
        mapped.forwardedForHeader = forwardedHeader;
    }

    assignString('adminUsername', 'OR3_ADMIN_USERNAME');
    assignString('adminPassword', 'OR3_ADMIN_PASSWORD');

    return mapped;
}

/**
 * Creates a complete `WizardAnswers` object populated with sensible defaults.
 *
 * Behavior:
 * - When `presetName` is `'legacy-clerk-convex'` (or alias `'clerk-convex'`),
 *   providers default to Clerk + Convex + Convex instead of Basic Auth + SQLite + FS.
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
        existingEnv?: Record<string, string>;
    } = {
        instanceDir: process.cwd(),
    }
): WizardAnswers {
    const presetName = input.presetName ?? 'recommended';
    const wizardMode = inferWizardModeFromPresetName(presetName);
    const base: WizardAnswers = {
        cloudSetupEntry: false,
        targetAdvancedEnabled: false,
        instanceDir: input.instanceDir,
        envFile: input.envFile ?? '.env',
        deploymentTarget: 'local-dev',
        packageManager: detectPackageManager(),
        dockerExposure: 'private',
        publicDomain: '',
        dryRun: false,
        skipWriteBackup: false,
        presetName,
        wizardMode,
        allAdvancedEnabled: false,
        baseAdvancedEnabled: false,
        authAdvancedEnabled: false,
        syncAdvancedEnabled: false,
        storageAdvancedEnabled: false,
        cloudAdvancedEnabled: false,
        connectAdvancedEnabled: false,
        featuresAdvancedEnabled: false,
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
        connectEnabled: false,
        connectProvider: 'sqlite',
        connectRelayProvider: 'cloudflare',
        connectMaxComputers: 3,
        connectCloudflareAccountId: '',
        connectCloudflareZoneId: '',
        connectCloudflareValidationAttestation: '',
        storageEnabled: true,
        storageProvider: 'fs',
        fsRoot: defaultFsRoot(input.instanceDir),
        fsUrlTtlSeconds: 900,
        s3Endpoint: '',
        s3Region: 'us-east-1',
        s3Bucket: '',
        s3ForcePathStyle: false,
        s3KeyPrefix: '',
        s3UrlTtlSeconds: 900,
        s3RequireChecksum: false,
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
        adminUsername: 'admin',
    };

    const withModeDefaults = applyWizardModeDefaults(base, wizardMode);
    const envOverrides = mapEnvToWizardAnswers(input.existingEnv ?? {});
    const merged = {
        ...withModeDefaults,
        ...envOverrides,
    };

    const hasProviderOverride =
        envOverrides.ssrAuthEnabled !== undefined ||
        envOverrides.authProvider !== undefined ||
        envOverrides.syncProvider !== undefined ||
        envOverrides.storageProvider !== undefined;

    if (!hasProviderOverride) {
        return merged;
    }

    const inferredWizardMode = inferWizardModeFromProviderSelection(merged);
    return {
        ...merged,
        wizardMode: inferredWizardMode,
        presetName:
            presetNameFromWizardMode(inferredWizardMode) ?? merged.presetName,
    };
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
        wizardMode: 'preset-local',
        allAdvancedEnabled: false,
        baseAdvancedEnabled: false,
        authAdvancedEnabled: false,
        syncAdvancedEnabled: false,
        storageAdvancedEnabled: false,
        cloudAdvancedEnabled: false,
        connectAdvancedEnabled: false,
        authProvider: 'basic-auth',
        syncProvider: 'sqlite',
        storageProvider: 'fs',
        ssrAuthEnabled: true,
        syncEnabled: true,
        storageEnabled: true,
        connectEnabled: false,
        connectProvider: 'sqlite',
        deploymentTarget: 'local-dev',
    },
};

/**
 * Built-in preset for a private, browser-only installation.
 * It never enables accounts, remote access, sync, or server-side file storage.
 */
export const personalLocalPreset: WizardPreset = {
    name: 'personal-local',
    createdAt: new Date(0).toISOString(),
    answers: {
        presetName: 'personal-local',
        wizardMode: 'personal-local',
        allAdvancedEnabled: false,
        baseAdvancedEnabled: false,
        authAdvancedEnabled: false,
        syncAdvancedEnabled: false,
        storageAdvancedEnabled: false,
        cloudAdvancedEnabled: false,
        connectAdvancedEnabled: false,
        ssrAuthEnabled: false,
        syncEnabled: false,
        storageEnabled: false,
        connectEnabled: false,
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
        wizardMode: 'preset-clerk-convex',
        allAdvancedEnabled: false,
        baseAdvancedEnabled: false,
        authAdvancedEnabled: false,
        syncAdvancedEnabled: false,
        storageAdvancedEnabled: false,
        cloudAdvancedEnabled: false,
        connectAdvancedEnabled: false,
        authProvider: 'clerk',
        syncProvider: 'convex',
        storageProvider: 'convex',
        ssrAuthEnabled: true,
        syncEnabled: true,
        storageEnabled: true,
        connectEnabled: false,
        connectProvider: 'convex',
        deploymentTarget: 'local-dev',
    },
};
