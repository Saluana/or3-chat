import { describe, expect, it } from 'vitest';
import {
    resolveBundledPluginArtifact,
    type BundledPluginCatalog,
} from '../bundled-plugin-catalog';

const catalog: BundledPluginCatalog = {
    schemaVersion: 1,
    marker: 'or3-bundled-plugin-catalog:v1',
    hostBuildId: 'host-build-1',
    entries: [
        {
            pluginId: 'alpha',
            clientEntry: 'client/main.client.ts',
            moduleKey: '../../extensions/plugins/alpha/client/main.client.ts',
        },
    ],
};

describe('resolveBundledPluginArtifact', () => {
    it('returns the exact generated module identity', () => {
        expect(resolveBundledPluginArtifact(catalog, 'alpha', './client/main.client.ts')).toEqual({
            status: 'bundled',
            entry: catalog.entries[0],
            artifact: {
                kind: 'bundled-v1',
                hostBuildId: 'host-build-1',
                moduleKey: '../../extensions/plugins/alpha/client/main.client.ts',
                rebuildRequired: true,
            },
        });
    });

    it('requires a rebuild for post-build IDs and changed entrypoints', () => {
        expect(resolveBundledPluginArtifact(catalog, 'post-build-plugin')).toEqual({
            status: 'rebuild-required',
            pluginId: 'post-build-plugin',
            reason: 'not-in-host-build',
        });
        expect(resolveBundledPluginArtifact(catalog, 'alpha', 'client/new.client.ts')).toEqual({
            status: 'rebuild-required',
            pluginId: 'alpha',
            reason: 'entrypoint-mismatch',
        });
    });

    it('preserves the V1 legacy fallback when an explicit entry is unavailable', () => {
        const legacyCatalog: BundledPluginCatalog = {
            ...catalog,
            entries: [
                {
                    pluginId: 'legacy',
                    clientEntry: 'plugin.client.js',
                    moduleKey: '../../extensions/plugins/legacy/plugin.client.js',
                },
            ],
        };
        const resolution = resolveBundledPluginArtifact(
            legacyCatalog,
            'legacy',
            'missing/declared.client.ts'
        );
        expect(resolution.status).toBe('bundled');
        if (resolution.status === 'bundled') {
            expect(resolution.entry.clientEntry).toBe('plugin.client.js');
        }
    });
});
