import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve } from 'node:path';
import { assertPackageRoot, isWithinPath, materializePackTree, readJsonObject } from './shared';
import { packV2Package, type PackCommandResult } from './pack';
import { moduleSpecifiers } from '../conformance-engine';

export interface BuildCommandResult {
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly files: readonly string[];
    readonly pack: PackCommandResult;
}

/** The subset of Bun's bundler this step needs, so it is injectable in tests. */
export interface ClientEntryBundler {
    build(options: unknown): Promise<{
        success: boolean;
        outputs: { text(): Promise<string>; path?: string; kind?: string }[];
        logs: unknown[];
    }>;
}

function formatBundleDiagnostics(error: unknown): string {
    const record = error && typeof error === 'object' ? error as {
        message?: string;
        errors?: unknown[];
    } : null;
    const details = record?.errors?.map((item) => {
        const diagnostic = item && typeof item === 'object' ? item as {
            message?: string;
            position?: { file?: string; line?: number; column?: number; lineText?: string };
        } : null;
        const position = diagnostic?.position;
        const location = position?.file
            ? `${position.file}:${position.line ?? 0}:${position.column ?? 0}`
            : '';
        return [location, diagnostic?.message ?? '', position?.lineText ?? ''].filter(Boolean).join(' ');
    }).filter(Boolean);
    return details?.length ? details.join('\n') : record?.message ?? String(error);
}

function bundledBareImports(source: string): readonly string[] {
    const BunRuntime = (globalThis as {
        Bun?: { Transpiler?: new (options: { loader: 'js' }) => {
            scanImports(source: string): readonly { path: string }[];
        } };
    }).Bun;
    if (!BunRuntime?.Transpiler) return unresolvedBareImports(source);
    const imports = new BunRuntime.Transpiler({ loader: 'js' }).scanImports(source);
    return [...new Set(imports.map((entry) => entry.path))].filter((specifier) =>
        !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(specifier)
    );
}

async function trustedVueSfcPlugin(sourceRoot: string) {
    const { parse, compileScript, compileTemplate, compileStyle, rewriteDefault } = await import('vue/compiler-sfc');
    const canonicalRoot = realpathSync(sourceRoot);
    const manifest = readJsonObject(resolve(sourceRoot, 'or3.manifest.json'));
    const identity = `${String(manifest.id)}@${String(manifest.version)}`;
    return {
        name: 'or3-trusted-vue-sfc',
        setup(build: {
            onLoad(filter: { filter: RegExp }, handler: (input: { path: string }) => Promise<{ contents: string; loader: 'ts' }>): void;
        }) {
            build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
                if (!isWithinPath(canonicalRoot, realpathSync(path))) {
                    throw new Error(`Vue component escapes package root: ${path}`);
                }
                const source = readFileSync(path, 'utf8');
                const parsed = parse(source, { filename: path });
                if (parsed.errors.length) {
                    throw new Error(`Invalid Vue component ${path}: ${parsed.errors.join(', ')}`);
                }
                const descriptor = parsed.descriptor;
                const hash = createHash('sha256')
                    .update(identity).update('\0')
                    .update(relative(canonicalRoot, realpathSync(path))).update('\0')
                    .update(source).digest('hex').slice(0, 12);
                const scopeId = `data-v-${hash}`;
                let contents: string;
                if (descriptor.scriptSetup) {
                    contents = compileScript(descriptor, { id: scopeId, inlineTemplate: true }).content;
                } else {
                    const script = descriptor.script
                        ? compileScript(descriptor, { id: scopeId }).content
                        : 'export default {}';
                    const template = descriptor.template && compileTemplate({
                        source: descriptor.template.content,
                        filename: path,
                        id: scopeId,
                        scoped: descriptor.styles.some((style) => style.scoped),
                    });
                    if (template?.errors.length) {
                        throw new Error(`Invalid Vue template ${path}: ${template.errors.join(', ')}`);
                    }
                    contents = rewriteDefault(script, '__or3_component', ['typescript']);
                    if (template) {
                        contents += `\n${template.code.replace('export function render', 'function __or3_render')}\n__or3_component.render = __or3_render;`;
                    }
                }
                if (descriptor.scriptSetup) {
                    contents = rewriteDefault(contents, '__or3_component', ['typescript']);
                }
                if (descriptor.styles.length) {
                    const css = descriptor.styles.map((style) => {
                        if (style.lang && style.lang !== 'css') {
                            throw new Error(`Unsupported Vue style language in ${path}: ${style.lang}`);
                        }
                        const stylePath = style.src ? resolve(dirname(path), style.src) : path;
                        if (!isWithinPath(canonicalRoot, realpathSync(stylePath))) {
                            throw new Error(`Vue style escapes package root: ${style.src}`);
                        }
                        const styleSource = style.src ? readFileSync(stylePath, 'utf8') : style.content;
                        const compiled = compileStyle({
                            source: styleSource,
                            filename: stylePath,
                            id: scopeId,
                            scoped: style.scoped,
                        });
                        if (compiled.errors.length) {
                            throw new Error(`Invalid Vue style ${stylePath}: ${compiled.errors.join(', ')}`);
                        }
                        return compiled.code;
                    }).join('\n');
                    contents += `\nimport { onMounted as __or3_onMounted, onUnmounted as __or3_onUnmounted } from 'vue';\n`;
                    if (descriptor.styles.some((style) => style.scoped)) {
                        contents += `__or3_component.__scopeId = ${JSON.stringify(scopeId)};\n`;
                    }
                    contents += `
const __or3_styleId = ${JSON.stringify(`or3-sfc-${hash}`)};
const __or3_styleText = ${JSON.stringify(css)};
let __or3_styleUsers = 0;
const __or3_originalSetup = __or3_component.setup;
__or3_component.setup = function (props, context) {
    __or3_onMounted(() => {
        if (!document.getElementById(__or3_styleId)) {
            const style = document.createElement('style');
            style.id = __or3_styleId;
            style.textContent = __or3_styleText;
            document.head.append(style);
        }
        __or3_styleUsers += 1;
    });
    __or3_onUnmounted(() => {
        __or3_styleUsers -= 1;
        if (__or3_styleUsers === 0) document.getElementById(__or3_styleId)?.remove();
    });
    return __or3_originalSetup?.call(this, props, context);
};
`;
                }
                contents += '\nexport default __or3_component;';
                return { contents, loader: 'ts' };
            });
        },
    };
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
    const runtime = manifest.runtime;
    const client =
        runtime && typeof runtime === 'object'
            ? (runtime as { client?: { entry?: unknown; isolation?: unknown } }).client
            : undefined;
    const entry = client && typeof client.entry === 'string' ? client.entry : undefined;
    if (!entry) return;
    const trustedHost = manifest.trust === 'trusted-host' && client?.isolation === 'host';
    if (entry.includes('..') || entry.startsWith('/')) {
        throw new Error(`Refusing to bundle an unsafe client entry path: ${entry}`);
    }

    // A self-contained entry needs no bundling, so packaging a hand-written
    // single-file plugin keeps working without a bundler.
    const source = readFileSync(resolve(sourceRoot, entry), 'utf8');
    if (!trustedHost && unresolvedBareImports(source).length === 0) return;

    // The shipped executable runs under Bun. Direct API callers must also use
    // Bun or supply a bundler explicitly.
    const bundler =
        options.bundler ??
        (globalThis as { Bun?: ClientEntryBundler }).Bun;
    if (!bundler) {
        throw new Error(
            `${entry} imports a bare specifier, so it must be bundled before it can be packed, ` +
                'and bundling needs Bun. Run the installed `or3-plugin` executable with Bun on PATH.'
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
        external: trustedHost ? ['vue', '@or3/plugin-sdk'] : [],
        ...(trustedHost ? { plugins: [await trustedVueSfcPlugin(sourceRoot)] } : {}),
    }).catch((error: unknown) => {
        throw new Error(`Bundling ${entry} failed:\n${formatBundleDiagnostics(error)}`);
    });
    const entryOutput = result.outputs.find((output) => output.kind === 'entry-point') ??
        (result.outputs.length === 1 ? result.outputs[0] : undefined);
    const extraOutputs = result.outputs.filter((output) => output !== entryOutput);
    const stylesheet = trustedHost && extraOutputs.length === 1 &&
        extraOutputs[0]?.path?.endsWith('.css') ? extraOutputs[0] : undefined;
    if (!result.success || !entryOutput || extraOutputs.length > (stylesheet ? 1 : 0)) {
        throw new Error(
            `Bundling ${entry} failed: ${result.logs.length ? formatBundleDiagnostics({ errors: result.logs }) : 'unexpected build outputs'}; outputs: ${result.outputs.map((output) => output.path ?? output.kind ?? 'unknown').join(', ')}`
        );
    }
    const stylesheetName = entry.replace(/\.[^.]+$/, '.css').split('/').at(-1);
    const code = (await entryOutput.text()) +
        (stylesheet && stylesheetName
            ? `\nexport const __or3PluginStylesheet = './${stylesheetName}';\n`
            : '');
    const remaining = bundledBareImports(code).filter(
        (specifier) => !trustedHost || (specifier !== 'vue' && specifier !== '@or3/plugin-sdk')
    );
    if (remaining.length > 0) {
        throw new Error(
            `Bundled ${entry} still imports ${remaining.join(', ')}; the sandbox cannot resolve bare specifiers`
        );
    }
    writeFileSync(resolve(buildRoot, entry), code, 'utf8');
    if (stylesheet && stylesheetName) {
        writeFileSync(resolve(buildRoot, entry.replace(/\.[^.]+$/, '.css')), await stylesheet.text(), 'utf8');
    }
}

/** Bundle declared server handlers so immutable ZIPs need no sibling node_modules. */
export async function bundleServerRoutes(
    sourceRoot: string,
    buildRoot: string,
    options: { readonly bundler?: ClientEntryBundler } = {}
): Promise<void> {
    const manifest = readJsonObject(resolve(sourceRoot, 'or3.manifest.json'));
    const runtime = manifest.runtime as { server?: { routes?: Array<{ handler?: unknown }> } } | undefined;
    const routes = runtime?.server?.routes ?? [];
    if (!Array.isArray(routes)) throw new Error('Server routes must be an array');
    const entries = [...new Set(routes.map((route) => route.handler))];
    const canonicalRoot = realpathSync(sourceRoot);
    for (const entry of entries) {
        if (typeof entry !== 'string' || entry.startsWith('/') || entry.includes('..') ||
            !['.mjs', '.js'].includes(extname(entry))) {
            throw new Error(`Invalid server handler path: ${String(entry)}`);
        }
        const sourcePath = realpathSync(resolve(sourceRoot, entry));
        if (!isWithinPath(canonicalRoot, sourcePath)) {
            throw new Error(`Server handler escapes package root: ${entry}`);
        }
        if (moduleSpecifiers(readFileSync(sourcePath, 'utf8')).length === 0) continue;
        const bundler = options.bundler ?? (globalThis as { Bun?: ClientEntryBundler }).Bun;
        if (!bundler) {
            throw new Error(`Bundling server handler ${entry} needs Bun. Run or3-plugin with Bun on PATH.`);
        }
        const result = await bundler.build({
            entrypoints: [sourcePath],
            target: 'bun',
            format: 'esm',
            minify: true,
            sourcemap: 'none',
            external: [],
        }).catch((error: unknown) => {
            throw new Error(`Bundling server handler ${entry} failed:\n${formatBundleDiagnostics(error)}`);
        });
        if (!result.success || result.outputs.length !== 1) {
            throw new Error(`Bundling server handler ${entry} failed: ${formatBundleDiagnostics({ errors: result.logs })}`);
        }
        const code = await result.outputs[0]!.text();
        const remaining = unresolvedBareImports(code);
        if (remaining.length) {
            throw new Error(`Bundled server handler ${entry} still imports ${remaining.join(', ')}`);
        }
        writeFileSync(resolve(buildRoot, entry), code, 'utf8');
    }
}

/** Bare specifiers that would survive into the sandbox. */
export function unresolvedBareImports(source: string): readonly string[] {
    const found = new Set<string>();
    for (const specifier of moduleSpecifiers(source)) {
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
        /** Test seam; production uses Bun's bundler. */
        readonly bundler?: ClientEntryBundler;
    } = {}
): Promise<BuildCommandResult> {
    const sourceRoot = assertPackageRoot(packageRoot);
    const buildRoot = resolve(options.buildDirectory ?? resolve(sourceRoot, 'dist'));
    const files = materializePackTree(sourceRoot, buildRoot);
    await bundleClientEntry(sourceRoot, buildRoot, {
        ...(options.bundler ? { bundler: options.bundler } : {}),
    });
    await bundleServerRoutes(sourceRoot, buildRoot, {
        ...(options.bundler ? { bundler: options.bundler } : {}),
    });
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
