import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { satisfies } from 'semver';
import ts from 'typescript';

/**
 * Sibling source checkouts that OR3 Chat aliases into Vite during
 * multi-repository development.
 *
 * Coupled workflow candidates are resolved together and only when the sibling checkout
 * really is the expected package and still ships the aliased source file, so a
 * missing, renamed or half-checked-out repository degrades to the installed
 * registry package for that one import instead of breaking the whole build.
 */
export interface LocalPackageCandidate {
    /** Package name the sibling `package.json` must declare. */
    readonly packageName: string;
    /** Module specifier to alias. */
    readonly find: string | RegExp;
    /** Sibling checkout, relative to the workspace root (the parent of this app). */
    readonly sibling: string;
    /** Aliased source file, relative to the sibling checkout. */
    readonly entry: string;
}

export interface LocalPackageAlias {
    readonly find: string | RegExp;
    readonly replacement: string;
}

export interface LocalPackageResolution {
    /** True when sibling sources are in scope at all (dev, or an explicit opt-in). */
    readonly enabled: boolean;
    readonly aliases: readonly LocalPackageAlias[];
    /** `package -> replacement`, for the startup log. */
    readonly selected: readonly string[];
    /** `package: reason`, for the startup log. */
    readonly skipped: readonly string[];
}

interface PackageManifest {
    readonly name?: string;
    readonly version: string;
    readonly dependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
    readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

function readManifest(path: string): PackageManifest {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown as PackageManifest;
}

export const LOCAL_PACKAGE_CANDIDATES: readonly LocalPackageCandidate[] = [
    {
        packageName: 'or3-scroll',
        find: /^or3-scroll$/,
        sibling: 'or3-vsc',
        entry: 'src/lib/index.ts',
    },
    {
        packageName: 'or3-workflow-vue',
        find: /^or3-workflow-vue\/style\.css$/,
        sibling: 'or3-workflows/packages/workflow-vue',
        entry: 'src/styles/variables.css',
    },
    {
        packageName: 'or3-workflow-vue',
        find: /^or3-workflow-vue$/,
        sibling: 'or3-workflows/packages/workflow-vue',
        entry: 'src/index.ts',
    },
    {
        packageName: 'or3-workflow-core',
        find: /^or3-workflow-core$/,
        sibling: 'or3-workflows/packages/workflow-core',
        entry: 'src/index.ts',
    },
];

/**
 * Sibling sources are a development affordance: they are on by default for
 * `nuxt dev` and off everywhere else (builds, deployment images, generated
 * projects). `OR3_USE_LOCAL_PACKAGES=false` disables them in development; production never opts in.
 */
export function localPackagesEnabled(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const configured = env.OR3_USE_LOCAL_PACKAGES?.trim();
    if (env.NODE_ENV !== 'development') return false;
    if (configured === 'false') return false;
    return env.NODE_ENV === 'development';
}

function siblingRoot(
    projectRoot: string,
    candidate: LocalPackageCandidate,
): string {
    return resolve(projectRoot, '..', candidate.sibling);
}

/** One sibling checkout is usable only when its manifest and source agree. */
function resolveCandidate(
    projectRoot: string,
    candidate: LocalPackageCandidate,
): { readonly alias: LocalPackageAlias } | { readonly reason: string } {
    const root = siblingRoot(projectRoot, candidate);
    const manifestPath = resolve(root, 'package.json');
    if (!existsSync(manifestPath)) return { reason: `no ${candidate.sibling} checkout` };

    let declaredName: unknown;
    try {
        declaredName = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
    } catch {
        return { reason: `${candidate.sibling}/package.json is unreadable` };
    }
    if (declaredName !== candidate.packageName) {
        return {
            reason: `${candidate.sibling} declares "${String(declaredName)}"`,
        };
    }

    const replacement = resolve(root, candidate.entry);
    if (!existsSync(replacement)) {
        return { reason: `${candidate.sibling}/${candidate.entry} is missing` };
    }
    return { alias: { find: candidate.find, replacement } };
}

/** Check declared package ranges and the reachable relative source graph before aliasing. */
function validateSource(projectRoot: string, candidate: LocalPackageCandidate): string | null {
    const root = siblingRoot(projectRoot, candidate);
    const manifest = readManifest(resolve(root, 'package.json'));
    const hostManifestPath = resolve(projectRoot, 'package.json');
    if (existsSync(hostManifestPath)) {
        const host = readManifest(hostManifestPath);
        const range = host.dependencies?.[candidate.packageName];
        if (range && !satisfies(manifest.version, range)) {
            return candidate.packageName + '@' + manifest.version + ' does not satisfy host range ' + range;
        }
    }
    const require = createRequire(resolve(root, 'package.json'));
    for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
        if (manifest.peerDependenciesMeta?.[name]?.optional) continue;
        try {
            const local = LOCAL_PACKAGE_CANDIDATES.find((value) => value.packageName === name);
            let path = local ? resolve(siblingRoot(projectRoot, local), 'package.json') : '';
            if (!path) {
                let dir = dirname(require.resolve(name));
                for (;;) {
                    path = resolve(dir, 'package.json');
                    if (existsSync(path) && readManifest(path).name === name) break;
                    const parent = dirname(dir);
                    if (parent === dir) throw new Error('manifest missing');
                    dir = parent;
                }
            }
            const version = readManifest(path).version;
            const wanted = String(range).replace(/^workspace:/, '');
            if (!satisfies(version, wanted)) return candidate.packageName + ' requires ' + name + '@' + wanted + ', found ' + version;
        } catch { return candidate.packageName + ' cannot resolve dependency ' + name + '@' + range; }
    }
    const visited = new Set<string>();
    const visit = (path: string): string | null => {
        if (visited.has(path)) return null;
        visited.add(path);
        if (!/\.(?:[cm]?[jt]sx?|vue)$/.test(path)) return null;
        let text = readFileSync(path, 'utf8');
        if (extname(path) === '.vue') text = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
        for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
            const specifier = imported.fileName;
            if (!specifier.startsWith('.')) continue;
            const base = resolve(dirname(path), specifier.replace(/\?.*$/, ''));
            const stem = base.replace(/\.[cm]?js$/, '');
            const target = [base, ...['.ts', '.tsx', '.js', '.mjs', '.vue', '/index.ts', '/index.js'].map((suffix) => stem + suffix)]
                .find((entry) => existsSync(entry) && statSync(entry).isFile());
            if (!target) return candidate.packageName + ' source import is missing: ' + specifier + ' from ' + path;
            const failure = visit(target);
            if (failure) return failure;
        }
        return null;
    };
    return visit(resolve(root, candidate.entry));
}

/**
 * Resolve the sibling-source aliases for one workspace. Candidates are
 * grouped for workflows: an unusable core or UI rejects the entire pair.
 */
export function resolveLocalPackageAliases(
    projectRoot: string,
    env: NodeJS.ProcessEnv = process.env,
): LocalPackageResolution {
    if (!localPackagesEnabled(env)) {
        return { enabled: false, aliases: [], selected: [], skipped: [] };
    }

    const aliases: LocalPackageAlias[] = [];
    const selected: string[] = [];
    const skipped: string[] = [];
    const results = LOCAL_PACKAGE_CANDIDATES.map((candidate) => ({ candidate, result: resolveCandidate(projectRoot, candidate) }));
    const workflows = results.filter(({ candidate }) => candidate.packageName.startsWith('or3-workflow-'));
    const groupFailure = workflows.find(({ result }) => 'reason' in result);
    let workflowReason = groupFailure && 'reason' in groupFailure.result ? groupFailure.result.reason : null;
    if (!workflowReason) {
        for (const { candidate } of workflows) {
            workflowReason = validateSource(projectRoot, candidate);
            if (workflowReason) break;
        }
    }
    for (const { candidate, result } of results) {
        const reason = candidate.packageName.startsWith('or3-workflow-') ? workflowReason :
            ('alias' in result ? validateSource(projectRoot, candidate) : null);
        const resolved = reason ? { reason: 'Local package group rejected: ' + reason } : result;
        if ('alias' in resolved) {
            aliases.push(resolved.alias);
            selected.push(`${candidate.packageName} -> ${resolved.alias.replacement}`);
        } else {
            skipped.push(`${candidate.packageName}: ${resolved.reason}`);
        }
    }
    return { enabled: true, aliases, selected, skipped };
}
