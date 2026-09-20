/**
 * @module server/utils/plugins/marketplace/service
 *
 * Purpose:
 * Host-side marketplace reads and preflight for the Dashboard > Marketplace UI.
 *
 * The browser never talks to the registry: this host is the configured, trusted
 * client, so discovery metadata and every install decision pass through routes
 * that already know the instance's policy, workspace, storage and authority.
 *
 * Behavior:
 * - Catalog browse/detail are anonymous registry reads proxied through the
 *   authenticated local server, so a self-hosted instance can show the same
 *   discovery surface without exposing a generic URL proxy.
 * - Preflight resolves the signed release, verifies advisories and reports one
 *   actionable block list instead of a bare boolean. Local assessment governs
 *   execution; it is never an attestation to central commerce.
 *
 * Constraints:
 * - No plugin code runs here and nothing is downloaded.
 * - A disabled or unconfigured registry is reported as such, not as an error.
 *
 * Non-Goals:
 * - Starting the install (the acquisition service owns that).
 */

import { promises as fs } from 'node:fs';
import { acquisitionConfig } from '../acquisition/config';
import { registryClientFor } from '../acquisition/route-support';
import { RegistryStateStore } from '../acquisition/registry-state';
import {
    acquisitionProfileRequirement,
    evaluateClientEngineSupport,
} from '~~/shared/plugins/acquisition/release-metadata';
import type { EffectiveAuthority } from '~~/shared/plugins/authority/effective-authority';
import {
    OR3_PLUGIN_V2_CLIENT_PROFILE,
    OR3_PLUGIN_V2_HOST_CAPABILITIES,
} from '../../../admin/plugins/v2-host-capabilities';
import { EXTENSIONS_BASE_DIR } from '../../../admin/extensions/paths';

export interface MarketplaceBlock {
    readonly code: string;
    readonly message: string;
    readonly action:
        | 'contact-admin'
        | 'configure-registry'
        | 'enable-install'
        | 'enable-plugin'
        | 'review-grants'
        | 'free-space'
        | 'use-installed'
        | 'browse-catalog'
        | 'use-supported-browser'
        | 'retry';
}

export interface MarketplacePreflightResult {
    readonly pluginId: string;
    readonly requestedVersion: string | null;
    readonly status: 'installable' | 'blocked';
    readonly blocks: readonly MarketplaceBlock[];
    readonly registry: {
        readonly configured: boolean;
        readonly installEnabled: boolean;
        readonly origin: string;
        readonly keys: number;
    };
    readonly host: {
        readonly or3Version: string;
        readonly pluginApiVersion: string;
        readonly trustModes: readonly string[];
        readonly grants: readonly string[];
        readonly features: readonly string[];
        /** Structured browser qualification for the portable client profile. */
        readonly client: {
            readonly profile: string;
            readonly qualifiedBrowsers: readonly string[];
            readonly staticHost: boolean;
        };
    };
    readonly release: {
        readonly releaseId: string;
        readonly version: string;
        readonly archiveSha256: string;
        readonly packageTreeSha256: string;
        readonly profile: string;
        /** Whether the signed profile requires a client browser runtime. */
        readonly clientRuntime: 'required' | 'forbidden' | null;
        readonly authoritySha256: string;
        readonly publishedAt: string;
        readonly license: string;
        readonly sourceSha256: string;
        /** Authority the signed release metadata requests, for explicit consent. */
        readonly requestedGrants: readonly string[];
        /** Complete signed authority descriptor shown before consent, when published. */
        readonly authority?: EffectiveAuthority;
    } | null;
    readonly advisories: {
        readonly latestSequence: number;
        readonly acceptedSequence: number;
        readonly quarantined: boolean;
    };
    readonly storage: {
        readonly freeBytes: number | null;
        readonly maxArtifactBytes: number;
        readonly reserveBytes: number;
        readonly ok: boolean;
    };
}

/** Registry reads are bounded; a slow marketplace must not hang the host UI. */
const REGISTRY_TIMEOUT_MS = 8_000;
const MAX_CATALOG_BYTES = 512 * 1024;

export function marketplaceRegistryConfigured(): boolean {
    const config = acquisitionConfig();
    return config.registryOrigin.length > 0 && config.releaseKeys.length > 0;
}

export async function readCatalogPage(query: URLSearchParams): Promise<unknown> {
    const config = acquisitionConfig();
    if (!marketplaceRegistryConfigured()) return null;
    const url = new URL('/api/v1/catalog', config.registryOrigin);
    for (const key of ['search', 'category', 'tag', 'collection', 'page', 'pageSize']) {
        const value = query.get(key);
        if (value !== null && value.length > 0 && value.length <= 128) {
            url.searchParams.set(key, value);
        }
    }
    return await fetchRegistryJson(url);
}

export async function readCatalogEntry(pluginId: string): Promise<unknown> {
    const config = acquisitionConfig();
    if (!marketplaceRegistryConfigured()) return null;
    const url = new URL(`/api/v1/catalog/${encodeURIComponent(pluginId)}`, config.registryOrigin);
    return await fetchRegistryJson(url);
}

async function fetchRegistryJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`The marketplace responded with ${response.status}`);
        }
        const text = await response.text();
        if (text.length > MAX_CATALOG_BYTES) {
            throw new Error('The marketplace response was larger than expected');
        }
        return JSON.parse(text) as unknown;
    } finally {
        clearTimeout(timer);
    }
}

function block(
    code: string,
    message: string,
    action: MarketplaceBlock['action']
): MarketplaceBlock {
    return Object.freeze({ code, message, action });
}

/**
 * Assess one candidate install from the host's point of view.
 *
 * Everything here is local: the configured registry, the signed release and its
 * advisories, the host's capability declaration, free disk and the workspace's
 * own state. Coverage and payment are phase 3 and are reported as not applicable
 * rather than guessed.
 */
/**
 * The newest published version of one plugin, from the public catalog entry.
 * The registry addresses releases by plugin id *and* version, so a caller that
 * did not name a version has to be given the current one rather than being
 * refused with `release-metadata-invalid`.
 */
export async function readLatestPublishedVersion(pluginId: string): Promise<string | null> {
    const entry = (await readCatalogEntry(pluginId)) as {
        readonly releases?: readonly { readonly version?: unknown }[];
        readonly latestRelease?: { readonly version?: unknown };
    } | null;
    if (!entry) return null;
    for (const release of entry.releases ?? []) {
        if (typeof release?.version === 'string' && release.version.length > 0) {
            return release.version;
        }
    }
    const latest = entry.latestRelease?.version;
    return typeof latest === 'string' && latest.length > 0 ? latest : null;
}

export async function preflightMarketplaceInstall(input: {
    readonly pluginId: string;
    readonly version?: string;
    /** Engine detected by the requesting browser, when the caller reported one. */
    readonly clientEngine?: string;
    readonly workspaceId: string;
    readonly installedPluginIds: readonly string[];
    readonly enabledPluginIds: readonly string[];
}): Promise<MarketplacePreflightResult> {
    const config = acquisitionConfig();
    const registryState = new RegistryStateStore();
    const state = await registryState.read();
    const blocks: MarketplaceBlock[] = [];

    // Resolve the version first: everything below addresses an exact release.
    // An unconfigured instance reports that, not a version it cannot look up.
    let requestedVersion = input.version;
    if (requestedVersion === undefined && marketplaceRegistryConfigured()) {
        requestedVersion = (await readLatestPublishedVersion(input.pluginId)) ?? undefined;
        if (requestedVersion === undefined) {
            blocks.push(
                block(
                    'release-not-found',
                    'No published version of this plugin could be resolved from the catalog.',
                    'browse-catalog'
                )
            );
        }
    }

    const base: Omit<MarketplacePreflightResult, 'status' | 'blocks' | 'release' | 'advisories' | 'storage'> = {
        pluginId: input.pluginId,
        requestedVersion: requestedVersion ?? null,
        registry: {
            configured: marketplaceRegistryConfigured(),
            installEnabled: config.installEnabled,
            origin: config.registryOrigin,
            keys: config.releaseKeys.length,
        },
        host: {
            or3Version: OR3_PLUGIN_V2_HOST_CAPABILITIES.or3Version,
            pluginApiVersion: OR3_PLUGIN_V2_HOST_CAPABILITIES.pluginApiVersion,
            trustModes: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedTrustModes],
            grants: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedGrants],
            features: [...OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedFeatures],
            client: {
                profile: OR3_PLUGIN_V2_CLIENT_PROFILE.profile,
                qualifiedBrowsers: [...OR3_PLUGIN_V2_CLIENT_PROFILE.qualifiedBrowsers],
                // A preflight answer exists only where a host server exists.
                staticHost: false,
            },
        },
    };

    if (!base.registry.configured) {
        blocks.push(
            block(
                'registry-unconfigured',
                'This instance has no trusted marketplace registry configured, so nothing can be installed from it.',
                'configure-registry'
            )
        );
        return finish(base, blocks, null, {
            latestSequence: state.acceptedAdvisorySequence,
            acceptedSequence: state.acceptedAdvisorySequence,
            quarantined: false,
        }, null);
    }
    if (!config.installEnabled) {
        blocks.push(
            block(
                'registry-install-disabled',
                'Registry installation is turned off on this instance. An owner can enable it explicitly.',
                'enable-install'
            )
        );
    }

    if (input.installedPluginIds.includes(input.pluginId)) {
        return finish(base, blocks, null, {
            latestSequence: state.acceptedAdvisorySequence,
            acceptedSequence: state.acceptedAdvisorySequence,
            quarantined: false,
        }, null, true);
    }

    if (requestedVersion === undefined) {
        return finish(base, blocks, null, {
            latestSequence: state.acceptedAdvisorySequence,
            acceptedSequence: state.acceptedAdvisorySequence,
            quarantined: false,
        }, null);
    }

    const client = registryClientFor(
        config,
        state.acceptedAdvisorySequence,
        registryState,
        state.acceptedAdvisoryCheckpoint
    );
    const resolved = await client.resolveRelease({
        expectation: { pluginId: input.pluginId, version: requestedVersion },
    });
    if (!resolved.ok) {
        blocks.push(
            block(resolved.failure.code, resolved.failure.message, resolved.failure.retryable ? 'retry' : 'browse-catalog')
        );
        return finish(base, blocks, null, {
            latestSequence: state.acceptedAdvisorySequence,
            acceptedSequence: state.acceptedAdvisorySequence,
            quarantined: resolved.failure.code === 'release-quarantined',
        }, null);
    }

    const document = resolved.value.document;
    if (document.requestedGrants.length > 0 && document.authority === undefined) {
        blocks.push(
            block(
                'authority-unavailable',
                'This release asks for permissions but did not publish its complete signed authority descriptor, so it cannot be approved safely.',
                'contact-admin'
            )
        );
    }
    const requirement = acquisitionProfileRequirement(document.profile);
    if (!requirement) {
        blocks.push(
            block(
                'release-profile-unsupported',
                `This host cannot run a "${document.profile}" package.`,
                'contact-admin'
            )
        );
    } else {
        if (!config.supportedProfiles.includes(document.profile)) {
            blocks.push(
                block(
                    'release-profile-unsupported',
                    `This host does not declare the "${document.profile}" profile, so it cannot install this release.`,
                    'contact-admin'
                )
            );
        }
        if (
            !OR3_PLUGIN_V2_HOST_CAPABILITIES.supportedTrustModes.includes(
                requirement.trust as never
            )
        ) {
            blocks.push(
                block(
                    'release-trust-unsupported',
                    `This host does not run "${requirement.trust}" packages.`,
                    'contact-admin'
                )
            );
        }
        // The browser half of profile qualification: the same rule the runtime
        // enforces before it fetches a byte, applied here so an unqualified
        // engine never reaches a download button without a reason.
        const engine = evaluateClientEngineSupport({
            profile: document.profile,
            engine: input.clientEngine ?? null,
            qualifiedEngines: OR3_PLUGIN_V2_CLIENT_PROFILE.qualifiedBrowsers,
        });
        if (!engine.supported) {
            blocks.push(
                block(
                    'client-engine-unsupported',
                    `The "${document.profile}" profile runs only in qualified browsers (${OR3_PLUGIN_V2_CLIENT_PROFILE.qualifiedBrowsers.join(', ')}); this browser reported "${input.clientEngine ?? 'unknown'}".`,
                    'use-supported-browser'
                )
            );
        }
    }

    const storage = await readStorageHeadroom(config.maxArtifactBytes, config.reserveBytes);
    if (!storage.ok) {
        blocks.push(
            block(
                'storage-unavailable',
                'There is not enough free space on the instance to stage and verify this package.',
                'free-space'
            )
        );
    }

    const advisories = {
        latestSequence: resolved.value.advisorySequence,
        acceptedSequence: state.acceptedAdvisorySequence,
        quarantined: false,
    };
    return finish(base, blocks, {
        releaseId: document.releaseId,
        version: document.version,
        archiveSha256: document.archiveSha256,
        packageTreeSha256: document.packageTreeSha256,
        profile: document.profile,
        clientRuntime: requirement?.clientRuntime ?? null,
        authoritySha256: document.authoritySha256,
        publishedAt: document.publishedAt,
        license: document.license,
        sourceSha256: document.sourceSha256,
        requestedGrants: document.requestedGrants,
        ...(document.authority === undefined ? {} : { authority: document.authority }),
    }, advisories, storage);
}

function finish(
    base: Omit<MarketplacePreflightResult, 'status' | 'blocks' | 'release' | 'advisories' | 'storage'>,
    blocks: readonly MarketplaceBlock[],
    release: MarketplacePreflightResult['release'],
    advisories: MarketplacePreflightResult['advisories'],
    storage: MarketplacePreflightResult['storage'] | null,
    alreadyInstalled = false
): MarketplacePreflightResult {
    const all = [...blocks];
    if (alreadyInstalled) {
        all.push(
            block(
                'already-installed',
                'This plugin is already installed. Use Updates or the installed view instead.',
                'use-installed'
            )
        );
    }
    return Object.freeze({
        ...base,
        status: all.length === 0 ? 'installable' : 'blocked',
        blocks: Object.freeze(all),
        release,
        advisories,
        storage:
            storage ??
            Object.freeze({
                freeBytes: null,
                maxArtifactBytes: 0,
                reserveBytes: 0,
                ok: false,
            }),
    });
}

/**
 * Free space must cover the archive ceiling plus extraction and the immutable
 * copy, independently of what the registry says the file size is.
 */
export async function readStorageHeadroom(
    maxArtifactBytes: number,
    reserveBytes: number
): Promise<MarketplacePreflightResult['storage']> {
    const required = maxArtifactBytes * 3 + reserveBytes;
    try {
        const stats = await fs.statfs(EXTENSIONS_BASE_DIR);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        return Object.freeze({
            freeBytes,
            maxArtifactBytes,
            reserveBytes,
            ok: Number.isFinite(freeBytes) && freeBytes >= required,
        });
    } catch {
        return Object.freeze({
            freeBytes: null,
            maxArtifactBytes,
            reserveBytes,
            ok: false,
        });
    }
}
