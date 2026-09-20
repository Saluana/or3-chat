/**
 * @module server/utils/plugins/development/development-eligibility
 *
 * Purpose:
 * The single gate for local development candidate admission. Each check is
 * independent: a production build rejects admission even when the development
 * flag is supplied, and eligibility is never inferred from an untrusted
 * forwarded header or a localhost URL alone.
 *
 * Behavior:
 * - `OR3_PLUGIN_DEVELOPMENT=1` opts in, but never suffices alone.
 * - `OR3_PLUGIN_DEV_PROFILE` names the dedicated instance root created by the
 *   plugin-dev launcher. Extension, SQLite and basic-auth paths must all
 *   resolve inside it, so the everyday development instance (and production
 *   data) is never borrowed implicitly.
 * - The request socket must be loopback. Forwarded headers are ignored, never
 *   trusted.
 * - Authentication, owner authorization and same-origin mutation context are
 *   enforced separately by `requireAdminApiContext(..., { mutation: true })`;
 *   this module owns the host/profile side of the boundary.
 *
 * Constraints:
 * - No secrets or tokens are read or reported; reasons are stable codes.
 *
 * Non-Goals:
 * - Candidate validation itself (the admission route owns that).
 */

import type { H3Event } from 'h3';
import { resolve, sep } from 'node:path';

export const PLUGIN_DEVELOPMENT_FLAG = 'OR3_PLUGIN_DEVELOPMENT';
export const PLUGIN_DEV_PROFILE_VAR = 'OR3_PLUGIN_DEV_PROFILE';

export type DevelopmentEligibilityCode =
    | 'development-flag-missing'
    | 'production-build'
    | 'dedicated-profile-missing'
    | 'extension-root-outside-profile'
    | 'data-root-outside-profile'
    | 'non-loopback-access';

export interface DevelopmentEligibility {
    readonly eligible: boolean;
    readonly reasons: readonly DevelopmentEligibilityCode[];
    readonly profileRoot: string | null;
}

/** Loopback sockets only. Forwarded headers are never consulted. */
function isLoopbackRemoteAddress(event: H3Event): boolean {
    const address = event.node.req.socket?.remoteAddress ?? '';
    return (
        address === '127.0.0.1' ||
        address === '::1' ||
        address === '::ffff:127.0.0.1'
    );
}

function insideProfile(profileRoot: string, candidate: string | undefined): boolean {
    if (!candidate || candidate.trim().length === 0) return false;
    const root = resolve(profileRoot);
    const resolved = resolve(candidate);
    return resolved === root || resolved.startsWith(`${root}${sep}`);
}

/**
 * Evaluate the host/profile side of development admission. Production builds
 * fail closed: the build check defaults to `import.meta.dev` and is false
 * there regardless of configuration.
 */
export function resolvePluginDevelopmentEligibility(
    event: H3Event,
    overrides: { readonly isDevelopmentBuild?: boolean } = {}
): DevelopmentEligibility {
    const reasons: DevelopmentEligibilityCode[] = [];

    if (process.env[PLUGIN_DEVELOPMENT_FLAG] !== '1') {
        reasons.push('development-flag-missing');
    }
    if ((overrides.isDevelopmentBuild ?? import.meta.dev) !== true) {
        reasons.push('production-build');
    }

    const profileRoot = process.env[PLUGIN_DEV_PROFILE_VAR]?.trim() || null;
    if (!profileRoot) {
        reasons.push('dedicated-profile-missing');
    } else {
        if (!insideProfile(profileRoot, process.env.OR3_EXTENSIONS_ROOT)) {
            reasons.push('extension-root-outside-profile');
        }
        const sqliteDb = process.env.OR3_SQLITE_DB_PATH;
        const basicAuthDb = process.env.OR3_BASIC_AUTH_DB_PATH;
        if (!insideProfile(profileRoot, sqliteDb) || !insideProfile(profileRoot, basicAuthDb)) {
            reasons.push('data-root-outside-profile');
        }
    }

    if (!isLoopbackRemoteAddress(event)) {
        reasons.push('non-loopback-access');
    }

    return {
        eligible: reasons.length === 0,
        reasons: Object.freeze([...reasons]),
        profileRoot,
    };
}

/** Human guidance for each reason, for the ineligible-host explainer. */
export function developmentIneligibilityHelp(code: DevelopmentEligibilityCode): string {
    switch (code) {
        case 'development-flag-missing':
            return 'Start the dedicated instance with OR3_PLUGIN_DEVELOPMENT=1 (the plugin-dev launcher sets it).';
        case 'production-build':
            return 'Development admission is unavailable in production builds, even with the flag set.';
        case 'dedicated-profile-missing':
            return 'Start the dedicated instance through the plugin-dev launcher so OR3_PLUGIN_DEV_PROFILE names its isolated root.';
        case 'extension-root-outside-profile':
            return 'OR3_EXTENSIONS_ROOT must resolve inside the dedicated profile root, not the shared extensions directory.';
        case 'data-root-outside-profile':
            return 'OR3_SQLITE_DB_PATH and OR3_BASIC_AUTH_DB_PATH must resolve inside the dedicated profile root.';
        case 'non-loopback-access':
            return 'Development admission accepts direct loopback connections only.';
    }
}
