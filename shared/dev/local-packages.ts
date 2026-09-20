import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sibling source checkouts that OR3 Chat aliases into Vite during
 * multi-repository development.
 *
 * Each candidate is resolved independently and only when the sibling checkout
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
 * projects). `OR3_USE_LOCAL_PACKAGES` forces either answer explicitly.
 */
export function localPackagesEnabled(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const configured = env.OR3_USE_LOCAL_PACKAGES?.trim();
    if (configured === 'true') return true;
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

/**
 * Resolve the sibling-source aliases for one workspace. Candidates are
 * independent: one unusable checkout never removes another's alias.
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
    for (const candidate of LOCAL_PACKAGE_CANDIDATES) {
        const resolved = resolveCandidate(projectRoot, candidate);
        if ('alias' in resolved) {
            aliases.push(resolved.alias);
            selected.push(`${candidate.packageName} -> ${resolved.alias.replacement}`);
        } else {
            skipped.push(`${candidate.packageName}: ${resolved.reason}`);
        }
    }
    return { enabled: true, aliases, selected, skipped };
}
