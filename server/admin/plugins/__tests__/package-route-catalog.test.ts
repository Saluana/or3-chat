import { chmodSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImmutablePluginPackageStore } from '../package-store';
import { PluginPackageRouteCatalog } from '../package-route-catalog';

/**
 * Pointer slots hold digests, never versions, so the plugins-page display DTO
 * reads the version from the stored manifest of the exact slot. This pins that
 * read (and its fail-closed shape) to the immutable package layout.
 */
const golden = resolve(import.meta.dirname, '../../../../tests/plugin-runtime/golden/valid-portable');

/**
 * A stored package tree. The golden fixture predates the current state-version
 * schema and carries a declared integrity digest, so the manifest is refreshed
 * (and the digest self-declaration dropped) before installation.
 */
async function storedPackage() {
    // The store makes installed trees read-only, so these temp roots are left to
    // the OS (as the package-store tests do).
    const extensionsRoot = mkdtempSync(resolve(tmpdir(), 'or3-catalog-'));
    const source = mkdtempSync(resolve(tmpdir(), 'or3-catalog-source-'));
    cpSync(golden, source, { recursive: true });
    const manifestPath = resolve(source, 'or3.manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.integrity;
    manifest.stateCompatibility = {
        version: 1,
        reads: { minimum: 1, maximum: 1 },
        rollback: 'safe',
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const store = new ImmutablePluginPackageStore(extensionsRoot);
    const installed = await store.installPackage('or3.golden-portable', source);
    return { store, installed };
}

describe('package route catalog manifest reads', () => {
    it('reports the manifest version of a stored digest', async () => {
        const { store, installed } = await storedPackage();
        const catalog = new PluginPackageRouteCatalog(store);

        const read = await catalog.readManifest('or3.golden-portable', installed.digest);
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.manifest.version).toBe('1.0.0');
        expect(read.pluginId).toBe('or3.golden-portable');
    });

    it('fails closed for a digest that is not stored', async () => {
        const { store } = await storedPackage();
        const catalog = new PluginPackageRouteCatalog(store);

        const read = await catalog.readManifest(
            'or3.golden-portable',
            `sha256-${'f'.repeat(64)}` as `sha256-${string}`
        );
        expect(read.status).toBe('blocked');
    });

    it('fails closed for an unreadable manifest at a stored digest', async () => {
        const { store, installed } = await storedPackage();
        // Out-of-band corruption of the stored tree: the catalog must report a
        // blocked read rather than inventing a version.
        const manifestPath = resolve(installed.path, 'or3.manifest.json');
        chmodSync(manifestPath, 0o644);
        writeFileSync(manifestPath, '{ not json');
        const catalog = new PluginPackageRouteCatalog(store);

        const read = await catalog.readManifest('or3.golden-portable', installed.digest);
        expect(read).toEqual({
            status: 'blocked',
            pluginId: 'or3.golden-portable',
            blockCode: 'package-manifest-invalid',
        });
    });
});
