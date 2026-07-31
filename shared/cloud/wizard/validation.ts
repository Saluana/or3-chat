/**
 * @module shared/cloud/wizard/validation
 *
 * Purpose:
 * Two-tier validation for wizard answers: fast field-level checks
 * followed by authoritative config builder validation.
 *
 * Responsibilities:
 * - Field-level validation (required fields, format checks, cross-field rules)
 * - Authoritative validation via `buildOr3ConfigFromEnv()` and
 *   `buildOr3CloudConfigFromEnv()` to prevent drift from runtime config rules
 * - Redacted summary generation for the review step
 * - Secret sanitization for session persistence
 *
 * Non-responsibilities:
 * - Per-field validators attached to `WizardField.validate` (those run in
 *   the CLI/UI layer, not here)
 * - Env file writing (see apply.ts)
 *
 * Constraints:
 * - Strict mode defaults to `true` when `OR3_STRICT_CONFIG` is set,
 *   deploy target is production, or `NODE_ENV === 'production'`.
 *   Can be overridden via `options.strict`.
 * - Secret values are never included in error messages.
 * - Authoritative validation catches errors from config builders and
 *   appends them to the errors array (does not throw).
 *
 * @see server/admin/config/resolve-config.ts for authoritative config builders
 * @see buildRedactedSummary for review output format
 */
import { isAbsolute } from 'node:path';
import {
    buildOr3CloudConfigFromEnv,
    buildOr3ConfigFromEnv,
} from '../../../server/admin/config/resolve-config';
import {
    applySkippedAdvancedDefaults,
    normalizeAdvancedToggles,
    SECRET_ANSWER_KEYS,
} from './catalog';
import {
    ADMIN_USERNAME_MIN_LENGTH,
    formatAdminPasswordPolicyFailure,
    getAdminPasswordPolicyFailures,
} from './admin-dashboard';
import { deriveEnvFromAnswers } from './derive';
import { resolveEffectiveConnectProvider } from './connect-provider';
import { validateCloudflareValidationAttestation } from './cloudflare-attestation';
import type { WizardAnswers, WizardValidationResult } from './types';

function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseUrl(value: string): boolean {
    try {
        void new URL(value);
        return true;
    } catch {
        return false;
    }
}

function isValidPublicHostname(value: string): boolean {
    const normalized = value.toLowerCase();
    const labels = value.split('.');
    const privateSuffixes = ['localhost', 'local', 'internal', 'home.arpa'];
    if (
        value.length > 253 ||
        value.includes('://') ||
        value.includes('/') ||
        value !== value.trim() ||
        labels.length < 2 ||
        /^\d+(?:\.\d+){3}$/.test(value) ||
        /^\d+$/.test(labels.at(-1) ?? '') ||
        privateSuffixes.some(
            (suffix) =>
                normalized === suffix || normalized.endsWith(`.${suffix}`)
        )
    ) {
        return false;
    }
    return labels.every(
        (label) =>
            label.length > 0 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
}

function isSecretLikeKey(key: string): boolean {
    return /(SECRET|KEY|TOKEN|PASSWORD|ATTESTATION)/i.test(key);
}

function redactValue(key: string, value: string): string {
    if (isSecretLikeKey(key)) return '<redacted>';
    return value;
}

/**
 * Generates a human-readable, redacted summary of what would be written.
 *
 * Behavior:
 * - Derives env and Convex env from answers.
 * - Redacts any key containing `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, or
 *   `ATTESTATION`.
 * - Groups output into "OR3 .env", "Convex backend env", and
 *   "Provider modules" sections.
 *
 * @example
 * ```ts
 * const summary = buildRedactedSummary(answers);
 * // OR3 .env
 * // OR3_BASIC_AUTH_JWT_SECRET=<redacted>
 * // OR3_SITE_NAME=My App
 * // ...
 * ```
 */
export function buildRedactedSummary(answers: WizardAnswers): string {
    const effectiveAnswers = applySkippedAdvancedDefaults(
        normalizeAdvancedToggles(answers)
    );
    const { env, convexEnv, providerModules } = deriveEnvFromAnswers(
        effectiveAnswers
    );
    const envLines = Object.keys(env)
        .sort()
        .map((key) => `${key}=${redactValue(key, env[key] ?? '')}`);
    const convexLines = Object.keys(convexEnv)
        .sort()
        .map((key) => `${key}=${redactValue(key, convexEnv[key] ?? '')}`);

    const sections: string[] = [
        'OR3 .env',
        envLines.length > 0 ? envLines.join('\n') : '(no env updates)',
        '',
        'Convex backend env',
        convexLines.length > 0 ? convexLines.join('\n') : '(none)',
        '',
        'Provider modules',
        providerModules.length > 0 ? providerModules.join('\n') : '(none)',
    ];

    return sections.join('\n');
}

function validateFieldLevel(answers: WizardAnswers): {
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [];
    const warnings: string[] = [];
    const usesConvex =
        (answers.syncEnabled && answers.syncProvider === 'convex') ||
        (answers.storageEnabled && answers.storageProvider === 'convex') ||
        (answers.connectEnabled &&
            resolveEffectiveConnectProvider(answers) === 'convex');

    if (!answers.instanceDir.trim()) {
        errors.push('instanceDir is required.');
    }

    if (!answers.or3SiteName.trim()) {
        errors.push('OR3 site name is required.');
    }

    if (
        answers.deploymentTarget === 'docker' &&
        answers.dockerExposure === 'public'
    ) {
        const domain = answers.publicDomain?.trim() ?? '';
        if (!domain) {
            errors.push('A public domain is required for public Docker mode.');
        } else if (!isValidPublicHostname(domain)) {
            errors.push(
                'Public domain must be a hostname such as chat.example.com.'
            );
        }
    }

    if (answers.ssrAuthEnabled && answers.authProvider === 'basic-auth') {
        const jwtSecret = answers.basicAuthJwtSecret?.trim() ?? '';
        if (!jwtSecret) {
            errors.push('OR3_BASIC_AUTH_JWT_SECRET is required for basic-auth.');
        } else if (jwtSecret.length < 32) {
            warnings.push(
                'OR3_BASIC_AUTH_JWT_SECRET should be at least 32 characters.'
            );
        }

        const email = answers.basicAuthBootstrapEmail?.trim() ?? '';
        const password = answers.basicAuthBootstrapPassword?.trim() ?? '';
        if (!email || !password) {
            errors.push(
                'OR3_BASIC_AUTH_BOOTSTRAP_EMAIL and OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD are required for basic-auth.'
            );
        } else if (!isEmail(email)) {
            errors.push('OR3_BASIC_AUTH_BOOTSTRAP_EMAIL must be a valid email.');
        } else if (password.length < 12) {
            errors.push(
                'OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD must be at least 12 characters.'
            );
        } else {
            // Check password complexity
            if (!/[A-Z]/.test(password)) {
                errors.push('OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD must contain at least one uppercase letter.');
            }
            if (!/[a-z]/.test(password)) {
                errors.push('OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD must contain at least one lowercase letter.');
            }
            if (!/[0-9]/.test(password)) {
                errors.push('OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD must contain at least one number.');
            }
        }

        if (!answers.basicAuthDbPath.trim()) {
            errors.push('OR3_BASIC_AUTH_DB_PATH is required for basic-auth.');
        }
    }

    if (answers.ssrAuthEnabled && answers.authProvider === 'clerk') {
        const pk = answers.clerkPublishableKey?.trim() ?? '';
        const sk = answers.clerkSecretKey?.trim() ?? '';
        if (!pk) errors.push('NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required for Clerk.');
        if (!sk) errors.push('NUXT_CLERK_SECRET_KEY is required for Clerk.');

        if (pk && !pk.startsWith('pk_')) {
            warnings.push('Clerk publishable key usually starts with "pk_".');
        }
        if (sk && !sk.startsWith('sk_')) {
            warnings.push('Clerk secret key usually starts with "sk_".');
        }
    }

    if (answers.ssrAuthEnabled && answers.syncEnabled && answers.syncProvider === 'sqlite') {
        const sqlitePath = answers.sqliteDbPath?.trim() ?? '';
        if (!sqlitePath) errors.push('OR3_SQLITE_DB_PATH is required for sqlite sync.');
    }

    if (answers.connectEnabled) {
        if (!answers.ssrAuthEnabled) {
            errors.push(
                'OR3_CONNECT_ENABLED requires SSR_AUTH_ENABLED=true because remote computers are owned by signed-in accounts.'
            );
        }

        const publicUrl = answers.connectPublicUrl?.trim() ?? '';
        if (!publicUrl) {
            errors.push('OR3_CONNECT_PUBLIC_URL is required when OR3 Connect is enabled.');
        } else if (!parseUrl(publicUrl)) {
            errors.push('OR3_CONNECT_PUBLIC_URL must be a valid URL.');
        } else {
            const parsed = new URL(publicUrl);
            if (parsed.protocol !== 'https:') {
                const message = 'OR3_CONNECT_PUBLIC_URL must use HTTPS for remote access.';
                if (
                    answers.deploymentTarget === 'prod-build' ||
                    answers.deploymentTarget === 'docker'
                ) {
                    errors.push(message);
                } else {
                    warnings.push(message);
                }
            }
        }

        const encryptionKey = answers.connectEncryptionKey?.trim() ?? '';
        if (!encryptionKey) {
            errors.push(
                'OR3_CONNECT_ENCRYPTION_KEY is required when OR3 Connect is enabled.'
            );
        } else if (encryptionKey.length < 32) {
            errors.push('OR3_CONNECT_ENCRYPTION_KEY must be at least 32 characters.');
        }

        if (!Number.isInteger(answers.connectMaxComputers)) {
            errors.push('OR3_CONNECT_MAX_COMPUTERS must be an integer.');
        } else if (
            answers.connectMaxComputers < 1 ||
            answers.connectMaxComputers > 100
        ) {
            errors.push('OR3_CONNECT_MAX_COMPUTERS must be between 1 and 100.');
        }

        if (answers.connectRelayProvider === 'cloudflare') {
            const apiToken = answers.connectCloudflareApiToken?.trim() ?? '';
            const hostname = answers.connectHostnameSuffix?.trim() ?? '';
            if (!apiToken) {
                errors.push(
                    'OR3_CONNECT_CLOUDFLARE_API_TOKEN is required for the Cloudflare relay.'
                );
            }
            if (!hostname) {
                errors.push(
                    'OR3_CONNECT_HOSTNAME_SUFFIX is required for the Cloudflare relay.'
                );
            } else if (
                hostname.includes('://') ||
                hostname.includes('/') ||
                !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname)
            ) {
                errors.push(
                    'OR3_CONNECT_HOSTNAME_SUFFIX must be a hostname such as connect.example.com.'
                );
            }
            if (apiToken && hostname) {
                const attestation = validateCloudflareValidationAttestation({
                    attestation:
                        answers.connectCloudflareValidationAttestation,
                    config: {
                        accountId: answers.connectCloudflareAccountId,
                        zoneId: answers.connectCloudflareZoneId,
                        apiToken,
                        hostnameSuffix: hostname,
                    },
                });
                if (!attestation.valid) {
                    warnings.push(
                        'Cloudflare tunnel and DNS permissions will be verified automatically before settings are applied.'
                    );
                }
            }
        }
    }

    const needsConvexUrl = answers.ssrAuthEnabled && usesConvex;
    if (needsConvexUrl) {
        const url = answers.convexUrl?.trim() ?? '';
        if (!url) {
            errors.push('VITE_CONVEX_URL is required when Convex provider is selected.');
        } else if (!parseUrl(url)) {
            errors.push('VITE_CONVEX_URL must be a valid URL.');
        }
        if (!(answers.convexSelfHostedAdminKey?.trim() ?? '')) {
            errors.push(
                'A Convex server deployment key is required for internal OR3 server operations.'
            );
        }
    }

    if (answers.ssrAuthEnabled && answers.storageEnabled && answers.storageProvider === 'fs') {
        const fsRoot = answers.fsRoot?.trim() ?? '';
        if (!fsRoot) {
            errors.push('OR3_STORAGE_FS_ROOT is required for fs storage.');
        } else if (!isAbsolute(fsRoot)) {
            errors.push('OR3_STORAGE_FS_ROOT must be an absolute path.');
        }

        const tokenSecret = answers.fsTokenSecret?.trim() ?? '';
        if (!tokenSecret) {
            errors.push('OR3_STORAGE_FS_TOKEN_SECRET is required for fs storage.');
        } else if (tokenSecret.length < 32) {
            warnings.push(
                'OR3_STORAGE_FS_TOKEN_SECRET should be at least 32 characters.'
            );
        }
    }

    if (answers.ssrAuthEnabled && answers.storageEnabled && answers.storageProvider === 's3') {
        const endpoint = answers.s3Endpoint?.trim() ?? '';
        if (endpoint && !parseUrl(endpoint)) {
            errors.push('OR3_STORAGE_S3_ENDPOINT must be a valid URL when provided.');
        }

        const region = answers.s3Region?.trim() ?? '';
        if (!region) {
            errors.push('OR3_STORAGE_S3_REGION is required for s3 storage.');
        }

        const bucket = answers.s3Bucket?.trim() ?? '';
        if (!bucket) {
            errors.push('OR3_STORAGE_S3_BUCKET is required for s3 storage.');
        }

        const accessKeyId = answers.s3AccessKeyId?.trim() ?? '';
        const secretAccessKey = answers.s3SecretAccessKey?.trim() ?? '';
        if (!accessKeyId) {
            errors.push('OR3_STORAGE_S3_ACCESS_KEY_ID is required for s3 storage.');
        }
        if (!secretAccessKey) {
            errors.push('OR3_STORAGE_S3_SECRET_ACCESS_KEY is required for s3 storage.');
        }

        if (!Number.isInteger(answers.s3UrlTtlSeconds)) {
            errors.push('OR3_STORAGE_S3_URL_TTL_SECONDS must be an integer.');
        } else if (answers.s3UrlTtlSeconds < 1 || answers.s3UrlTtlSeconds > 24 * 60 * 60) {
            errors.push('OR3_STORAGE_S3_URL_TTL_SECONDS must be between 1 and 86400.');
        }
    }

    if (
        answers.openrouterRequireUserKey &&
        !answers.openrouterAllowUserOverride
    ) {
        errors.push(
            'OR3_OPENROUTER_REQUIRE_USER_KEY=true requires OR3_OPENROUTER_ALLOW_USER_OVERRIDE=true.'
        );
    }

    if (
        !answers.openrouterAllowUserOverride &&
        !(answers.openrouterInstanceApiKey?.trim() ?? '')
    ) {
        errors.push(
            'OPENROUTER_API_KEY is required when OR3_OPENROUTER_ALLOW_USER_OVERRIDE=false.'
        );
    }

    if (
        answers.ssrAuthEnabled &&
        answers.authProvider === 'clerk' &&
        usesConvex
    ) {
        if (!answers.convexClerkIssuerUrl?.trim()) {
            warnings.push(
                'CLERK_ISSUER_URL is required in Convex backend env for Clerk + Convex.'
            );
        }
        if (!answers.convexAdminJwtSecret?.trim()) {
            warnings.push(
                'OR3_ADMIN_JWT_SECRET is required in Convex backend env for Clerk + Convex.'
            );
        }
    }

    // Admin dashboard credentials
    if (answers.ssrAuthEnabled) {
        const adminUser = answers.adminUsername?.trim() ?? '';
        const adminPass = answers.adminPassword?.trim() ?? '';
        if (!adminUser || !adminPass) {
            errors.push(
                'OR3_ADMIN_USERNAME and OR3_ADMIN_PASSWORD are required when SSR auth is enabled.'
            );
        } else {
            if (adminUser.length < ADMIN_USERNAME_MIN_LENGTH) {
                warnings.push(
                    `OR3_ADMIN_USERNAME should be at least ${ADMIN_USERNAME_MIN_LENGTH} characters.`
                );
            }
            for (const failure of getAdminPasswordPolicyFailures(adminPass)) {
                warnings.push(
                    formatAdminPasswordPolicyFailure(failure, {
                        label: 'OR3_ADMIN_PASSWORD',
                        verb: 'should',
                    })
                );
            }
        }
    }

    if (answers.limitsEnabled) {
        if (answers.requestsPerMinute < 1) {
            errors.push('OR3_REQUESTS_PER_MINUTE must be >= 1.');
        }
        if (answers.maxConversations < 0) {
            errors.push('OR3_MAX_CONVERSATIONS must be >= 0.');
        }
        if (answers.maxMessagesPerDay < 0) {
            errors.push('OR3_MAX_MESSAGES_PER_DAY must be >= 0.');
        }
    }

    return { errors, warnings };
}

/**
 * Strips secret fields from an answers object for safe persistence.
 * When `includeSecrets` is true, returns the original object unchanged.
 */
export function sanitizeAnswersForSession(
    answers: Partial<WizardAnswers>,
    includeSecrets: boolean
): Partial<WizardAnswers> {
    if (includeSecrets) return answers;
    const sanitized: Partial<WizardAnswers> = { ...answers };
    for (const key of SECRET_ANSWER_KEYS) {
        delete sanitized[key];
    }
    return sanitized;
}

/**
 * Extracts only the secret fields from an answers object.
 * Used to populate the transient in-memory secret store.
 */
export function pickSecretAnswers(
    answers: Partial<WizardAnswers>
): Partial<WizardAnswers> {
    const secretAnswers: Partial<WizardAnswers> = {};
    for (const key of SECRET_ANSWER_KEYS) {
        const value = answers[key];
        if (value !== undefined) {
            secretAnswers[key] = value as never;
        }
    }
    return secretAnswers;
}

/**
 * Runs the full two-tier validation pipeline on a complete answer set.
 *
 * Behavior:
 * 1. Field-level validation: required fields, format checks, cross-field rules.
 * 2. Env derivation via `deriveEnvFromAnswers()`.
 * 3. Authoritative validation via `buildOr3ConfigFromEnv()` and
 *    `buildOr3CloudConfigFromEnv()` with strict mode control.
 *
 * Constraints:
 * - Strict mode defaults to production-oriented deployment targets or `NODE_ENV === 'production'`.
 * - Config builder errors are caught and appended as error strings.
 * - Returns `ok: true` only when `errors` is empty.
 *
 * @throws Never throws. All errors are captured in the result.
 */
export function validateAnswers(
    answers: WizardAnswers,
    options: {
        strict?: boolean;
    } = {}
): WizardValidationResult {
    const effectiveAnswers = applySkippedAdvancedDefaults(
        normalizeAdvancedToggles(answers)
    );
    const { errors, warnings } = validateFieldLevel(effectiveAnswers);
    const derived = deriveEnvFromAnswers(effectiveAnswers);
    const strict =
        options.strict ??
        (effectiveAnswers.strictConfig ||
            effectiveAnswers.deploymentTarget === 'prod-build' ||
            effectiveAnswers.deploymentTarget === 'docker' ||
            process.env.NODE_ENV === 'production');

    try {
        buildOr3ConfigFromEnv(derived.env);
    } catch (error) {
        errors.push((error as Error).message);
    }

    try {
        buildOr3CloudConfigFromEnv(derived.env, { strict });
    } catch (error) {
        errors.push((error as Error).message);
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        derived,
    };
}

/**
 * Formats validation errors into a human-readable bullet list for CLI output.
 * Returns `'Validation passed.'` when there are no errors.
 */
export function summarizeValidationErrors(result: WizardValidationResult): string {
    if (result.ok) {
        return 'Validation passed.';
    }
    return result.errors
        .map((error) => {
            if (error.includes('\n')) return error;
            return `- ${error}`;
        })
        .join('\n');
}
