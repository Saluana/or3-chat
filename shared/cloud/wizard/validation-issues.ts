import type { WizardAnswers, WizardValidationIssue } from './types';

type FieldRule = {
    field: keyof WizardAnswers;
    stepId: string;
    patterns: readonly string[];
};

const FIELD_RULES: readonly FieldRule[] = [
    { field: 'instanceDir', stepId: 'target', patterns: ['INSTANCEDIR', 'PROJECT FOLDER'] },
    { field: 'publicDomain', stepId: 'target', patterns: ['PUBLIC DOMAIN', 'OR3_PUBLIC_DOMAIN'] },
    { field: 'or3SiteName', stepId: 'branding', patterns: ['OR3_SITE_NAME'] },
    { field: 'or3DefaultTheme', stepId: 'themes', patterns: ['OR3_DEFAULT_THEME'] },
    { field: 'basicAuthJwtSecret', stepId: 'provider-auth', patterns: ['OR3_BASIC_AUTH_JWT_SECRET'] },
    { field: 'basicAuthBootstrapEmail', stepId: 'provider-auth', patterns: ['OR3_BASIC_AUTH_BOOTSTRAP_EMAIL'] },
    { field: 'basicAuthBootstrapPassword', stepId: 'provider-auth', patterns: ['OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD'] },
    { field: 'clerkPublishableKey', stepId: 'provider-auth', patterns: ['NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] },
    { field: 'clerkSecretKey', stepId: 'provider-auth', patterns: ['NUXT_CLERK_SECRET_KEY'] },
    { field: 'sqliteDriver', stepId: 'provider-sync', patterns: ['OR3_SQLITE_DRIVER'] },
    { field: 'sqliteDbPath', stepId: 'provider-sync', patterns: ['OR3_SQLITE_DB_PATH'] },
    { field: 'sqliteTursoUrl', stepId: 'provider-sync', patterns: ['OR3_SQLITE_TURSO_URL'] },
    { field: 'sqliteTursoAuthToken', stepId: 'provider-sync', patterns: ['OR3_SQLITE_TURSO_AUTH_TOKEN'] },
    { field: 'sqliteD1Binding', stepId: 'provider-sync', patterns: ['OR3_SQLITE_D1_BINDING'] },
    { field: 'convexUrl', stepId: 'provider-sync', patterns: ['VITE_CONVEX_URL'] },
    { field: 'convexSelfHostedAdminKey', stepId: 'provider-sync', patterns: ['CONVEX SERVER DEPLOYMENT KEY'] },
    { field: 'connectPublicUrl', stepId: 'connect', patterns: ['OR3_CONNECT_PUBLIC_URL'] },
    { field: 'connectEncryptionKey', stepId: 'connect', patterns: ['OR3_CONNECT_ENCRYPTION_KEY'] },
    { field: 'connectMaxComputers', stepId: 'connect', patterns: ['OR3_CONNECT_MAX_COMPUTERS'] },
    { field: 'connectCloudflareApiToken', stepId: 'connect', patterns: ['OR3_CONNECT_CLOUDFLARE_API_TOKEN'] },
    { field: 'connectHostnameSuffix', stepId: 'connect', patterns: ['OR3_CONNECT_HOSTNAME_SUFFIX'] },
    { field: 'fsRoot', stepId: 'provider-storage', patterns: ['OR3_STORAGE_FS_ROOT'] },
    { field: 'fsTokenSecret', stepId: 'provider-storage', patterns: ['OR3_STORAGE_FS_TOKEN_SECRET'] },
    { field: 's3Endpoint', stepId: 'provider-storage', patterns: ['OR3_STORAGE_S3_ENDPOINT'] },
    { field: 's3Region', stepId: 'provider-storage', patterns: ['OR3_STORAGE_S3_REGION'] },
    { field: 's3Bucket', stepId: 'provider-storage', patterns: ['OR3_STORAGE_S3_BUCKET'] },
    { field: 's3AccessKeyId', stepId: 'provider-storage', patterns: ['OR3_STORAGE_S3_ACCESS_KEY_ID'] },
    { field: 's3SecretAccessKey', stepId: 'provider-storage', patterns: ['OR3_STORAGE_S3_SECRET_ACCESS_KEY'] },
    { field: 'openrouterInstanceApiKey', stepId: 'openrouter-limits-security', patterns: ['OPENROUTER_API_KEY'] },
    { field: 'openrouterAllowUserOverride', stepId: 'openrouter-limits-security', patterns: ['OR3_OPENROUTER_ALLOW_USER_OVERRIDE'] },
    { field: 'openrouterRequireUserKey', stepId: 'openrouter-limits-security', patterns: ['OR3_OPENROUTER_REQUIRE_USER_KEY'] },
    { field: 'requestsPerMinute', stepId: 'openrouter-limits-security', patterns: ['OR3_REQUESTS_PER_MINUTE'] },
    { field: 'maxConversations', stepId: 'openrouter-limits-security', patterns: ['OR3_MAX_CONVERSATIONS'] },
    { field: 'maxMessagesPerDay', stepId: 'openrouter-limits-security', patterns: ['OR3_MAX_MESSAGES_PER_DAY'] },
    { field: 'allowedOrigins', stepId: 'openrouter-limits-security', patterns: ['OR3_ALLOWED_ORIGINS'] },
    { field: 'trustProxy', stepId: 'openrouter-limits-security', patterns: ['OR3_TRUST_PROXY'] },
    { field: 'forwardedForHeader', stepId: 'openrouter-limits-security', patterns: ['OR3_FORWARDED_FOR_HEADER'] },
    { field: 'strictConfig', stepId: 'openrouter-limits-security', patterns: ['OR3_STRICT_CONFIG'] },
    { field: 'adminUsername', stepId: 'admin-dashboard', patterns: ['OR3_ADMIN_USERNAME'] },
    { field: 'adminPassword', stepId: 'admin-dashboard', patterns: ['OR3_ADMIN_PASSWORD'] },
];

const STEP_RULES: ReadonlyArray<{ stepId: string; patterns: readonly string[] }> = [
    { stepId: 'target', patterns: ['ENV'] },
    { stepId: 'branding', patterns: ['OR3_LOGO_URL', 'OR3_FAVICON_URL'] },
    { stepId: 'providers', patterns: ['SSR_AUTH_ENABLED', 'AUTH_PROVIDER', 'OR3_AUTH_PROVIDER', 'OR3_SYNC_PROVIDER', 'NUXT_PUBLIC_STORAGE_PROVIDER', 'OR3_CLOUD_SYNC_ENABLED', 'OR3_CLOUD_STORAGE_ENABLED'] },
    { stepId: 'provider-auth', patterns: ['OR3_BASIC_AUTH_', 'NUXT_PUBLIC_CLERK_', 'NUXT_CLERK_SECRET_'] },
    { stepId: 'provider-sync', patterns: ['OR3_SQLITE_', 'VITE_CONVEX_URL', 'CONVEX_SELF_HOSTED_'] },
    { stepId: 'provider-storage', patterns: ['OR3_STORAGE_FS_', 'OR3_STORAGE_S3_'] },
    { stepId: 'connect', patterns: ['OR3_CONNECT_'] },
    { stepId: 'openrouter-limits-security', patterns: ['OPENROUTER_', 'OR3_OPENROUTER_'] },
    { stepId: 'convex-env', patterns: ['CLERK_ISSUER_URL', 'OR3_ADMIN_JWT_SECRET'] },
];

/** Attach stable wizard field and step identifiers to validation messages once. */
export function createWizardValidationIssues(
    errors: readonly string[],
): WizardValidationIssue[] {
    return errors.map((message) => {
        const normalized = message.toUpperCase();
        const fieldRule = FIELD_RULES.find((rule) =>
            rule.patterns.some((pattern) => normalized.includes(pattern)),
        );
        if (fieldRule) {
            return { message, field: fieldRule.field, stepId: fieldRule.stepId };
        }
        const stepRule = STEP_RULES.find((rule) =>
            rule.patterns.some((pattern) => normalized.includes(pattern)),
        );
        return stepRule ? { message, stepId: stepRule.stepId } : { message };
    });
}
