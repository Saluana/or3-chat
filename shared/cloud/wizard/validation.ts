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
import { SECRET_ANSWER_KEYS } from './catalog';
import { deriveEnvFromAnswers } from './derive';
import type { WizardAnswers, WizardValidationResult } from './types';

function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseUrl(value: string): boolean {
    try {
        // eslint-disable-next-line no-new
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function isSecretLikeKey(key: string): boolean {
    return /(SECRET|KEY|TOKEN|PASSWORD)/i.test(key);
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
 * - Redacts any key containing `SECRET`, `KEY`, `TOKEN`, or `PASSWORD`.
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
    const { env, convexEnv, providerModules } = deriveEnvFromAnswers(answers);
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
        (answers.storageEnabled && answers.storageProvider === 'convex');

    if (!answers.instanceDir.trim()) {
        errors.push('instanceDir is required.');
    }

    if (!answers.or3SiteName.trim()) {
        errors.push('OR3 site name is required.');
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

        if (!answers.basicAuthDbPath?.trim()) {
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

    const needsConvexUrl = answers.ssrAuthEnabled && usesConvex;
    if (needsConvexUrl) {
        const url = answers.convexUrl?.trim() ?? '';
        if (!url) {
            errors.push('VITE_CONVEX_URL is required when Convex provider is selected.');
        } else if (!parseUrl(url)) {
            errors.push('VITE_CONVEX_URL must be a valid URL.');
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
        (answers.syncProvider === 'convex' || answers.storageProvider === 'convex')
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

    if (answers.requestsPerMinute < 1) {
        errors.push('OR3_REQUESTS_PER_MINUTE must be >= 1.');
    }
    if (answers.maxConversations < 0) {
        errors.push('OR3_MAX_CONVERSATIONS must be >= 0.');
    }
    if (answers.maxMessagesPerDay < 0) {
        errors.push('OR3_MAX_MESSAGES_PER_DAY must be >= 0.');
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
 * - Strict mode defaults to `answers.strictConfig || answers.deploymentTarget === 'prod-build' || NODE_ENV === 'production'`.
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
    const { errors, warnings } = validateFieldLevel(answers);
    const derived = deriveEnvFromAnswers(answers);
    const strict =
        options.strict ??
        (answers.strictConfig ||
            answers.deploymentTarget === 'prod-build' ||
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
