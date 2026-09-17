import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertPackageRoot, materializePackTree, readJsonObject } from './shared';
import { packV2Package, type PackCommandResult } from './pack';

export interface BuildCommandResult {
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly files: readonly string[];
    readonly pack: PackCommandResult;
}

/** Bare specifiers the contained sandbox cannot resolve at runtime. */
const BARE_IMPORT = /(?:^|[^\w.])import\s*(?:[\s\S]*?from\s*)?['"]([^.'"][^'"]*)['"]/gm;

/**
 * Bundle the declared client entry so the packaged module is self-contained.
 *
 * The sandbox imports exactly one blob URL: it has no import map, no network and
 * no package resolution, so a `@or3/plugin-sdk` import must already be inlined by
 * the time the package is packed. Bundling here (rather than asking authors to
 * hand-configure a bundler) keeps `or3-plugin validate` and `or3-plugin pack`
 * agreeing about what "self-contained" means.
 */
export async function bundleClientEntry(
    sourceRoot: string,
    buildRoot: string
): Promise<void> {
    const manifest = readJsonObject(resolve(sourceRoot, 'or3.manifest.json'));
    const runtime = manifest?.runtime;
    const client =
        runtime && typeof runtime === 'object'
            ? (runtime as { client?: { entry?: unknown } }).client
            : undefined;
    const entry = client && typeof client.entry === 'string' ? client.entry : undefined;
    if (!entry) return;
    if (entry.includes('..') || entry.startsWith('/')) {
        throw new Error(`Refusing to bundle an unsafe client entry path: ${entry}`);
    }

    // Bun is the supported package runtime. When it is unavailable (for example
    // under a Node-only test runner) the copied tree is left untouched so the
    // caller sees exactly what it packed.
    const bun = (globalThis as { Bun?: { build: (options: unknown) => Promise<{
        success: boolean;
        outputs: { text(): Promise<string> }[];
        logs: unknown[];
    }> } }).Bun;
    if (!bun) return;

    const result = await bun.build({
        entrypoints: [resolve(sourceRoot, entry)],
        target: 'browser',
        format: 'esm',
        // Minification strips bundler comments, which would otherwise contain
        // the author's install layout and make the packed digest host-dependent.
        minify: true,
        sourcemap: 'none',
        external: [],
    });
    if (!result.success || result.outputs.length !== 1) {
        throw new Error(
            `Bundling ${entry} failed: ${result.outputs.length} outputs, success=${result.success}`
        );
    }
    const code = await result.outputs[0]!.text();
    const remaining = [...code.matchAll(BARE_IMPORT)].map((match) => match[1]);
    if (remaining.length > 0) {
        throw new Error(
            `Bundled ${entry} still imports ${remaining.join(', ')}; the sandbox cannot resolve bare specifiers`
        );
    }
    writeFileSync(resolve(buildRoot, entry), code, 'utf8');
}

/**
 * Materialize a deterministic build tree, then pack it.
 * Two builds of an unchanged package must share the same canonical digest.
 */
export async function buildV2Package(
    packageRoot: string,
    options: {
        readonly buildDirectory?: string;
        readonly packDirectory?: string;
    } = {}
): Promise<BuildCommandResult> {
    const sourceRoot = assertPackageRoot(packageRoot);
    const buildRoot = resolve(options.buildDirectory ?? resolve(sourceRoot, 'dist'));
    const files = materializePackTree(sourceRoot, buildRoot);
    await bundleClientEntry(sourceRoot, buildRoot);
    const pack = await packV2Package(buildRoot, {
        outputDirectory: options.packDirectory ?? resolve(sourceRoot, '.or3-pack'),
    });
    return {
        sourceRoot,
        buildRoot,
        files: Object.freeze(files.slice().sort()),
        pack,
    };
}
