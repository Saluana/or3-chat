import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImmutablePluginPackageStore, PluginPackageStoreError } from '../package-store';

function deferred<T>() {
    let resolvePromise!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

function fixture(id = 'alpha'): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-package-source-'));
    writeFileSync(
        resolve(root, 'or3.manifest.json'),
        JSON.stringify({ manifestVersion: 2, kind: 'plugin', id })
    );
    writeFileSync(resolve(root, 'client.mjs'), 'export default "alpha";\n');
    return root;
}

describe('immutable plugin package store', () => {
    it('installs a verified digest tree in the per-plugin immutable layout', async () => {
        const extensionsRoot = mkdtempSync(resolve(tmpdir(), 'or3-package-store-'));
        const store = new ImmutablePluginPackageStore(extensionsRoot);
        const result = await store.installPackage('alpha', fixture());

        expect(result.status).toBe('installed');
        expect(result.path).toBe(resolve(extensionsRoot, '.store', 'alpha', result.digest));
        expect(readFileSync(resolve(result.path, 'client.mjs'), 'utf8')).toContain('alpha');
        expect(statSync(result.path).mode & 0o222).toBe(0);
        expect(statSync(resolve(result.path, 'client.mjs')).mode & 0o222).toBe(0);
    });

    it('treats an existing verified digest as a no-op without rewriting it', async () => {
        const store = new ImmutablePluginPackageStore(mkdtempSync(resolve(tmpdir(), 'or3-package-store-')));
        const source = fixture();
        const installed = await store.installPackage('alpha', source);
        const before = statSync(resolve(installed.path, 'client.mjs'));
        const existing = await store.installPackage('alpha', source, installed.digest);
        const after = statSync(resolve(installed.path, 'client.mjs'));

        expect(existing.status).toBe('existing');
        expect(after.ino).toBe(before.ino);
        expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    it('never repairs or overwrites a corrupt existing digest tree', async () => {
        const store = new ImmutablePluginPackageStore(mkdtempSync(resolve(tmpdir(), 'or3-package-store-')));
        const source = fixture();
        const installed = await store.installPackage('alpha', source);
        // Simulate out-of-band privileged corruption; the store itself exposes no mutation API.
        const storedClient = resolve(installed.path, 'client.mjs');
        chmodSync(storedClient, 0o644);
        writeFileSync(storedClient, 'corrupt');

        await expect(store.installPackage('alpha', source, installed.digest)).rejects.toMatchObject({
            code: 'stored-package-corrupt',
        });
        expect(readFileSync(storedClient, 'utf8')).toBe('corrupt');
    });

    it('serializes one plugin ID while an unrelated ID progresses independently', async () => {
        const store = new ImmutablePluginPackageStore(mkdtempSync(resolve(tmpdir(), 'or3-package-store-')));
        const alphaGate = deferred<void>();
        const trace: string[] = [];
        const alphaFirst = store.runPluginOperation('alpha', async () => {
            trace.push('alpha-1:start');
            await alphaGate.promise;
            trace.push('alpha-1:end');
        });
        const alphaSecond = store.runPluginOperation('alpha', () => trace.push('alpha-2'));
        const beta = store.runPluginOperation('beta', () => trace.push('beta'));

        await beta;
        expect(trace).toEqual(['alpha-1:start', 'beta']);
        alphaGate.resolve();
        await Promise.all([alphaFirst, alphaSecond]);
        expect(trace).toEqual(['alpha-1:start', 'beta', 'alpha-1:end', 'alpha-2']);
    });

    it.each(['../alpha', 'Alpha', 'alpha/child', '..'])('rejects unsafe V2 plugin id %s', (pluginId) => {
        const store = new ImmutablePluginPackageStore(mkdtempSync(resolve(tmpdir(), 'or3-package-store-')));
        expect(() => store.runPluginOperation(pluginId, () => undefined)).toThrow(PluginPackageStoreError);
    });

    it('refuses to store a V2 package beneath a different plugin ID', async () => {
        const store = new ImmutablePluginPackageStore(mkdtempSync(resolve(tmpdir(), 'or3-package-store-')));
        await expect(store.installPackage('beta', fixture('alpha'))).rejects.toMatchObject({
            code: 'package-identity-mismatch',
        });
    });
});
