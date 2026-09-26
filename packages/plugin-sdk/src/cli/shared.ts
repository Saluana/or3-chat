import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PACKAGE_SETUP_FILE, parseSetupDescriptor } from '../profile';

export const CLI_NAME = 'or3-plugin';

/** Absolute path of the installed `@or3/plugin-sdk` package root. */
export function packageRootFromCli(): string {
    return resolve(import.meta.dirname, '../..');
}

/** Absolute path of a bundled starter template. */
export function sdkTemplateRoot(
    template: string,
    packageRoot = packageRootFromCli()
): string {
    return resolve(packageRoot, 'templates', template);
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

/** True when `candidate` is `ancestor` or nested under it (both resolved safely). */
export function isWithinPath(ancestor: string, candidate: string): boolean {
    const parent = resolve(ancestor);
    const child = resolve(candidate);
    return child === parent || child.startsWith(`${parent}${sep}`);
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

/**
 * Lists every file actually present in an artifact, for artifact review.
 *
 * Artifact review must inspect the code that is really shipped, so unlike
 * packaging this applies no test/spec, dot-directory or build-output exclusions.
 * Only version-control and dependency directories are skipped, because they are
 * never part of a package artifact.
 */
export function listArtifactFiles(root: string): string[] {
    const files: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            const absolute = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                visit(absolute);
                continue;
            }
            if (entry.isFile()) files.push(absolute);
        }
    };
    visit(root);
    return files.sort((left, right) =>
        posix(relative(root, left)).localeCompare(posix(relative(root, right)))
    );
}

/**
 * Copy shippable package files into a deterministic pack root (no node_modules).
 *
 * `options.excludePaths` are removed from the source scan as well as the output
 * root, so a prior archive written next to the source can never be re-packed.
 * The packer and the runtime import scanner share one exclusion set (see
 * `PACK_IGNORE_NAMES`, dot-directories, and `isShippablePackageFile`).
 */
/**
 * The declared first-action sample must ship in the package. A missing file is a
 * build-time refusal, not a runtime surprise when a user runs the first action.
 */
export function findMissingDeclaredSample(input: {
    readonly packRoot: string;
    readonly files: readonly string[];
}): string | null {
    const setupPath = join(input.packRoot, PACKAGE_SETUP_FILE);
    if (!existsSync(setupPath)) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(setupPath, 'utf8')) as unknown;
    } catch {
        return null;
    }
    const parsed = parseSetupDescriptor(raw);
    const firstAction = parsed.value?.firstAction;
    if (!firstAction?.usesSampleContext || !firstAction.samplePath) return null;
    const wanted = posix(firstAction.samplePath);
    return input.files.includes(wanted) ? null : wanted;
}

export function materializePackTree(
    sourceRoot: string,
    outputRoot: string,
    options: { readonly excludePaths?: readonly string[] } = {}
): string[] {
    const absoluteSource = resolve(sourceRoot);
    const absoluteOutput = resolve(outputRoot);
    if (existsSync(absoluteOutput)) {
        rmSync(absoluteOutput, { recursive: true, force: true });
    }
    ensureDir(absoluteOutput);
    const excludeRoots = [
        absoluteOutput,
        ...(options.excludePaths ?? []).map((entry) => resolve(entry)),
    ];
    const copied: string[] = [];
    for (const file of listPackageFiles(absoluteSource, {
        shippableOnly: true,
        excludeRoots,
    })) {
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
