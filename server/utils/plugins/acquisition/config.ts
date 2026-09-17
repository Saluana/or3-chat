/**
 * @module server/utils/plugins/acquisition/config
 *
 * Purpose:
 * The instance's trusted-acquisition configuration: which marketplace registry
 * this host will talk to, which release keys it trusts, whether registry
 * installation is enabled at all, and how many bytes one acquisition may stage.
 *
 * Behavior:
 * - Fails closed. A missing origin, a non-HTTPS origin, an unparsable key list or
 *   a disabled install flag all mean acquisitions are refused, never that policy
 *   checks are skipped.
 * - Malformed key entries are dropped rather than repaired, and an empty key set
 *   means nothing is trusted.
 * - Configuration is read once per process and can be re-resolved from an
 *   explicit environment for tests.
 *
 * Constraints:
 * - This is the registry path only. The separately gated owner raw-ZIP upload
 *   path is unaffected and must never be enabled from here.
 *
 * Non-Goals:
 * - Verifying releases (the registry client and release metadata policy do that).
 */

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';
import {
    OR3_PLUGIN_V2_HOST_CAPABILITIES,
} from '../../../admin/plugins/v2-host-capabilities';
import { supportedAcquisitionProfiles } from '~~/shared/plugins/acquisition/release-metadata';

export interface MarketplaceReleaseKey {
    readonly keyId: string;
    readonly publicJwk: {
        readonly kty: string;
        readonly crv: string;
        readonly x: string;
    };
}

export interface AcquisitionConfig {
    /** Always empty or an `https://` origin. */
    readonly registryOrigin: string;
    readonly installEnabled: boolean;
    readonly releaseKeys: readonly MarketplaceReleaseKey[];
    /** Package trust modes this host can actually run. */
    readonly supportedTrustModes: readonly string[];
    /** Profiles the host can acquire, derived from `supportedTrustModes`. */
    readonly supportedProfiles: readonly string[];
    readonly hostOr3Version: string;
    readonly hostPluginApiVersion: string;
    readonly maxArtifactBytes: number;
    readonly reserveBytes: number;
}

export const DEFAULT_MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
export const DEFAULT_RESERVE_BYTES = 64 * 1024 * 1024;

const BASE64URL = /^[A-Za-z0-9_-]{43,86}$/;

function httpsOrigin(raw: string | undefined): string {
    const value = raw?.trim();
    if (!value) return '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return '';
        if (url.pathname !== '/' && url.pathname !== '') return '';
        return `${url.origin}`;
    } catch {
        return '';
    }
}

/**
 * Parses the trusted release keys. Every entry must be an Ed25519 public JWK
 * with a key id; anything else is discarded so a typo cannot widen trust.
 */
export function parseReleaseKeys(raw: string | undefined): readonly MarketplaceReleaseKey[] {
    if (!raw?.trim()) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw) as unknown;
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const keys: MarketplaceReleaseKey[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as Record<string, unknown>;
        const keyId = typeof candidate.keyId === 'string' ? candidate.keyId.trim() : '';
        if (!keyId || keyId.length > 128 || seen.has(keyId)) continue;
        const jwkSource =
            candidate.publicJwk && typeof candidate.publicJwk === 'object'
                ? (candidate.publicJwk as Record<string, unknown>)
                : candidate;
        const kty = typeof jwkSource.kty === 'string' ? jwkSource.kty : 'OKP';
        const crv = typeof jwkSource.crv === 'string' ? jwkSource.crv : 'Ed25519';
        const x = typeof jwkSource.x === 'string' ? jwkSource.x.trim() : '';
        if (kty !== 'OKP' || crv !== 'Ed25519' || !BASE64URL.test(x)) continue;
        seen.add(keyId);
        keys.push({ keyId, publicJwk: { kty, crv, x } });
    }
    return keys;
}

function positiveInt(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) return fallback;
    return value;
}

export function resolveAcquisitionConfig(env: NodeJS.ProcessEnv = process.env): AcquisitionConfig {
    const supportedTrustModes = [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedTrustModes];
    return {
        registryOrigin: httpsOrigin(env.OR3_MARKETPLACE_REGISTRY_ORIGIN),
        installEnabled: env.OR3_MARKETPLACE_INSTALL_ENABLED?.trim().toLowerCase() === 'true',
        releaseKeys: parseReleaseKeys(env.OR3_MARKETPLACE_RELEASE_KEYS),
        supportedTrustModes,
        supportedProfiles: supportedAcquisitionProfiles(supportedTrustModes),
        hostOr3Version: OR3_PLUGIN_V2_HOST_CAPABILITIES.or3Version,
        hostPluginApiVersion: OR3_PLUGIN_V2_HOST_CAPABILITIES.pluginApiVersion,
        maxArtifactBytes: positiveInt(
            env.OR3_MARKETPLACE_MAX_ARTIFACT_BYTES,
            DEFAULT_MAX_ARTIFACT_BYTES
        ),
        reserveBytes: positiveInt(env.OR3_MARKETPLACE_RESERVE_BYTES, DEFAULT_RESERVE_BYTES),
    };
}

let cached: AcquisitionConfig | null = null;

/** Process-wide configuration, resolved once from the real environment. */
export function acquisitionConfig(): AcquisitionConfig {
    cached ??= resolveAcquisitionConfig();
    return cached;
}

/** Test seam: forget the resolved configuration. */
export function resetAcquisitionConfig(): void {
    cached = null;
}

/**
 * A stable identity for this deployment. An acquisition records it so a record
 * cannot be replayed against another host, and deployments may set
 * `OR3_INSTANCE_ID` when the derived identity would change with relocation.
 */
export function resolveInstanceId(env: NodeJS.ProcessEnv = process.env): string {
    const configured = env.OR3_INSTANCE_ID?.trim();
    if (configured) return configured;
    return `ext-${createHash('sha256')
        .update(`${hostname()}\0${EXTENSIONS_BASE_DIR}`)
        .digest('hex')
        .slice(0, 24)}`;
}

let cachedInstanceId: string | null = null;

export function acquisitionInstanceId(): string {
    cachedInstanceId ??= resolveInstanceId();
    return cachedInstanceId;
}
