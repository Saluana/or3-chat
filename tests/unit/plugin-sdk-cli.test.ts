import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    readPackageZip,
    writeDeterministicPackageZip,
} from '../../packages/plugin-sdk/src/cli/archive';
import { buildV2Package } from '../../packages/plugin-sdk/src/cli/build';
import { checkV2PackageConformance } from '../../packages/plugin-sdk/src/cli/conformance';
import { createV2Package } from '../../packages/plugin-sdk/src/cli/create';
import { inspectV2Package } from '../../packages/plugin-sdk/src/cli/inspect';
import { packV2Package } from '../../packages/plugin-sdk/src/cli/pack';
import { validateV2Package } from '../../packages/plugin-sdk/src/cli/validate';
import { verifyPackageTree } from '../../packages/plugin-sdk/src/package-tree';
import { checkV2PackageConformance as hostCheckV2PackageConformance } from '../../scripts/plugin-runtime/check-v2-package-conformance';
import { buildArtifacts as buildPortableTemplateArtifacts } from '../../packages/plugin-sdk/templates/portable-v1/.authoring/profile.config.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');

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

function createPortable(prefix: string): string {
    const directory = resolve(tempDir(prefix), 'plugin');
    createV2Package({ pluginId: 'or3.demo-portable', directory });
    return directory;
}

describe('@or3/plugin-sdk standalone CLI', () => {
    it('creates a portable starter that is conformant with zero findings', async () => {
        const directory = createPortable('or3-sdk-cli-create-');
        const report = await validateV2Package(directory);
        expect(report.result.status).toBe('conformant');
        expect(report.result.issues).toEqual([]);
        expect(report.exitCode).toBe(0);

        const manifest = JSON.parse(
            readFileSync(resolve(directory, 'or3.manifest.json'), 'utf8')
        ) as { id: string; trust: string; features: { required: string[] } };
        expect(manifest.id).toBe('or3.demo-portable');
        expect(manifest.trust).toBe('isolated-client');
        expect(manifest.features.required).toContain('or3-portable-client-v1');
    });

    it('ships a portable-v1 authoring generator that matches the committed descriptors', () => {
        const templateRoot = resolve(repoRoot, 'packages/plugin-sdk/templates/portable-v1');
        const { files } = buildPortableTemplateArtifacts() as {
            files: Record<string, string>;
        };
        for (const [name, contents] of Object.entries(files)) {
            expect(readFileSync(resolve(templateRoot, name), 'utf8')).toBe(contents);
        }
        // Scaffolding rewrites the hidden generator with the new identity so
        // `profile:check` keeps working in the generated package.
        const directory = createPortable('or3-sdk-cli-authoring-');
        const config = readFileSync(
            resolve(directory, '.authoring/profile.config.mjs'),
            'utf8'
        );
        expect(config).toContain("id: 'or3.demo-portable'");
        expect(config).not.toContain('or3.example-plugin');
    });

    it('agrees with the host reviewer, including a multiline private import', async () => {
        const directory = createPortable('or3-sdk-cli-parity-');
        writeFileSync(
            resolve(directory, 'client.mjs'),
            "import {\n  x\n} from '~/private';\nexport default x;\n"
        );
        const sdk = await checkV2PackageConformance(directory);
        const host = await hostCheckV2PackageConformance(directory, { repoRoot });
        expect(sdk.status).toBe('nonconformant');
        expect(host.status).toBe('nonconformant');
        expect(sdk.issues.map((issue) => issue.code)).toContain('private-host-import');
        expect(sdk.issues).toEqual(host.issues);
    });

    it('skips non-shipped test and authoring files in the import scan', async () => {
        const directory = createPortable('or3-sdk-cli-scan-');
        writeFileSync(
            resolve(directory, 'client.test.mjs'),
            "import { createPluginTestHost } from '@or3/plugin-sdk/testing';\nexport default createPluginTestHost;\n"
        );
        mkdirSync(resolve(directory, '.authoring'), { recursive: true });
        writeFileSync(
            resolve(directory, '.authoring', 'profile.mjs'),
            "import { defineOr3PortableProfile } from '@or3/plugin-sdk/profile';\nexport default defineOr3PortableProfile;\n"
        );
        const sdk = await checkV2PackageConformance(directory);
        const host = await hostCheckV2PackageConformance(directory, { repoRoot });
        expect(sdk.status).toBe('conformant');
        expect(host.status).toBe('conformant');
    });

    it('build and pack produce a stable digest and byte-identical archives', async () => {
        const directory = createPortable('or3-sdk-cli-pack-');
        const output = tempDir('or3-sdk-cli-pack-out-');
        const first = await packV2Package(directory, {
            outputDirectory: resolve(output, 'pack-a'),
            archivePath: resolve(output, 'a.zip'),
        });
        const second = await packV2Package(directory, {
            outputDirectory: resolve(output, 'pack-b'),
            archivePath: resolve(output, 'b.zip'),
        });
        expect(first.verification.digest).toBe(second.verification.digest);
        expect(
            readFileSync(resolve(output, 'a.zip')).equals(
                readFileSync(resolve(output, 'b.zip'))
            )
        ).toBe(true);

        // `build` bundles the entry (Bun in production, injected here), so its
        // tree is self-contained and legitimately differs from the source pack.
        const bundler = {
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
        const build = await buildV2Package(directory, {
            buildDirectory: resolve(output, 'dist-build'),
            packDirectory: resolve(output, 'pack-build'),
            bundler,
        });
        const rebuilt = await buildV2Package(directory, {
            buildDirectory: resolve(output, 'dist-build-2'),
            packDirectory: resolve(output, 'pack-build-2'),
            bundler,
        });
        expect(build.pack.verification.digest).toBe(rebuilt.pack.verification.digest);
        expect(
            readFileSync(resolve(output, 'dist-build', 'client.mjs'), 'utf8')
        ).not.toContain("from '@or3/plugin-sdk'");
    });

    it('refuses to build a bare entry without a bundler', async () => {
        const directory = createPortable('or3-sdk-cli-nobundler-');
        const output = tempDir('or3-sdk-cli-nobundler-out-');
        await expect(
            buildV2Package(directory, {
                buildDirectory: resolve(output, 'dist-none'),
                packDirectory: resolve(output, 'pack-none'),
            })
        ).rejects.toThrow(/Bun/);
    });

    it('repacking to the same archive destination is byte-identical and never nests the archive', async () => {
        const directory = createPortable('or3-sdk-cli-pack-stable-');
        const archive = resolve(directory, 'plugin.or3pkg');
        const first = await packV2Package(directory, { archivePath: archive });
        const firstBytes = readFileSync(archive);
        const second = await packV2Package(directory, { archivePath: archive });
        const secondBytes = readFileSync(archive);

        expect(second.verification.digest).toBe(first.verification.digest);
        expect(secondBytes.equals(firstBytes)).toBe(true);

        const isTransport = (file: string): boolean =>
            file.endsWith('.or3pkg') || file.endsWith('.zip');
        expect(first.files.some(isTransport)).toBe(false);
        expect(second.files.some(isTransport)).toBe(false);
        expect(first.files).toEqual(second.files);
    });

    it('refuses an archive destination inside the pack tree', async () => {
        const directory = createPortable('or3-sdk-cli-pack-inside-');
        const packRoot = resolve(directory, '.or3-pack');
        await expect(
            packV2Package(directory, {
                archivePath: resolve(packRoot, 'plugin.or3pkg'),
            })
        ).rejects.toThrow(/inside the pack tree/);
    });

    it('inspect reads a root and an archive with the same digest and no findings', async () => {
        const directory = createPortable('or3-sdk-cli-inspect-');
        const output = tempDir('or3-sdk-cli-inspect-out-');
        const archive = resolve(output, 'package.or3pkg');
        await packV2Package(directory, {
            outputDirectory: resolve(output, 'pack-out'),
            archivePath: archive,
        });

        const fromRoot = await inspectV2Package(directory);
        const fromArchive = await inspectV2Package(archive);
        expect(fromRoot.conformanceStatus).toBe('conformant');
        expect(fromRoot.importedPluginCode).toBe(false);
        expect(fromRoot.trust).toBe('isolated-client');
        expect(fromRoot.statePreflight).toMatchObject({
            status: 'eligible',
            code: 'state-initialization',
            operation: 'install',
            storedStateVersion: null,
            mutatesState: false,
        });
        expect(fromArchive.digest).toBe(fromRoot.digest);
        expect(fromArchive.manifestDigest).toBe(fromRoot.manifestDigest);
        expect(fromArchive.statePreflight).toMatchObject({
            status: 'eligible',
            code: 'state-initialization',
        });

        const read = await readPackageZip(readFileSync(archive));
        expect(read.digest).toBe(fromRoot.digest);
    });

    it('inspects an archive by the digest of the artifact it verified', async () => {
        const directory = createPortable('or3-sdk-cli-archive-identity-');
        writeFileSync(resolve(directory, 'client.test.mjs'), 'export default 1;\n');
        mkdirSync(resolve(directory, 'empty-dir'), { recursive: true });

        const sourceDigest = (await verifyPackageTree(directory)).digest;
        const archiveA = await writeDeterministicPackageZip(directory);
        const pathA = resolve(tempDir('or3-sdk-cli-archive-a-'), 'a.or3pkg');
        writeFileSync(pathA, archiveA);
        const inspectedA = await inspectV2Package(pathA);
        expect(inspectedA.digest).toBe(sourceDigest);
        expect((await readPackageZip(archiveA)).digest).toBe(inspectedA.digest);

        // A second archive differing only in a non-shipped test file must not
        // collapse to the same digest as the first.
        writeFileSync(resolve(directory, 'client.test.mjs'), 'export default 2;\n');
        const archiveB = await writeDeterministicPackageZip(directory);
        const pathB = resolve(tempDir('or3-sdk-cli-archive-b-'), 'b.or3pkg');
        writeFileSync(pathB, archiveB);
        const inspectedB = await inspectV2Package(pathB);
        expect(inspectedB.digest).not.toBe(inspectedA.digest);
    });
});
