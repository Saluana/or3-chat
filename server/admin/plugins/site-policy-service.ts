import { SitePluginPolicyStore, type ApprovedSiteRelease, type SitePluginPolicy } from './site-policy';
import { ImmutablePluginPackageStore } from './package-store';
import { PluginPackagePointerStore } from './package-pointer-store';
import { PluginPackageRouteCatalog } from './package-route-catalog';
import { readLocalAdmission } from './local-admission';
import { readAdminUploadProvenance } from './admin-upload-provenance';
import { acquisitionConfig } from '../../utils/plugins/acquisition/config';
import { registryClientFor } from '../../utils/plugins/acquisition/route-support';
import { RegistryStateStore } from '../../utils/plugins/acquisition/registry-state';
import { marketplaceRegistryConfigured, readCatalogEntry } from '../../utils/plugins/marketplace/service';

const terminalReleaseRefusals = new Set([
    'release-not-found', 'release-metadata-invalid', 'release-metadata-unsigned',
    'release-key-untrusted', 'release-identity-mismatch', 'release-digest-mismatch',
    'release-profile-unsupported', 'release-engine-unsupported', 'release-expired',
    'release-quarantined', 'authority-mismatch',
]);

function text(value: unknown, limit: number, fallback = ''): string {
    return typeof value === 'string'
        ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit).trim() || fallback
        : fallback;
}

function displayFromDetail(pluginId: string, entry: unknown): ApprovedSiteRelease['display'] {
    const detail = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const publisher = detail.publisher && typeof detail.publisher === 'object' ? detail.publisher as Record<string, unknown> : {};
    const listing = detail.listing && typeof detail.listing === 'object' ? detail.listing as Record<string, unknown> : {};
    return {
        name: text(detail.name, 160, pluginId),
        summary: text(detail.summary, 500),
        publisherName: text(publisher.displayName, 160),
        category: text(listing.category, 64),
        tags: Array.isArray(listing.tags) ? listing.tags.slice(0, 3).map((tag) => text(tag, 64)).filter(Boolean) : [],
    };
}

export async function signedRelease(pluginId: string, version: string) {
    const stateStore = new RegistryStateStore();
    const state = await stateStore.read();
    const client = registryClientFor(acquisitionConfig(), state.acceptedAdvisorySequence, stateStore, state.acceptedAdvisoryCheckpoint);
    const result = await client.resolveRelease({ expectation: { pluginId, version } });
    if (!result.ok) {
        const error = new Error(result.failure.message) as Error & { code?: string; retryable?: boolean };
        error.code = result.failure.code;
        error.retryable = result.failure.retryable;
        throw error;
    }
    return result.value.document;
}

export async function verifiedReleaseForSite(pluginId: string, version: string): Promise<ApprovedSiteRelease> {
    const document = await signedRelease(pluginId, version);
    const detail = await readCatalogEntry(pluginId);
    return {
        releaseId: document.releaseId,
        version: document.version,
        packageTreeSha256: document.packageTreeSha256,
        authoritySha256: document.authoritySha256,
        display: displayFromDetail(pluginId, detail),
    };
}

/** One-time visibility migration; no grant or enablement write occurs here. */
export async function ensureSitePolicyMigrated(store = new SitePluginPolicyStore()): Promise<void> {
    if (await store.migrationComplete()) return;
    if (!marketplaceRegistryConfigured()) return;
    const packages = new ImmutablePluginPackageStore();
    const pointers = new PluginPackagePointerStore(undefined, packages);
    const catalog = new PluginPackageRouteCatalog(packages, pointers);
    for (const pluginId of await pointers.listPluginIds()) {
        const selection = await pointers.readStartupSelection(pluginId).catch(() => null);
        const digest = selection?.status === 'ready' && selection.selectedSlot === 'current'
            ? selection.selected?.packageDigest : null;
        if (!digest || await readLocalAdmission(pluginId, digest) || await readAdminUploadProvenance(pluginId, digest)) continue;
        const manifest = await catalog.readManifest(pluginId, digest).catch(() => null);
        if (!manifest || manifest.status !== 'ready') continue;
        try {
            const release = await verifiedReleaseForSite(pluginId, manifest.manifest.version);
            if (release.packageTreeSha256 === digest) await store.seedIfAbsent(pluginId, release);
        } catch (error) {
            const failure = error as { code?: unknown; retryable?: unknown };
            if (typeof failure.code !== 'string' || !terminalReleaseRefusals.has(failure.code)) throw error;
            // A verified registry refusal keeps this package unapproved.
        }
    }
    await store.markMigrationComplete();
}

/** Current decision and signed exact release; a newer registry version cannot replace it. */
export async function approvedSiteRelease(pluginId: string, version?: string, store = new SitePluginPolicyStore()): Promise<SitePluginPolicy | null> {
    await ensureSitePolicyMigrated(store);
    const policy = await store.read(pluginId);
    if (!policy?.catalogVisible || (version !== undefined && version !== policy.approvedRelease.version)) return null;
    const signed = await signedRelease(pluginId, policy.approvedRelease.version);
    if (signed.releaseId !== policy.approvedRelease.releaseId ||
        signed.packageTreeSha256 !== policy.approvedRelease.packageTreeSha256 ||
        signed.authoritySha256 !== policy.approvedRelease.authoritySha256) return null;
    return policy;
}

/** Check the locally committed decision while the package operation lease is held. */
export async function isSiteReleaseStillApproved(
    pluginId: string,
    release: Pick<ApprovedSiteRelease, 'version' | 'packageTreeSha256'> & Partial<Pick<ApprovedSiteRelease, 'releaseId' | 'authoritySha256'>>,
    store = new SitePluginPolicyStore()
): Promise<boolean> {
    const policy = await store.read(pluginId);
    return Boolean(policy?.catalogVisible &&
        policy.approvedRelease.version === release.version &&
        policy.approvedRelease.packageTreeSha256 === release.packageTreeSha256 &&
        (release.releaseId === undefined || policy.approvedRelease.releaseId === release.releaseId) &&
        (release.authoritySha256 === undefined || policy.approvedRelease.authoritySha256 === release.authoritySha256));
}

export async function approvedCatalogPage(store: SitePluginPolicyStore, query: URLSearchParams) {
    const search = text(query.get('search'), 80).toLocaleLowerCase();
    const category = text(query.get('category'), 64);
    const tag = text(query.get('tag'), 64);
    const page = Math.max(1, Math.min(10_000, Number(query.get('page')) || 1));
    const pageSize = Math.max(1, Math.min(48, Number(query.get('pageSize')) || 24));
    const visible = (await store.list())
        .filter((record) => record.catalogVisible)
        .filter((record) => !category || record.approvedRelease.display.category === category)
        .filter((record) => !tag || record.approvedRelease.display.tags.includes(tag))
        .filter((record) => !search || [record.pluginId, record.approvedRelease.display.name, record.approvedRelease.display.summary, record.approvedRelease.display.publisherName, ...record.approvedRelease.display.tags]
            .some((value) => value.toLocaleLowerCase().includes(search)))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.pluginId.localeCompare(b.pluginId));
    return {
        total: visible.length,
        page,
        pageSize,
        items: visible.slice((page - 1) * pageSize, page * pageSize).map((record) => ({
            pluginId: record.pluginId,
            name: record.approvedRelease.display.name,
            summary: record.approvedRelease.display.summary,
            publisher: { displayName: record.approvedRelease.display.publisherName },
            listing: { category: record.approvedRelease.display.category, tags: record.approvedRelease.display.tags },
            latestRelease: { version: record.approvedRelease.version, publishedAt: new Date(record.updatedAt).toISOString() },
        })),
    };
}
