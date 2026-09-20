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
 * - Network locality is checked in layers. Where the stack exposes the
 *   connection socket, it must be loopback and forwarded headers are ignored
 *   entirely. Some development stacks proxy API requests internally (the
 *   socket identity is then unavailable and the proxy inserts a forwarder
 *   entry): there the launcher-recorded bind address must be loopback, the
 *   request Host must be loopback, and every forwarder entry must be loopback.
 *   A non-loopback socket, a non-loopback bind, a non-loopback Host, or any
 *   non-loopback forwarder entry each fail independently.
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
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const PLUGIN_DEVELOPMENT_FLAG = 'OR3_PLUGIN_DEVELOPMENT';
export const PLUGIN_DEV_PROFILE_VAR = 'OR3_PLUGIN_DEV_PROFILE';
/** Launcher-recorded bind address inside the dedicated profile root. */
export const PLUGIN_DEV_LAUNCHER_FILE = 'launcher.json';

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

function isLoopbackHost(hostname: string): boolean {
    const bare = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
    return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}

/** Request Host header hostname, without any port. */
function requestHost(event: H3Event): string {
    const host = event.node.req.headers?.host ?? '';
    const withoutPort = host.startsWith('[')
        ? (host.match(/^\[([^\]]*)\]/)?.[1] ?? '')
        : host.split(':')[0] ?? '';
    return withoutPort;
}

/** Forwarder entries the request carries (X-Forwarded-For plus RFC 7239 Forwarded). */
function forwarderEntries(event: H3Event): readonly string[] {
    const headers = event.node.req.headers ?? {};
    const raw = (name: string): string => {
        const value = headers[name];
        return Array.isArray(value) ? value.join(',') : (value ?? '');
    };
    const entries: string[] = [];
    for (const part of raw('x-forwarded-for').split(',')) {
        const host = part.trim().split(':')[0]?.replace(/["[\]]/g, '').trim() ?? '';
        if (host) entries.push(host);
    }
    for (const part of raw('forwarded').split(';')) {
        const match = part.trim().match(/^for=("[^"]+"|[^;,]+)/i);
        if (match) entries.push(match[1]!.replace(/"/g, '').split(':')[0]!.trim());
    }
    return entries;
}

/**
 * Whether the connection is local. A present socket address is authoritative
 * and forwarder entries are ignored. Otherwise (development stacks that proxy
 * API requests internally) the launcher-recorded bind address, the request
 * Host and every forwarder entry must each be loopback.
 */
function isLocalConnection(event: H3Event, profileRoot: string | null): boolean {
    const socketAddress =
        (event.node.req.socket as { remoteAddress?: unknown } | undefined)?.remoteAddress;
    if (typeof socketAddress === 'string' && socketAddress.length > 0) {
        return isLoopbackHost(socketAddress.replace(/^::ffff:/, ''));
    }
    if (!profileRoot) return false;
    let bindHost: unknown = null;
    try {
        const marker = resolve(profileRoot, PLUGIN_DEV_LAUNCHER_FILE);
        if (!existsSync(marker)) return false;
        bindHost = (JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>).host;
    } catch {
        return false;
    }
    if (typeof bindHost !== 'string' || !isLoopbackHost(bindHost)) return false;
    if (!isLoopbackHost(requestHost(event))) return false;
    return forwarderEntries(event).every((entry) => isLoopbackHost(entry));
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

    if (!isLocalConnection(event, profileRoot)) {
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
            return 'Development admission accepts loopback access only: a loopback socket, or a loopback bind with a loopback Host and loopback-only forwarder entries.';
    }
}
