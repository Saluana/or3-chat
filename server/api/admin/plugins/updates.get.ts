/**
 * GET /api/admin/plugins/updates
 *
 * Purpose:
 * Bounded update discovery for installed V2 packages. The Updates page must
 * know about a newer reviewed release even before anything has staged it, so
 * this route compares each installed package's version with the newest version
 * in the catalog and resolves that release through the same trust checks the
 * acquisition pipeline uses (signed metadata, advisories, quarantine).
 *
 * Behavior:
 * - Read-only and owner-only; never stages or promotes anything.
 * - One registry read per installed package, failures reported per plugin
 *   instead of failing the whole check.
 * - Honors instance pins, signed engine compatibility and linked Library coverage.
 * - Acquisition revalidates trust, coverage and consent before promotion.
 */
import { defineEventHandler } from 'h3';
import { compare, valid } from 'semver';
import { libraryLinkServiceFor } from '../../../admin/library/route-support';
import type { LibraryEntitlementsView } from '../../../admin/library/link-service';
import { readUpdatePin } from '../../../utils/plugins/marketplace/update-pins';
import { requireAdminApiContext } from '../../../admin/api';
import { getWorkspaceSettingsStore } from '../../../admin/stores/registry';
import { packageGrantCandidate, pluginPackageServices } from '../../../admin/plugins/package-operation-support';
import { PluginPackageRouteCatalog } from '../../../admin/plugins/package-route-catalog';
import {
    marketplaceRegistryConfigured,
    readCatalogEntry,
} from '../../../utils/plugins/marketplace/service';
import { acquisitionConfig } from '../../../utils/plugins/acquisition/config';
import { registryClientFor } from '../../../utils/plugins/acquisition/route-support';
import { RegistryStateStore } from '../../../utils/plugins/acquisition/registry-state';
import { listAllWorkspaceIds } from '../../../utils/plugins/acquisition/route-support';
import { getEnabledPlugins, getPluginGrantReview } from '../../../admin/plugins/workspace-plugin-store';
import { compareAuthority, type EffectiveAuthority, type AuthorityChange } from '~~/shared/plugins/authority/effective-authority';

interface UpdateCheckPlugin {
    readonly pluginId: string;
    readonly installedVersion: string;
    readonly latestVersion: string | null;
    readonly status: 'up-to-date' | 'update-available' | 'blocked' | 'unknown';
    readonly reason?: string;
    readonly release?: {
        readonly releaseId: string;
        readonly version: string;
        readonly archiveSha256: string;
        readonly packageTreeSha256: string;
        readonly authoritySha256: string;
        readonly requestedGrants: readonly string[];
        readonly authority?: EffectiveAuthority;
        readonly publishedAt: string;
        readonly profile: string;
        /** One site administrator approval covers every enabled workspace. */
        readonly approvalRequired: boolean;
        readonly addedAccess: readonly AuthorityChange[];
    };
}

export default defineEventHandler(async (event) => {
    const context = await requireAdminApiContext(event, { ownerOnly: true, superAdminOnly: true });
    const services = pluginPackageServices(getWorkspaceSettingsStore(event));
    const selected = await new PluginPackageRouteCatalog(
        services.packages,
        services.pointers
    ).listSelected();
    const installed = selected
        .filter((catalog) => catalog.status === 'ready')
        .map((catalog) => ({
            pluginId: catalog.pluginId,
            version: catalog.manifest.version,
            packagePath: catalog.packagePath,
            packageDigest: catalog.packageDigest,
        }));

    const configured = marketplaceRegistryConfigured();
    const plugins: UpdateCheckPlugin[] = [];
    if (!configured) {
        for (const entry of installed) {
            plugins.push({
                pluginId: entry.pluginId,
                installedVersion: entry.version,
                latestVersion: null,
                status: 'unknown',
                reason: 'No marketplace registry is configured on this host.',
            });
        }
        return { ok: true, configured, checkedAt: Date.now(), plugins };
    }

    const config = acquisitionConfig();
    const state = new RegistryStateStore();
    const registryState = await state.read();
    const workspaceIds = new Set(await listAllWorkspaceIds(event));
    if (context.session?.workspace?.id) workspaceIds.add(context.session.workspace.id);

    let entitlements: LibraryEntitlementsView | undefined;
    for (const entry of installed) {
        try {
            const catalog = await readCatalogEntry(entry.pluginId) as {
                price?: { kind?: string };
                releases?: readonly { version: string }[];
            } | null;
            const pinnedVersion = await readUpdatePin(entry.pluginId);
            const versions = [...new Set((catalog?.releases ?? []).map(release => release.version))]
                .filter(version => valid(version) && (!pinnedVersion || version === pinnedVersion))
                .sort((left, right) => compare(right, left)).slice(0, 50);
            const latestVersion = versions[0] ?? null;
            if (latestVersion === null) {
                plugins.push({
                    pluginId: entry.pluginId,
                    installedVersion: entry.version,
                    latestVersion: null,
                    status: 'unknown',
                    reason: 'No published version of this plugin is listed in the catalog.',
                });
                continue;
            }
            if (compare(latestVersion, entry.version) <= 0) {
                plugins.push({
                    pluginId: entry.pluginId,
                    installedVersion: entry.version,
                    latestVersion,
                    status: 'up-to-date',
                });
                continue;
            }
            // Resolve the newer release through the trust pipeline so a
            // quarantined, revoked or unreachable release is reported as
            // blocked rather than advertised as installable.
            const client = registryClientFor(
                config,
                registryState.acceptedAdvisorySequence,
                state,
                registryState.acceptedAdvisoryCheckpoint
            );
            let document: import('~~/shared/plugins/acquisition/release-metadata').ReleaseMetadataDocument | undefined;
            let reason = 'No compatible, covered update is available.';
            for (const version of versions.filter(version => compare(version, entry.version) > 0)) {
                const resolved = await client.resolveRelease({ expectation: { pluginId: entry.pluginId, version } });
                if (!resolved.ok) { reason = resolved.failure.message; continue; }
                const candidate = resolved.value.document;
                if (catalog?.price?.kind !== 'free') {
                    const userId = context.session?.user?.id;
                    if (!userId) { reason = 'Sign in and link your Library to check paid update coverage.'; continue; }
                    if (!entitlements) {
                        const { service } = await libraryLinkServiceFor(event);
                        entitlements = await service.entitlements(userId);
                    }
                    const published = Date.parse(candidate.publishedAt);
                    const acquired = entitlements.acquired?.some(release => release.releaseId === candidate.releaseId && release.archiveSha256 === candidate.archiveSha256);
                    const pass = entitlements.pluginCoverage?.some(coverage => coverage.pluginId === entry.pluginId && coverage.status === 'valid' && published <= Date.parse(coverage.until));
                    const plus = catalog?.price?.kind === 'plus-included' && entitlements.plus?.status === 'active' && published <= Date.parse(entitlements.plus.until ?? '');
                    if (!acquired && !pass && !plus) { reason = 'This release requires Library coverage.'; continue; }
                }
                document = candidate;
                break;
            }
            if (!document) {
                plugins.push({ pluginId: entry.pluginId, installedVersion: entry.version, latestVersion, status: 'blocked', reason });
                continue;
            }
            const candidate = {
                requestedGrants: document.requestedGrants,
                releaseId: document.releaseId,
                packageDigest: document.packageTreeSha256,
                authoritySha256: document.authoritySha256,
                authority: document.authority ?? null,
            };
            let approvalRequired = false;
            for (const workspaceId of workspaceIds) {
                if (workspaceId !== context.session?.workspace?.id &&
                    !(await getEnabledPlugins(services.settings, workspaceId)).includes(entry.pluginId)) continue;
                const review = await getPluginGrantReview(services.settings, workspaceId, entry.pluginId, candidate);
                if (review.status !== 'current' ||
                    !document.requestedGrants.every(grant => review.approvedGrants.includes(grant))) {
                    approvalRequired = true;
                    break;
                }
            }
            const currentAuthority = await packageGrantCandidate({
                packagePath: entry.packagePath,
                packageDigest: entry.packageDigest,
            }).then(result => result.authority).catch(() => null);
            const addedAccess = currentAuthority && document.authority
                ? compareAuthority(currentAuthority, document.authority).expansions
                : [];
            plugins.push({
                pluginId: entry.pluginId,
                installedVersion: entry.version,
                latestVersion: document.version,
                status: 'update-available',
                release: {
                    releaseId: document.releaseId,
                    version: document.version,
                    archiveSha256: document.archiveSha256,
                    packageTreeSha256: document.packageTreeSha256,
                    authoritySha256: document.authoritySha256,
                    requestedGrants: document.requestedGrants,
                    publishedAt: document.publishedAt,
                    profile: document.profile,
                    approvalRequired,
                    addedAccess,
                    ...(document.authority === undefined ? {} : { authority: document.authority }),
                },
            });
        } catch (error) {
            plugins.push({
                pluginId: entry.pluginId,
                installedVersion: entry.version,
                latestVersion: null,
                status: 'unknown',
                reason: error instanceof Error ? error.message : 'The update check failed.',
            });
        }
    }

    return { ok: true, configured, checkedAt: Date.now(), plugins };
});
