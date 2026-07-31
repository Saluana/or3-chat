import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    computeHostBuildId,
    generateBundledPluginCatalog,
    renderBundledPluginCatalogModule,
} from '../plugin-runtime/generate-bundled-plugin-catalog';

const temporaryRoots: string[] = [];

function fixtureRoot(): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-plugin-catalog-'));
    temporaryRoots.push(root);
    mkdirSync(resolve(root, 'extensions/plugins'), { recursive: true });
    writeFileSync(resolve(root, 'package.json'), '{}');
    return root;
}

function addPlugin(
    root: string,
    id: string,
    options: { entry?: string; manifestId?: string; files: Record<string, string> }
): void {
    const pluginRoot = resolve(root, 'extensions/plugins', id);
    mkdirSync(pluginRoot, { recursive: true });
    const manifest = {
        kind: 'plugin',
        id: options.manifestId ?? id,
        name: id,
        version: '1.0.0',
        ...(options.entry ? { runtime: { client: { entry: options.entry } } } : {}),
    };
    writeFileSync(resolve(pluginRoot, 'or3.manifest.json'), JSON.stringify(manifest));
    for (const [path, source] of Object.entries(options.files)) {
        const file = resolve(pluginRoot, path);
        mkdirSync(resolve(file, '..'), { recursive: true });
        writeFileSync(file, source);
    }
}

afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled plugin catalog generator', () => {
    it('selects explicit and legacy entries with exact root-relative glob keys', () => {
        const root = fixtureRoot();
        addPlugin(root, 'alpha', {
            entry: 'client/main.client.ts',
            files: {
                'client/main.client.ts': 'export default {}',
                'client/helper.client.ts': 'export const helper = true',
            },
        });
        addPlugin(root, 'beta', { files: { 'plugin.client.js': 'export default {}' } });

        const generated = generateBundledPluginCatalog({ repoRoot: root, hostBuildId: 'build-1' });
        expect(generated.issues).toEqual([]);
        expect(generated.catalog.entries).toEqual([
            {
                pluginId: 'alpha',
                clientEntry: 'client/helper.client.ts',
                moduleKey: '../../extensions/plugins/alpha/client/helper.client.ts',
            },
            {
                pluginId: 'alpha',
                clientEntry: 'client/main.client.ts',
                moduleKey: '../../extensions/plugins/alpha/client/main.client.ts',
            },
            {
                pluginId: 'beta',
                clientEntry: 'plugin.client.js',
                moduleKey: '../../extensions/plugins/beta/plugin.client.js',
            },
        ]);
        expect(renderBundledPluginCatalogModule(generated.catalog)).toContain(
            'or3-bundled-plugin-catalog:v1'
        );
        expect(renderBundledPluginCatalogModule(generated.catalog)).toContain('helper.client.ts');
    });

    it('reports entries absent from the production glob and excludes them', () => {
        const root = fixtureRoot();
        addPlugin(root, 'missing', { entry: 'client/missing.client.ts', files: {} });
        addPlugin(root, 'wrong-extension', {
            entry: 'client/main.ts',
            files: { 'client/main.ts': 'export default {}' },
        });

        const generated = generateBundledPluginCatalog({ repoRoot: root, hostBuildId: 'build-1' });
        expect(generated.catalog.entries).toEqual([]);
        expect(generated.issues).toEqual([
            'missing: client entry is absent from this host build (client/missing.client.ts)',
            'wrong-extension: client entry is outside the V1 client glob (client/main.ts)',
        ]);
    });

    it('keys bundled modules by manifest id when the directory differs', () => {
        const root = fixtureRoot();
        addPlugin(root, 'legacy-directory', {
            manifestId: 'plugin.stable-id',
            files: { 'plugin.client.ts': 'export default {}' },
        });

        const generated = generateBundledPluginCatalog({
            repoRoot: root,
            hostBuildId: 'build-1',
        });

        expect(generated.catalog.entries).toEqual([
            {
                pluginId: 'plugin.stable-id',
                clientEntry: 'plugin.client.ts',
                moduleKey: '../../extensions/plugins/legacy-directory/plugin.client.ts',
            },
        ]);
    });

    it('excludes ambiguous duplicate manifest ids', () => {
        const root = fixtureRoot();
        addPlugin(root, 'first-directory', {
            manifestId: 'plugin.duplicate',
            files: { 'plugin.client.ts': 'export default {}' },
        });
        addPlugin(root, 'second-directory', {
            manifestId: 'plugin.duplicate',
            files: { 'plugin.client.ts': 'export default {}' },
        });

        const generated = generateBundledPluginCatalog({
            repoRoot: root,
            hostBuildId: 'build-1',
        });

        expect(generated.catalog.entries).toEqual([]);
        expect(generated.issues).toEqual([
            'second-directory: duplicate plugin id plugin.duplicate (already declared by first-directory)',
        ]);
    });

    it('derives a deterministic host build ID that changes with executable input bytes', () => {
        const root = fixtureRoot();
        addPlugin(root, 'alpha', { files: { 'plugin.client.ts': 'export const value = 1' } });
        const first = computeHostBuildId(root);
        const second = computeHostBuildId(root);
        expect(first).toBe(second);
        expect(first).toMatch(/^sha256-[a-f0-9]{64}$/);

        writeFileSync(
            resolve(root, 'extensions/plugins/alpha/plugin.client.ts'),
            'export const value = 2'
        );
        expect(computeHostBuildId(root)).not.toBe(first);
    });
});
