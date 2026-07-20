import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

type Mode = 'ssr' | 'static';

const repoRoot = resolve(import.meta.dir, '../..');
const outputRoot = resolve(repoRoot, '.output');
const publicRoot = resolve(outputRoot, 'public');
const serverRoot = resolve(outputRoot, 'server');
const modeArg = process.argv[process.argv.indexOf('--mode') + 1] as Mode | undefined;

const BUILTIN_SENTINEL = 'Create document';
const V1_FIXTURE_SENTINEL = 'or3-v1-build-fixture:message-action';
const NON_CLIENT_SENTINEL = 'or3-v1-build-fixture:must-not-bundle';
const CATALOG_SENTINEL = 'or3-bundled-plugin-catalog:v1';

function fail(message: string): never {
    throw new Error(`[plugin-runtime-build:${modeArg ?? 'unknown'}] ${message}`);
}

function executableFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    const result: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (['.js', '.mjs', '.cjs', '.html'].includes(extname(entry.name))) result.push(path);
        }
    };
    visit(root);
    return result;
}

function findMarker(files: string[], marker: string): string[] {
    return files.filter((file) => readFileSync(file, 'utf8').includes(marker));
}

if (modeArg !== 'ssr' && modeArg !== 'static') fail('pass --mode ssr or --mode static');
if (!existsSync(publicRoot)) fail('missing .output/public');
if (modeArg === 'ssr' && !existsSync(resolve(serverRoot, 'index.mjs'))) {
    fail('SSR build is missing .output/server/index.mjs');
}
if (modeArg === 'static' && !existsSync(resolve(publicRoot, 'index.html'))) {
    fail('static generation is missing .output/public/index.html');
}

const publicFiles = executableFiles(publicRoot);
const serverFiles = executableFiles(serverRoot);
const fixtureFiles = findMarker(publicFiles, V1_FIXTURE_SENTINEL);
const builtinFiles = findMarker(publicFiles, BUILTIN_SENTINEL);
const catalogFiles = findMarker(publicFiles, CATALOG_SENTINEL);

if (!fixtureFiles.length) fail('bundled V1 workspace plugin sentinel is absent from public client output');
if (!builtinFiles.length) fail('current built-in message action sentinel is absent from public client output');
if (!catalogFiles.length) fail('generated bundled-plugin catalog is absent from public client output');
if (findMarker(publicFiles, NON_CLIENT_SENTINEL).length) {
    fail('a non-client workspace fixture leaked into public output');
}
if (findMarker(serverFiles, V1_FIXTURE_SENTINEL).length) {
    fail('the client-only V1 workspace fixture leaked into server executable output');
}
if (findMarker(serverFiles, NON_CLIENT_SENTINEL).length) {
    fail('a non-client workspace fixture leaked into server executable output');
}

const fixtureChunks = fixtureFiles.map((file) => relative(repoRoot, file)).sort();
console.log(
    `[plugin-runtime-build:${modeArg}] verified built-ins and bundled V1 fixture in ${fixtureChunks.join(', ')}; client fixture absent from server output`
);
