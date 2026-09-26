import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleClientEntry } from '../../../packages/plugin-sdk/src/cli/build';

/** The bundler the CLI uses when running under Bun. */
interface Bundler {
    build(options: unknown): Promise<{
        success: boolean;
        outputs: { text(): Promise<string> }[];
        logs: unknown[];
    }>;
}

function packageWithEntry(entry: string, manifest = true): { source: string; build: string } {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-sdk-build-'));
    const source = resolve(root, 'source');
    const build = resolve(root, 'build');
    mkdirSync(source, { recursive: true });
    mkdirSync(build, { recursive: true });
    writeFileSync(resolve(source, 'client.mjs'), entry);
    writeFileSync(resolve(build, 'client.mjs'), entry);
    if (manifest) {
        writeFileSync(
            resolve(source, 'or3.manifest.json'),
            JSON.stringify({
                manifestVersion: 2,
                kind: 'plugin',
                id: 'or3.sample-utility',
                version: '1.0.0',
                runtime: { client: { entry: 'client.mjs', format: 'esm', isolation: 'worker' } },
            })
        );
    }
    return { source, build };
}

describe('or3-plugin build bundling', () => {
    it('leaves an already self-contained entry alone without a bundler', async () => {
        const { source, build } = packageWithEntry("export const ready = true;\n");
        // Node (no `Bun`): nothing to do, and no error for a self-contained entry.
        await bundleClientEntry(source, build);
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toBe(
            'export const ready = true;\n'
        );
    });

    it('fails clearly instead of packing an unresolved SDK import', async () => {
        const { source, build } = packageWithEntry(
            "import { createPortablePlugin } from '@or3/plugin-sdk';\nexport default createPortablePlugin;\n"
        );
        await expect(bundleClientEntry(source, build)).rejects.toThrow(/Bun/);
        // The unusable entry is not silently kept as the packed output.
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toContain(
            "from '@or3/plugin-sdk'"
        );
    });

    it('writes the bundled output and refuses a bundler result that is still bare', async () => {
        const { source, build } = packageWithEntry(
            "import { createPortablePlugin } from '@or3/plugin-sdk';\nexport default createPortablePlugin;\n"
        );
        const selfContained: Bundler = {
            async build() {
                return {
                    success: true,
                    outputs: [{ text: async () => 'const ready = true;\nexport { ready };\n' }],
                    logs: [],
                };
            },
        };
        await bundleClientEntry(source, build, { bundler: selfContained });
        expect(readFileSync(resolve(build, 'client.mjs'), 'utf8')).toBe(
            'const ready = true;\nexport { ready };\n'
        );

        const stillBare: Bundler = {
            async build() {
                return {
                    success: true,
                    outputs: [
                        { text: async () => "import x from 'left-pad';\nexport default x;\n" },
                    ],
                    logs: [],
                };
            },
        };
        await expect(
            bundleClientEntry(source, build, { bundler: stillBare })
        ).rejects.toThrow(/left-pad/);
    });

    it('refuses an unsafe entry path', async () => {
        const root = mkdtempSync(resolve(tmpdir(), 'or3-sdk-build-'));
        mkdirSync(resolve(root, 'source'), { recursive: true });
        mkdirSync(resolve(root, 'build'), { recursive: true });
        writeFileSync(
            resolve(root, 'source', 'or3.manifest.json'),
            JSON.stringify({
                manifestVersion: 2,
                kind: 'plugin',
                id: 'or3.sample-utility',
                version: '1.0.0',
                runtime: { client: { entry: '../escape.mjs', format: 'esm', isolation: 'worker' } },
            })
        );
        await expect(
            bundleClientEntry(resolve(root, 'source'), resolve(root, 'build'))
        ).rejects.toThrow(/unsafe/);
    });
});
