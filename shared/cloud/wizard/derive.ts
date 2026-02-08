/**
 * @module shared/cloud/wizard/derive
 *
 * Purpose:
 * Maps `WizardAnswers` (camelCase) to `.env` key/value pairs (snake_case),
 * Convex backend env vars, and provider module IDs. This is the single
 * source of truth for answer-to-output transformation.
 *
 * Responsibilities:
 * - `deriveEnvFromAnswers()`: full derivation of env, convexEnv, and providerModules
 * - `deriveProviderModules()`: resolves selected providers to Nuxt module IDs
 * - `deriveWizardOwnedEnvUpdates()`: filters derived env to wizard-owned keys only
 *
 * Non-responsibilities:
 * - Validation (see validation.ts)
 * - File writing (see apply.ts)
 *
 * Constraints:
 * - Provider-scoped env vars are only emitted when the corresponding
 *   provider is actually selected (e.g. SQLite vars only when
 *   `syncProvider === 'sqlite'`).
 * - Convex backend env vars (`CLERK_ISSUER_URL`, `OR3_ADMIN_JWT_SECRET`)
 *   are only emitted for Clerk + Convex combinations.
 * - Local provider IDs are excluded from module ID generation.
 * - Both legacy and current env var names are emitted where aliases exist
 *   (e.g. `AUTH_PROVIDER` and `OR3_AUTH_PROVIDER`) for forward compatibility.
 *
 * @see WIZARD_OWNED_ENV_KEYS for the env var whitelist
 * @see deriveProviderModules for module ID resolution rules
 */
import { LOCAL_PROVIDER_IDS, WIZARD_OWNED_ENV_KEYS } from './catalog';
import type { WizardAnswers } from './types';

function boolToEnv(value: boolean | undefined): string | undefined {
    if (value === undefined) return undefined;
    return value ? 'true' : 'false';
}

function numberToEnv(value: number | undefined): string | undefined {
    if (value === undefined || Number.isNaN(value)) return undefined;
    return String(value);
}

function csv(value: string[] | undefined): string | undefined {
    if (!value || value.length === 0) return undefined;
    return value.join(',');
}

function setEnv(
    env: Record<string, string>,
    key: string,
    value: string | undefined
) {
    if (value === undefined || value === '') return;
    env[key] = value;
}

/**
 * Resolves selected provider IDs to Nuxt module paths.
 *
 * Behavior:
 * - Collects auth, sync, and storage provider IDs based on enable flags.
 * - Filters out local/non-package IDs (see `LOCAL_PROVIDER_IDS`).
 * - Maps each remaining ID to `or3-provider-${id}/nuxt`.
 * - Returns a sorted, deduplicated array.
 *
 * @example
 * ```ts
 * deriveProviderModules({ authProvider: 'basic-auth', syncProvider: 'sqlite', storageProvider: 'fs', ... })
 * // => ['or3-provider-basic-auth/nuxt', 'or3-provider-fs/nuxt', 'or3-provider-sqlite/nuxt']
 * ```
 */
export function deriveProviderModules(answers: WizardAnswers): string[] {
    const providerIds = new Set<string>();
    if (answers.ssrAuthEnabled) providerIds.add(answers.authProvider);
    if (answers.ssrAuthEnabled && answers.syncEnabled) {
        providerIds.add(answers.syncProvider);
    }
    if (answers.ssrAuthEnabled && answers.storageEnabled) {
        providerIds.add(answers.storageProvider);
    }

    return Array.from(providerIds)
        .map((providerId) => providerId.trim())
        .filter((providerId) => providerId.length > 0)
        .filter((providerId) => !LOCAL_PROVIDER_IDS.has(providerId))
        .map((providerId) => `or3-provider-${providerId}/nuxt`)
        .sort();
}

/**
 * Transforms a complete `WizardAnswers` into the three output artifacts:
 *
 * - `env`: key/value pairs for the OR3 `.env` file
 * - `convexEnv`: key/value pairs to set via `bunx convex env set` (Clerk + Convex only)
 * - `providerModules`: Nuxt module IDs for `or3.providers.generated.ts`
 *
 * Constraints:
 * - Only non-empty values are included (`setEnv` skips undefined/empty).
 * - Provider-scoped blocks are gated by provider selection.
 * - Boolean values are serialized as `'true'`/`'false'`.
 * - Arrays are serialized as comma-separated strings.
 */
export function deriveEnvFromAnswers(answers: WizardAnswers): {
    env: Record<string, string>;
    convexEnv: Record<string, string>;
    providerModules: string[];
} {
    const env: Record<string, string> = {};
    const convexEnv: Record<string, string> = {};

    setEnv(env, 'SSR_AUTH_ENABLED', boolToEnv(answers.ssrAuthEnabled));
    setEnv(env, 'AUTH_PROVIDER', answers.authProvider);
    // Alias for forward compatibility with future naming cleanup.
    setEnv(env, 'OR3_AUTH_PROVIDER', answers.authProvider);
    setEnv(env, 'OR3_GUEST_ACCESS_ENABLED', boolToEnv(answers.guestAccessEnabled));

    setEnv(env, 'OR3_SYNC_ENABLED', boolToEnv(answers.syncEnabled));
    setEnv(env, 'OR3_CLOUD_SYNC_ENABLED', boolToEnv(answers.syncEnabled));
    setEnv(env, 'OR3_SYNC_PROVIDER', answers.syncProvider);

    setEnv(env, 'OR3_STORAGE_ENABLED', boolToEnv(answers.storageEnabled));
    setEnv(env, 'OR3_CLOUD_STORAGE_ENABLED', boolToEnv(answers.storageEnabled));
    setEnv(env, 'NUXT_PUBLIC_STORAGE_PROVIDER', answers.storageProvider);

    setEnv(env, 'OR3_SITE_NAME', answers.or3SiteName);
    setEnv(env, 'OR3_DEFAULT_THEME', answers.or3DefaultTheme);
    setEnv(env, 'OR3_LOGO_URL', answers.or3LogoUrl);
    setEnv(env, 'OR3_FAVICON_URL', answers.or3FaviconUrl);

    setEnv(env, 'OR3_WORKFLOWS_ENABLED', boolToEnv(answers.workflowsEnabled));
    setEnv(env, 'OR3_DOCUMENTS_ENABLED', boolToEnv(answers.documentsEnabled));
    setEnv(env, 'OR3_BACKUP_ENABLED', boolToEnv(answers.backupEnabled));
    setEnv(env, 'OR3_MENTIONS_ENABLED', boolToEnv(answers.mentionsEnabled));
    setEnv(env, 'OR3_DASHBOARD_ENABLED', boolToEnv(answers.dashboardEnabled));

    setEnv(env, 'OPENROUTER_API_KEY', answers.openrouterInstanceApiKey);
    setEnv(
        env,
        'OR3_OPENROUTER_ALLOW_USER_OVERRIDE',
        boolToEnv(answers.openrouterAllowUserOverride)
    );
    setEnv(
        env,
        'OR3_OPENROUTER_REQUIRE_USER_KEY',
        boolToEnv(answers.openrouterRequireUserKey)
    );

    setEnv(env, 'OR3_LIMITS_ENABLED', boolToEnv(answers.limitsEnabled));
    setEnv(env, 'OR3_REQUESTS_PER_MINUTE', numberToEnv(answers.requestsPerMinute));
    setEnv(env, 'OR3_MAX_CONVERSATIONS', numberToEnv(answers.maxConversations));
    setEnv(env, 'OR3_MAX_MESSAGES_PER_DAY', numberToEnv(answers.maxMessagesPerDay));
    setEnv(env, 'OR3_LIMITS_STORAGE_PROVIDER', answers.limitsStorageProvider);

    setEnv(env, 'OR3_ALLOWED_ORIGINS', csv(answers.allowedOrigins));
    setEnv(env, 'OR3_FORCE_HTTPS', boolToEnv(answers.forceHttps));
    setEnv(env, 'OR3_STRICT_CONFIG', boolToEnv(answers.strictConfig));
    setEnv(env, 'OR3_TRUST_PROXY', boolToEnv(answers.trustProxy));
    setEnv(env, 'OR3_FORWARDED_FOR_HEADER', answers.forwardedForHeader);

    if (answers.authProvider === 'basic-auth') {
        setEnv(env, 'OR3_BASIC_AUTH_JWT_SECRET', answers.basicAuthJwtSecret);
        setEnv(env, 'OR3_BASIC_AUTH_REFRESH_SECRET', answers.basicAuthRefreshSecret);
        setEnv(
            env,
            'OR3_BASIC_AUTH_ACCESS_TTL_SECONDS',
            numberToEnv(answers.basicAuthAccessTtlSeconds)
        );
        setEnv(
            env,
            'OR3_BASIC_AUTH_REFRESH_TTL_SECONDS',
            numberToEnv(answers.basicAuthRefreshTtlSeconds)
        );
        setEnv(env, 'OR3_BASIC_AUTH_DB_PATH', answers.basicAuthDbPath);
        setEnv(
            env,
            'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL',
            answers.basicAuthBootstrapEmail
        );
        setEnv(
            env,
            'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD',
            answers.basicAuthBootstrapPassword
        );
    }

    if (answers.authProvider === 'clerk') {
        setEnv(
            env,
            'NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
            answers.clerkPublishableKey
        );
        setEnv(env, 'NUXT_CLERK_SECRET_KEY', answers.clerkSecretKey);
    }

    if (answers.syncProvider === 'sqlite') {
        setEnv(env, 'OR3_SQLITE_DB_PATH', answers.sqliteDbPath);
        setEnv(
            env,
            'OR3_SQLITE_PRAGMA_JOURNAL_MODE',
            answers.sqlitePragmaJournalMode
        );
        setEnv(
            env,
            'OR3_SQLITE_PRAGMA_SYNCHRONOUS',
            answers.sqlitePragmaSynchronous
        );
        setEnv(
            env,
            'OR3_SQLITE_ALLOW_IN_MEMORY',
            boolToEnv(answers.sqliteAllowInMemory)
        );
        setEnv(env, 'OR3_SQLITE_STRICT', boolToEnv(answers.sqliteStrict));
    }

    if (answers.syncProvider === 'convex' || answers.storageProvider === 'convex') {
        setEnv(env, 'VITE_CONVEX_URL', answers.convexUrl);
        setEnv(
            env,
            'CONVEX_SELF_HOSTED_ADMIN_KEY',
            answers.convexSelfHostedAdminKey
        );
    }

    if (answers.storageProvider === 'fs') {
        setEnv(env, 'OR3_STORAGE_FS_ROOT', answers.fsRoot);
        setEnv(env, 'OR3_STORAGE_FS_TOKEN_SECRET', answers.fsTokenSecret);
        setEnv(
            env,
            'OR3_STORAGE_FS_URL_TTL_SECONDS',
            numberToEnv(answers.fsUrlTtlSeconds)
        );
    }

    if (
        answers.authProvider === 'clerk' &&
        (answers.syncProvider === 'convex' || answers.storageProvider === 'convex')
    ) {
        setEnv(convexEnv, 'CLERK_ISSUER_URL', answers.convexClerkIssuerUrl);
        setEnv(convexEnv, 'OR3_ADMIN_JWT_SECRET', answers.convexAdminJwtSecret);
    }

    const providerModules = deriveProviderModules(answers);
    return { env, convexEnv, providerModules };
}

/**
 * Filters a derived env map to only wizard-owned keys.
 * Keys present in `WIZARD_OWNED_ENV_KEYS` but absent from the env map
 * are set to `null`, indicating they should be removed from the env file.
 * This ensures non-destructive merge behavior.
 */
export function deriveWizardOwnedEnvUpdates(
    env: Record<string, string>
): Record<string, string | null> {
    const updates: Record<string, string | null> = {};
    for (const key of WIZARD_OWNED_ENV_KEYS) {
        updates[key] = env[key] ?? null;
    }
    return updates;
}
