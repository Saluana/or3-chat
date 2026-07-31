import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_NAME = 'plugin-runtime:cli';

export function repoRootFromCli(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function sdkTemplateRoot(repoRoot = repoRootFromCli()): string {
    return resolve(repoRoot, 'packages/plugin-sdk/templates/minimal-v2');
}

export const PACK_IGNORE_NAMES = new Set([
    'node_modules',
    '.git',
    '.hg',
    '.svn',
    '.DS_Store',
    '.or3-pack',
    'dist',
    'coverage',
    '.turbo',
    '.output',
]);

export function posix(path: string): string {
    return path.split(sep).join('/');
}

export function ensureDir(path: string): void {
    mkdirSync(path, { recursive: true });
}

export function readJsonObject(path: string): Record<string, unknown> {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Expected JSON object at ${path}`);
    }
    return value as Record<string, unknown>;
}

export function writeStableJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

export function isShippablePackageFile(relativePath: string): boolean {
    if (TEST_FILE.test(relativePath)) return false;
    if (relativePath.includes('/__tests__/') || relativePath.startsWith('__tests__/')) {
        return false;
    }
    return true;
}

export function listPackageFiles(
    root: string,
    options: { readonly shippableOnly?: boolean; readonly excludeRoots?: readonly string[] } = {}
): string[] {
    const files: string[] = [];
    const excludeRoots = (options.excludeRoots ?? []).map((entry) => resolve(entry));
    const isExcluded = (absolute: string): boolean =>
        excludeRoots.some(
            (excluded) => absolute === excluded || absolute.startsWith(`${excluded}${sep}`)
        );
    const visit = (directory: string) => {
        if (isExcluded(directory)) return;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (PACK_IGNORE_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
            if (
                entry.name === 'dist' ||
                entry.name.startsWith('dist-') ||
                entry.name.startsWith('pack-')
            ) {
                continue;
            }
            const absolute = resolve(directory, entry.name);
            if (isExcluded(absolute)) continue;
            if (entry.isDirectory()) {
                if (entry.name === '__tests__') continue;
                visit(absolute);
            } else if (entry.isFile()) {
                const relativePath = posix(relative(root, absolute));
                if (options.shippableOnly && !isShippablePackageFile(relativePath)) continue;
                files.push(absolute);
            }
        }
    };
    visit(root);
    return files.sort((left, right) =>
        posix(relative(root, left)).localeCompare(posix(relative(root, right)))
    );
}

/** Copy shippable package files into a deterministic pack root (no node_modules). */
export function materializePackTree(sourceRoot: string, outputRoot: string): string[] {
    const absoluteSource = resolve(sourceRoot);
    const absoluteOutput = resolve(outputRoot);
    if (existsSync(absoluteOutput)) {
        rmSync(absoluteOutput, { recursive: true, force: true });
    }
    ensureDir(absoluteOutput);
    const copied: string[] = [];
    for (const file of listPackageFiles(absoluteSource, { shippableOnly: true })) {
        // Never re-pack previous build/pack outputs nested under the source tree.
        if (
            file === absoluteOutput ||
            file.startsWith(`${absoluteOutput}${sep}`) ||
            absoluteOutput.startsWith(`${file}${sep}`)
        ) {
            continue;
        }
        const relativePath = posix(relative(absoluteSource, file));
        if (
            relativePath === 'dist' ||
            relativePath.startsWith('dist/') ||
            relativePath.startsWith('dist-') ||
            relativePath.startsWith('pack-') ||
            relativePath.includes('/pack-')
        ) {
            continue;
        }
        const target = resolve(absoluteOutput, relativePath);
        ensureDir(dirname(target));
        if (basename(file) === 'or3.manifest.json' || basename(file) === 'package.json') {
            writeStableJson(target, readJsonObject(file));
        } else {
            cpSync(file, target);
        }
        copied.push(relativePath);
    }
    return copied;
}

export function assertPackageRoot(path: string): string {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        throw new Error(`Package root is not a directory: ${path}`);
    }
    if (!existsSync(resolve(root, 'or3.manifest.json'))) {
        throw new Error(`Missing or3.manifest.json under ${path}`);
    }
    return root;
}

export function printJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
