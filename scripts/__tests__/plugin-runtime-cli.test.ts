import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createV2Package } from '../plugin-runtime/cli/create';
import { inspectV2Package } from '../plugin-runtime/cli/inspect';
import { packV2Package } from '../plugin-runtime/cli/pack';
import { buildV2Package } from '../plugin-runtime/cli/build';
import { validateV2Package } from '../plugin-runtime/cli/validate';

const repoRoot = resolve(import.meta.dirname, '../..');

/** Stand-in for Bun's bundler: deterministic output with the import inlined. */
function deterministicBundler() {
    return {
        async build() {
            return {
                success: true,
                outputs: [
                    {
                        text: async () =>
                            'const ready = true;\nexport { ready };\nexport default ready;\n',
                    },
                ],
                logs: [],
            };
        },
    };
}
const tempRoots: string[] = [];

afterEach(() => {
    while (tempRoots.length) {
        const root = tempRoots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const root = mkdtempSync(resolve(tmpdir(), prefix));
    tempRoots.push(root);
    return root;
}

describe('plugin-runtime CLI', () => {
    it('creates a minimal V2 package from the SDK template', () => {
        const directory = resolve(tempDir('or3-cli-create-'), 'plugin');
        const created = createV2Package({
            pluginId: 'or3.demo-cli',
            directory,
            repoRoot,
        });
        expect(created.pluginId).toBe('or3.demo-cli');
        const manifest = JSON.parse(
            readFileSync(resolve(directory, 'or3.manifest.json'), 'utf8')
        ) as { id: string; manifestVersion: number };
        expect(manifest).toMatchObject({
            id: 'or3.demo-cli',
            manifestVersion: 2,
        });
        expect(readFileSync(resolve(directory, 'client.mjs'), 'utf8')).toContain(
            'or3.demo-cli'
        );
    });

    it('validate reports stable conformance codes', async () => {
        const directory = resolve(tempDir('or3-cli-validate-'), 'plugin');
        createV2Package({
            pluginId: 'or3.validate-me',
            directory,
            repoRoot,
        });
        const ok = await validateV2Package(directory, { repoRoot });
        expect(ok.result.status).toBe('conformant');
        expect(ok.exitCode).toBe(0);

        writeFileSync(
            resolve(directory, 'client.mjs'),
            "import x from '~/private'; export default x;\n"
        );
        const bad = await validateV2Package(directory, { repoRoot });
        expect(bad.result.status).toBe('nonconformant');
        expect(bad.exitCode).toBe(1);
        if (bad.result.status === 'nonconformant') {
            expect(bad.result.issues.map((issue) => issue.code)).toContain(
                'private-host-import'
            );
        }
    });

    it('inspect reports digest/grants/trust without importing plugin code', async () => {
        const directory = resolve(tempDir('or3-cli-inspect-'), 'plugin');
        createV2Package({
            pluginId: 'or3.inspect-me',
            directory,
            repoRoot,
        });
        const report = await inspectV2Package(directory, { repoRoot });
        expect(report.importedPluginCode).toBe(false);
        expect(report.digest).toMatch(/^sha256-[a-f0-9]{64}$/);
        expect(report.grants).toContain('hooks.register');
        expect(report.trust).toBe('trusted-host');
        expect(report.stateCompatibility).toMatchObject({
            version: 1,
            rollback: 'safe',
        });
        expect(report.statePreflight).toMatchObject({
            status: 'eligible',
            code: 'state-initialization',
            operation: 'install',
            storedStateVersion: null,
            mutatesState: false,
        });
        expect(report.moduleGraph.some((entry) => entry.file === 'client.mjs')).toBe(
            true
        );
    });

    it('pack and build produce a stable digest across two runs', async () => {
        const directory = resolve(tempDir('or3-cli-pack-'), 'plugin');
        createV2Package({
            pluginId: 'or3.pack-me',
            directory,
            repoRoot,
        });
        // Bundling inlines the SDK import, which needs Bun. These assertions are
        // about digest stability, so the bundler is injected and stands in for it.
        const bundler = deterministicBundler();
        const first = await packV2Package(directory, {
            outputDirectory: resolve(directory, 'pack-a'),
        });
        const second = await packV2Package(directory, {
            outputDirectory: resolve(directory, 'pack-b'),
        });
        expect(first.verification.digest).toBe(second.verification.digest);

        const buildOne = await buildV2Package(directory, {
            buildDirectory: resolve(directory, 'dist-a'),
            packDirectory: resolve(directory, 'pack-build-a'),
            bundler,
        });
        const buildTwo = await buildV2Package(directory, {
            buildDirectory: resolve(directory, 'dist-b'),
            packDirectory: resolve(directory, 'pack-build-b'),
            bundler,
        });
        expect(buildOne.pack.verification.digest).toBe(
            buildTwo.pack.verification.digest
        );
        // The build tree is bundled, so it legitimately differs from the source
        // pack; what must hold is that the entry it packs is self-contained.
        const bundled = readFileSync(
            resolve(directory, 'dist-a', 'client.mjs'),
            'utf8'
        );
        expect(bundled).not.toContain("from '@or3/plugin-sdk'");
    });

    it('refuses to build a bare entry when no bundler is available', async () => {
        const directory = resolve(tempDir('or3-cli-nobundler-'), 'plugin');
        createV2Package({
            pluginId: 'or3.pack-me',
            directory,
            repoRoot,
        });
        // Node (no Bun) and no injected bundler: the package would be packed with
        // an import the sandbox cannot resolve, so the build fails with the reason.
        await expect(
            buildV2Package(directory, {
                buildDirectory: resolve(directory, 'dist-none'),
                packDirectory: resolve(directory, 'pack-none'),
            })
        ).rejects.toThrow(/Bun/);
    });
});
