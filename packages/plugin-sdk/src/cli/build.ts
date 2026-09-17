import { readFileSync, writeFileSync } from 'node:fs';
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

/** The subset of Bun's bundler this step needs, so it is injectable in tests. */
export interface ClientEntryBundler {
    build(options: unknown): Promise<{
        success: boolean;
        outputs: { text(): Promise<string> }[];
        logs: unknown[];
    }>;
}

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
    buildRoot: string,
    options: { readonly bundler?: ClientEntryBundler } = {}
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

    // A self-contained entry needs no bundling, so packaging a hand-written
    // single-file plugin keeps working without a bundler.
    const source = readFileSync(resolve(sourceRoot, entry), 'utf8');
    if (unresolvedBareImports(source).length === 0) return;

    // Bundling needs Bun's bundler. The shipped executable has a Node shebang, so
    // this is exactly where a Node run lands: fail with the reason instead of
    // packing a package whose SDK import no sandbox can resolve.
    const bundler =
        options.bundler ??
        (globalThis as { Bun?: ClientEntryBundler }).Bun;
    if (!bundler) {
        throw new Error(
            `${entry} imports a bare specifier, so it must be bundled before it can be packed, ` +
                'and bundling needs Bun. Run `bunx or3-plugin build` (Bun is the supported ' +
                'package runtime), or bundle the entry yourself so it imports nothing at runtime.'
        );
    }

    const result = await bundler.build({
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
    const remaining = unresolvedBareImports(code);
    if (remaining.length > 0) {
        throw new Error(
            `Bundled ${entry} still imports ${remaining.join(', ')}; the sandbox cannot resolve bare specifiers`
        );
    }
    writeFileSync(resolve(buildRoot, entry), code, 'utf8');
}

/** Bare specifiers that would survive into the sandbox. */
export function unresolvedBareImports(source: string): readonly string[] {
    const found = new Set<string>();
    for (const match of source.matchAll(BARE_IMPORT)) {
        const specifier = match[1];
        if (!specifier) continue;
        if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) continue;
        found.add(specifier);
    }
    return Object.freeze([...found]);
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
