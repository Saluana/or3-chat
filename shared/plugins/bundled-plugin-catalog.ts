import type { BundledV1ArtifactIdentity } from './runtime-descriptor';

export const BUNDLED_PLUGIN_CATALOG_MARKER = 'or3-bundled-plugin-catalog:v1';
const LEGACY_CLIENT_ENTRIES = ['plugin.client.ts', 'plugin.client.js', 'plugin.client.mjs'] as const;

export interface BundledPluginCatalogEntry {
    readonly pluginId: string;
    readonly clientEntry: string;
    readonly moduleKey: string;
}

export interface BundledPluginCatalog {
    readonly schemaVersion: 1;
    readonly marker: typeof BUNDLED_PLUGIN_CATALOG_MARKER;
    readonly hostBuildId: string;
    readonly entries: readonly BundledPluginCatalogEntry[];
}

export type BundledPluginResolution =
    | {
          readonly status: 'bundled';
          readonly entry: BundledPluginCatalogEntry;
          readonly artifact: BundledV1ArtifactIdentity;
      }
    | {
          readonly status: 'rebuild-required';
          readonly pluginId: string;
          readonly reason: 'not-in-host-build' | 'entrypoint-mismatch';
      };

function normalizeEntry(entry: string): string {
    return entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/** Resolve only code captured by this host build; never infer executable bytes from disk. */
export function resolveBundledPluginArtifact(
    catalog: BundledPluginCatalog,
    pluginId: string,
    requestedClientEntry?: string
): BundledPluginResolution {
    const candidates = catalog.entries.filter((candidate) => candidate.pluginId === pluginId);
    if (!candidates.length) {
        return { status: 'rebuild-required', pluginId, reason: 'not-in-host-build' };
    }
    const requested = requestedClientEntry === undefined ? undefined : normalizeEntry(requestedClientEntry);
    const exact = requested
        ? candidates.find((candidate) => normalizeEntry(candidate.clientEntry) === requested)
        : undefined;
    // Preserve V1 selection: an absent/invalid explicit entry still tries each
    // legacy root filename in the established order.
    const legacy = LEGACY_CLIENT_ENTRIES.map((legacyEntry) =>
        candidates.find((candidate) => normalizeEntry(candidate.clientEntry) === legacyEntry)
    ).find((candidate) => candidate !== undefined);
    const entry = exact ?? legacy;
    if (!entry) return { status: 'rebuild-required', pluginId, reason: 'entrypoint-mismatch' };
    return {
        status: 'bundled',
        entry,
        artifact: {
            kind: 'bundled-v1',
            hostBuildId: catalog.hostBuildId,
            moduleKey: entry.moduleKey,
            rebuildRequired: true,
        },
    };
}
