import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    PluginPackageAssetError,
    PluginPackageAssetReader,
    normalizePackageAssetPath,
    serveAuthorizedPluginPackageAsset,
} from '../package-assets';
import { PluginPackagePointerStore, type PluginPackagePointer } from '../package-pointer-store';
import { ImmutablePluginPackageStore } from '../package-store';

async function setup() {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-asset-store-'));
    const source = mkdtempSync(resolve(tmpdir(), 'or3-asset-source-'));
    mkdirSync(resolve(source, 'modules'));
    writeFileSync(resolve(source, 'or3.manifest.json'), JSON.stringify({
        manifestVersion: 2,
        kind: 'plugin',
        id: 'alpha',
        version: '1.0.0',
    }));
    writeFileSync(resolve(source, 'client.mjs'), "import './modules/view.mjs';\n");
    writeFileSync(resolve(source, 'modules/view.mjs'), "export const view = 'ok';\n");
    writeFileSync(resolve(source, 'metadata.json'), '{"ok":true}\n');
    const packages = new ImmutablePluginPackageStore(root);
    const stored = await packages.installPackage('alpha', source);
    const pointers = new PluginPackagePointerStore(root, packages);
    const target = {
        packageDigest: stored.digest,
        manifestDigest: stored.verification.manifestDigest,
        recordedAt: 1,
        stateCompatibility: {
            version: 1,
            reads: { minimum: 1, maximum: 1 },
            rollback: 'safe' as const,
        },
    };
    const pointer: PluginPackagePointer = {
        schemaVersion: 1,
        pluginId: 'alpha',
        revision: 1,
        current: target,
        candidate: null,
        previous: null,
    };
    await pointers.writePointer('alpha', pointer);
    return { root, packages, stored, reader: new PluginPackageAssetReader(packages, pointers) };
}

describe('digest-addressed plugin package assets', () => {
    it('serves a multi-module tree with explicit MIME and immutable private headers', async () => {
        const { stored, reader } = await setup();
        const module = await reader.readSelectedAsset({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            requestPath: 'modules/view.mjs',
        });
        const metadata = await reader.readSelectedAsset({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            requestPath: 'metadata.json',
        });

        expect(module.bytes.toString()).toContain("view = 'ok'");
        expect(module.contentType).toBe('text/javascript; charset=utf-8');
        expect(metadata.contentType).toBe('application/json; charset=utf-8');
        expect(module.headers).toEqual({
            'Cache-Control': 'private, max-age=31536000, immutable',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Content-Type-Options': 'nosniff',
        });
    });

    it.each([
        '../secret',
        'modules/../secret',
        '%2e%2e/secret',
        '%252e%252e/secret',
        '/absolute.mjs',
        'C:/absolute.mjs',
        'modules\\view.mjs',
        'modules//view.mjs',
    ])('rejects unsafe path %s', (path) => {
        expect(() => normalizePackageAssetPath(path)).toThrow(PluginPackageAssetError);
    });

    it('rejects unselected digests and out-of-band symlinks', async () => {
        const { packages, stored, reader } = await setup();
        await expect(reader.readSelectedAsset({
            pluginId: 'alpha',
            packageDigest: `sha256-${'0'.repeat(64)}`,
            requestPath: 'client.mjs',
        })).rejects.toMatchObject({ code: 'package-not-selected' });

        const verifiedSelection = await reader.pointers.readStartupSelection('alpha');
        vi.spyOn(reader.pointers, 'readStartupSelection').mockResolvedValue(verifiedSelection);
        const packageRoot = packages.packagePath('alpha', stored.digest);
        chmodSync(packageRoot, 0o755);
        symlinkSync(resolve(packageRoot, 'client.mjs'), resolve(packageRoot, 'linked.mjs'));
        await expect(reader.readSelectedAsset({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            requestPath: 'linked.mjs',
        })).rejects.toMatchObject({ code: 'asset-symlink' });
    });

    it('does not invoke the package reader until authorization succeeds', async () => {
        const { stored, reader } = await setup();
        const read = vi.spyOn(reader, 'readSelectedAsset');
        const denied = Object.assign(new Error('Forbidden'), { statusCode: 403 });

        await expect(serveAuthorizedPluginPackageAsset(
            { pluginId: 'alpha', packageDigest: stored.digest, requestPath: 'client.mjs' },
            () => { throw denied; },
            reader
        )).rejects.toBe(denied);
        expect(read).not.toHaveBeenCalled();
    });
});
