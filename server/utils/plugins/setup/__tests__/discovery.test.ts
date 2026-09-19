import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImmutablePluginPackageStore } from '../../../../admin/plugins/package-store';
import { PluginPackagePointerStore } from '../../../../admin/plugins/package-pointer-store';
import { resolvePluginPackage } from '../discovery';

const PLUGIN_ID = 'or3.discovery-test';

const stateCompatibility = Object.freeze({
    version: 1,
    reads: Object.freeze({ minimum: 1, maximum: 1 }),
    rollback: 'safe' as const,
});

function source(version: string): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-discovery-package-'));
    writeFileSync(
        resolve(root, 'or3.manifest.json'),
        JSON.stringify({
            manifestVersion: 2,
            kind: 'plugin',
            id: PLUGIN_ID,
            version,
        })
    );
    writeFileSync(resolve(root, 'client.mjs'), `export default ${JSON.stringify(version)};\n`);
    return root;
}

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-discovery-store-'));
    const packages = new ImmutablePluginPackageStore(root);
    const pointers = new PluginPackagePointerStore(root, packages);
    const current = await packages.installPackage(PLUGIN_ID, source('1.0.0'));
    const candidate = await packages.installPackage(PLUGIN_ID, source('2.0.0'));
    return { root, pointers, current, candidate };
}

function target(
    stored: Awaited<ReturnType<ImmutablePluginPackageStore['installPackage']>>
) {
    return {
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt: 1,
        stateCompatibility,
    };
}

describe('plugin package discovery slots', () => {
    it('prefers the pending candidate for setup and resolves it by default', async () => {
        const { root, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: target(candidate),
            previous: null,
        });

        const resolved = await resolvePluginPackage(PLUGIN_ID, root);
        expect(resolved?.digest).toBe(candidate.digest);
    });

    it('resolves only the running selection for runtime settings', async () => {
        const { root, pointers, current, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: target(current),
            candidate: target(candidate),
            previous: null,
        });

        const resolved = await resolvePluginPackage(PLUGIN_ID, root, 'current');
        expect(resolved?.digest).toBe(current.digest);
    });

    it('does not resolve a candidate that has no promoted version', async () => {
        const { root, pointers, candidate } = await setup();
        await pointers.writePointer(PLUGIN_ID, {
            schemaVersion: 1,
            pluginId: PLUGIN_ID,
            revision: 1,
            current: null,
            candidate: target(candidate),
            previous: null,
        });

        await expect(resolvePluginPackage(PLUGIN_ID, root, 'current')).resolves.toBeNull();
        const auto = await resolvePluginPackage(PLUGIN_ID, root);
        expect(auto?.digest).toBe(candidate.digest);
    });
});
