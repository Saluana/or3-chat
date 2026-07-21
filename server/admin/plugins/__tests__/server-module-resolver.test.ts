import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ImmutablePluginPackageStore } from '../package-store';
import {
    PluginPackagePointerStore,
    type PluginPackagePointer,
} from '../package-pointer-store';
import {
    ServerModuleResolver,
    ServerModuleResolverError,
} from '../server-module-resolver';

async function setupPackage(handlerSource: string) {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-server-module-'));
    const source = mkdtempSync(resolve(tmpdir(), 'or3-server-module-src-'));
    mkdirSync(resolve(source, 'server'), { recursive: true });
    writeFileSync(
        resolve(source, 'or3.manifest.json'),
        JSON.stringify({
            manifestVersion: 2,
            kind: 'plugin',
            id: 'alpha',
            version: '1.0.0',
        })
    );
    writeFileSync(resolve(source, 'server', 'health.get.mjs'), handlerSource);
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
    return { packages, pointers, stored, packageRoot: packages.packagePath('alpha', stored.digest) };
}

describe('ServerModuleResolver', () => {
    it('loads a new digest and reuses the same digest from cache', async () => {
        const handler = vi.fn(async () => ({ ok: true }));
        const importModule = vi.fn(async () => ({ default: handler }));
        const { packages, pointers, stored, packageRoot } = await setupPackage(
            'export default async () => ({ ok: true });\n'
        );
        const resolver = new ServerModuleResolver({ packages, pointers, importModule });

        const first = await resolver.resolveHandler({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            handlerPath: 'server/health.get.mjs',
        });
        const second = await resolver.resolveHandler({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            handlerPath: 'server/health.get.mjs',
        });

        expect(first.cacheHit).toBe(false);
        expect(second.cacheHit).toBe(true);
        expect(second.handler).toBe(first.handler);
        expect(importModule).toHaveBeenCalledOnce();
        expect(importModule).toHaveBeenCalledWith(
            pathToFileURL(resolve(packageRoot, 'server/health.get.mjs')).href
        );
        await expect(first.handler({} as never)).resolves.toEqual({ ok: true });
    });

    it('loads a different digest as new code', async () => {
        const { packages, pointers, stored } = await setupPackage(
            'export default async () => ({ version: 1 });\n'
        );
        const source2 = mkdtempSync(resolve(tmpdir(), 'or3-server-module-src2-'));
        mkdirSync(resolve(source2, 'server'), { recursive: true });
        writeFileSync(
            resolve(source2, 'or3.manifest.json'),
            JSON.stringify({
                manifestVersion: 2,
                kind: 'plugin',
                id: 'alpha',
                version: '1.0.1',
            })
        );
        writeFileSync(
            resolve(source2, 'server', 'health.get.mjs'),
            'export default async () => ({ version: 2 });\n'
        );
        const stored2 = await packages.installPackage('alpha', source2);
        await pointers.writePointer('alpha', {
            schemaVersion: 1,
            pluginId: 'alpha',
            revision: 2,
            current: {
                packageDigest: stored2.digest,
                manifestDigest: stored2.verification.manifestDigest,
                recordedAt: 2,
                stateCompatibility: {
                    version: 1,
                    reads: { minimum: 1, maximum: 1 },
                    rollback: 'safe',
                },
            },
            candidate: null,
            previous: {
                packageDigest: stored.digest,
                manifestDigest: stored.verification.manifestDigest,
                recordedAt: 1,
                stateCompatibility: {
                    version: 1,
                    reads: { minimum: 1, maximum: 1 },
                    rollback: 'safe',
                },
            },
        });

        const importModule = vi.fn(async (url: string) => {
            if (url.includes(stored2.digest)) {
                return { default: async () => ({ version: 2 }) };
            }
            return { default: async () => ({ version: 1 }) };
        });
        const resolver = new ServerModuleResolver({ packages, pointers, importModule });
        const next = await resolver.resolveHandler({
            pluginId: 'alpha',
            packageDigest: stored2.digest,
            handlerPath: 'server/health.get.mjs',
        });
        await expect(next.handler({} as never)).resolves.toEqual({ version: 2 });
        expect(next.cacheHit).toBe(false);
        expect(importModule.mock.calls[0]?.[0]).toContain(stored2.digest);
    });

    it('never attaches workspace identity to cached modules', async () => {
        const importModule = vi.fn(async () => ({
            default: async () => ({ ok: true }),
        }));
        const { packages, pointers, stored } = await setupPackage(
            'export default async () => ({ ok: true });\n'
        );
        const resolver = new ServerModuleResolver({ packages, pointers, importModule });
        const resolved = await resolver.resolveHandler({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            handlerPath: 'server/health.get.mjs',
        });
        const wsA = resolver.createAuthorizedContext({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            workspaceId: 'ws-a',
            userId: 'user-a',
            method: 'GET',
            routePath: 'health',
            now: () => 10,
        });
        const wsB = resolver.createAuthorizedContext({
            pluginId: 'alpha',
            packageDigest: stored.digest,
            workspaceId: 'ws-b',
            userId: 'user-b',
            method: 'GET',
            routePath: 'health',
            now: () => 11,
        });

        expect(wsA.workspaceId).toBe('ws-a');
        expect(wsB.workspaceId).toBe('ws-b');
        expect(resolved).not.toHaveProperty('workspaceId');
        expect(Object.isFrozen(wsA)).toBe(true);
    });

    it('rejects path traversal and TypeScript handlers', async () => {
        const { packages, pointers, stored } = await setupPackage(
            'export default async () => ({ ok: true });\n'
        );
        const resolver = new ServerModuleResolver({
            packages,
            pointers,
            importModule: async () => ({ default: async () => ({ ok: true }) }),
        });

        await expect(
            resolver.resolveHandler({
                pluginId: 'alpha',
                packageDigest: stored.digest,
                handlerPath: '../escape.mjs',
            })
        ).rejects.toMatchObject({ code: 'invalid-handler-path' });

        await expect(
            resolver.resolveHandler({
                pluginId: 'alpha',
                packageDigest: stored.digest,
                handlerPath: 'server/health.get.ts',
            })
        ).rejects.toBeInstanceOf(ServerModuleResolverError);
    });
});
