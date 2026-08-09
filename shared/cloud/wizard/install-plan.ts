/**
 * @module shared/cloud/wizard/install-plan
 *
 * Purpose:
 * Generates and optionally executes dependency install plans based on
 * selected providers. Determines which npm/bun packages need to be added
 * to the instance project.
 *
 * Responsibilities:
 * - `createDependencyInstallPlan()`: collects packages from provider
 *   descriptors with reasons for transparency
 * - `executeDependencyInstallPlan()`: runs `bun add` or `npm install`
 *   when installation is enabled
 * - Package manager detection and validation
 *
 * Non-responsibilities:
 * - Theme installation (see apply.ts `ThemeInstaller`)
 * - Provider runtime registration (handled by provider packages)
 *
 * Constraints:
 * - Installation is behind an `enabled` flag (not auto-executed in v1).
 * - Dry-run mode skips execution but still generates the plan.
 * - Only `bun` and `npm` are supported as package managers.
 * - Theme artifacts are listed for transparency but not installed by this
 *   module (theme packaging is not yet implemented).
 *
 * @see providerCatalog for dependency declarations
 * @see DependencyInstallPlan for the plan structure
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { getProviderDescriptor } from './catalog';
import { resolveEffectiveConnectProvider } from './connect-provider';
import { usesSqliteProvider } from './provider-usage';
import { QUALIFIED_PROVIDER_VERSIONS } from './provider-versions';
import {
    formatCommand,
    installCommand,
    isPackageManager,
    parsePackageManager,
    runForegroundCommand,
    type PackageManager,
} from './package-manager';
import type { WizardAnswers } from './types';

/** Supported package managers for dependency installation. */
export type InstallPackageManager = PackageManager;

/**
 * Describes what packages would be installed and why.
 * Generated from provider catalog dependencies based on selected providers.
 */
export interface DependencyInstallPlan {
    /** Sorted, deduplicated list of package names to install. */
    packages: string[];
    /** Maps package name to an array of human-readable reasons. */
    reasons: Record<string, string[]>;
    /** Theme artifacts listed for transparency (not installed by this module). */
    themeArtifacts: string[];
    /** Pre-formatted install commands for both package managers. */
    commands: {
        bun: string;
        npm: string;
    };
}

function buildDependencyInstallPlan(
    packageNames: Iterable<string>,
    reasons: Record<string, string[]>,
    instanceDir: string,
    themeArtifacts: string[] = []
): DependencyInstallPlan {
    const packages = Array.from(new Set(packageNames)).sort();
    const installSpecs = resolveInstallSpecs(packages, instanceDir);
    const bunCommand = installCommand('bun', installSpecs);
    const npmCommand = installCommand('npm', installSpecs);

    return {
        packages,
        reasons,
        themeArtifacts,
        commands: {
            bun: formatCommand(bunCommand),
            npm: formatCommand(npmCommand),
        },
    };
}

function resolveProviderLocalInstallSpec(
    packageName: string,
    instanceDir: string
): string | null {
    if (!packageName.startsWith('or3-provider-')) return null;
    let cursor = instanceDir;
    let localProviderDir: string | null = null;

    for (;;) {
        const candidate = resolve(cursor, '..', packageName);
        const providerPackageJson = resolve(candidate, 'package.json');
        if (existsSync(providerPackageJson)) {
            localProviderDir = candidate;
            break;
        }

        const parent = resolve(cursor, '..');
        if (parent === cursor) {
            break;
        }
        cursor = parent;
    }

    if (!localProviderDir) return null;

    const providerPath = relative(instanceDir, localProviderDir).replaceAll('\\', '/');
    const normalizedPath = providerPath.startsWith('.') ? providerPath : `./${providerPath}`;
    return `file:${normalizedPath}`;
}

function resolveInstallSpecs(
    packageNames: string[],
    instanceDir: string
): string[] {
    return packageNames.map(
        (packageName) => {
            const localSpec = resolveProviderLocalInstallSpec(
                packageName,
                instanceDir
            );
            if (localSpec) return localSpec;
            const qualifiedVersion = QUALIFIED_PROVIDER_VERSIONS[packageName];
            return qualifiedVersion
                ? `${packageName}@${qualifiedVersion}`
                : packageName;
        }
    );
}

function readExistingDependencySpecs(instanceDir: string): Map<string, string> {
    const packageJsonPath = resolve(instanceDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
        return new Map();
    }

    const raw = readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
    };

    const all = {
        ...parsed.dependencies,
        ...parsed.devDependencies,
        ...parsed.peerDependencies,
        ...parsed.optionalDependencies,
    };
    return new Map(Object.entries(all));
}

function isDependencySpecSatisfied(
    existingSpec: string | undefined,
    requestedSpec: string
): boolean {
    if (!existingSpec) return false;

    // Local/file specs must match exactly so local-vs-registry intent is preserved.
    if (requestedSpec.startsWith('file:')) {
        return existingSpec === requestedSpec;
    }

    // Bare package names (no explicit version/range) mean "ensure present".
    // Any existing dependency spec satisfies this.
    return requestedSpec === existingSpec || !requestedSpec.includes('@');
}

function isPackageInstalled(instanceDir: string, packageName: string): boolean {
    const packageJsonPath = resolve(instanceDir, 'node_modules', packageName, 'package.json');
    return existsSync(packageJsonPath);
}

export function isInstallPackageManager(
    value: string
): value is InstallPackageManager {
    return isPackageManager(value);
}

export function parseInstallPackageManager(
    value?: string
): InstallPackageManager {
    return parsePackageManager(value);
}

function addReason(
    reasons: Record<string, string[]>,
    packageName: string,
    reason: string
): void {
    if (!reasons[packageName]) {
        reasons[packageName] = [];
    }
    reasons[packageName].push(reason);
}

/**
 * Builds an install plan by collecting dependencies from all selected
 * provider descriptors in the catalog.
 *
 * Behavior:
 * - Includes provider dependencies only when `ssrAuthEnabled` is true.
 * - Includes sync/storage provider dependencies only when enabled.
 * - Packages are deduplicated; reasons accumulate if multiple providers
 *   require the same package (e.g. `better-sqlite3`).
 *
 * @example
 * ```ts
 * const plan = createDependencyInstallPlan(answers);
 * console.log(plan.commands.bun);
 * // => 'bun add better-sqlite3 file:../or3-provider-basic-auth ...'
 * ```
 */
export function createDependencyInstallPlan(
    answers: WizardAnswers
): DependencyInstallPlan {
    const packageSet = new Set<string>();
    const reasons: Record<string, string[]> = {};

    if (answers.ssrAuthEnabled) {
        const authProvider = getProviderDescriptor('auth', answers.authProvider);
        authProvider?.dependencies.forEach((dependency) => {
            packageSet.add(dependency.packageName);
            addReason(reasons, dependency.packageName, dependency.reason);
        });

        if (answers.syncEnabled) {
            const syncProvider = getProviderDescriptor('sync', answers.syncProvider);
            syncProvider?.dependencies.forEach((dependency) => {
                packageSet.add(dependency.packageName);
                addReason(reasons, dependency.packageName, dependency.reason);
            });
        }

        if (answers.storageEnabled) {
            const storageProvider = getProviderDescriptor('storage', answers.storageProvider);
            storageProvider?.dependencies.forEach((dependency) => {
                packageSet.add(dependency.packageName);
                addReason(reasons, dependency.packageName, dependency.reason);
            });
        }

        if (answers.connectEnabled) {
            const connectProviderId = resolveEffectiveConnectProvider(answers);
            const connectProvider = getProviderDescriptor(
                'sync',
                connectProviderId
            );
            connectProvider?.dependencies.forEach((dependency) => {
                packageSet.add(dependency.packageName);
                addReason(
                    reasons,
                    dependency.packageName,
                    `OR3 Connect persistence: ${dependency.reason}`
                );
            });
        }

        const usesSqlite = usesSqliteProvider(answers);
        if (usesSqlite) {
            const sqliteDriver = answers.sqliteDriver ?? 'better-sqlite3';
            if (sqliteDriver === 'better-sqlite3') {
                packageSet.add('better-sqlite3');
                addReason(
                    reasons,
                    'better-sqlite3',
                    'SQLite runtime selected in the wizard.'
                );
            } else if (sqliteDriver === 'turso') {
                packageSet.add('libsql');
                addReason(
                    reasons,
                    'libsql',
                    'Turso/libSQL runtime selected in the wizard.'
                );
            }
        }
    }

    const themeArtifacts =
        answers.themeInstallMode === 'install-all'
            ? ['all-built-in-themes']
            : answers.themeInstallMode === 'install-selected'
              ? answers.themesToInstall
              : [];

    return buildDependencyInstallPlan(
        packageSet,
        reasons,
        answers.instanceDir,
        themeArtifacts
    );
}

function patchNitroPluginImports(filePath: string): void {
    if (!existsSync(filePath)) return;
    const source = readFileSync(filePath, 'utf8');

    const needsDefineNitroPlugin = source.includes('defineNitroPlugin(')
        && !source.includes('defineNitroPlugin } from "#imports"')
        && !source.includes("defineNitroPlugin } from '#imports'")
        && !/import\s*\{[^}]*\bdefineNitroPlugin\b[^}]*\}\s*from\s*['"]#imports['"]/.test(source);
    const needsRuntimeConfig = source.includes('useRuntimeConfig(')
        && !/import\s*\{[^}]*\buseRuntimeConfig\b[^}]*\}\s*from\s*['"]#imports['"]/.test(source);

    if (!needsDefineNitroPlugin && !needsRuntimeConfig) return;

    const importMatch = source.match(/import\s*\{\s*([^}]*)\s*\}\s*from\s*['"]#imports['"];?/);
    let next = source;

    if (importMatch && importMatch[0]) {
        const existing = importMatch[1]
            ?.split(',')
            .map((part) => part.trim())
            .filter(Boolean) ?? [];
        const names = new Set(existing);
        if (needsDefineNitroPlugin) names.add('defineNitroPlugin');
        if (needsRuntimeConfig) names.add('useRuntimeConfig');
        const replacement = `import { ${Array.from(names).join(', ')} } from \"#imports\";`;
        next = next.replace(importMatch[0], replacement);
    } else {
        const imports: string[] = [];
        if (needsDefineNitroPlugin) imports.push('defineNitroPlugin');
        if (needsRuntimeConfig) imports.push('useRuntimeConfig');
        next = `import { ${imports.join(', ')} } from \"#imports\";\n${next}`;
    }

    if (next !== source) {
        writeFileSync(filePath, next, 'utf8');
    }
}

function collectJsFiles(dirPath: string): string[] {
    if (!existsSync(dirPath)) return [];

    const files: string[] = [];
    for (const entry of readdirSync(dirPath)) {
        const absPath = resolve(dirPath, entry);
        const stats = statSync(absPath);
        if (stats.isDirectory()) {
            files.push(...collectJsFiles(absPath));
            continue;
        }
        if (stats.isFile() && absPath.endsWith('.js')) {
            files.push(absPath);
        }
    }

    return files;
}

function patchInstalledProviderPlugins(instanceDir: string, packages: string[]): void {
    const providerPackages = packages.filter((name) => name.startsWith('or3-provider-'));
    for (const packageName of providerPackages) {
        const serverRuntimeDir = resolve(
            instanceDir,
            'node_modules',
            packageName,
            'dist/runtime/server'
        );
        for (const filePath of collectJsFiles(serverRuntimeDir)) {
            patchNitroPluginImports(filePath);
        }
    }
}

/**
 * Executes a dependency install plan using the specified package manager.
 *
 * Constraints:
 * - No-op when `options.enabled` is false or `plan.packages` is empty.
 * - No-op in dry-run mode.
 * - Runs `bun add` or `npm install` with `stdio: 'inherit'`.
 *
 * @throws Error when the install command exits with a non-zero code.
 */
export async function executeDependencyInstallPlan(
    answers: WizardAnswers,
    plan: DependencyInstallPlan,
    options: {
        enabled: boolean;
        packageManager: InstallPackageManager;
        dryRun?: boolean;
    }
): Promise<void> {
    if (!isInstallPackageManager(options.packageManager)) {
        throw new Error(
            `Invalid package manager "${String(
                options.packageManager
            )}". Expected bun or npm.`
        );
    }
    if (!options.enabled) return;
    if (plan.packages.length === 0) return;
    if (options.dryRun) return;
    const providerPackages = plan.packages.filter((name) =>
        name.startsWith('or3-provider-')
    );
    const installSpecs = resolveInstallSpecs(plan.packages, answers.instanceDir);
    const existingSpecs = readExistingDependencySpecs(answers.instanceDir);
    const specsToInstall = installSpecs.filter((spec, index) => {
        const packageName = plan.packages[index];
        if (!packageName) return true;
        if (!isPackageInstalled(answers.instanceDir, packageName)) return true;
        return !isDependencySpecSatisfied(existingSpecs.get(packageName), spec);
    });
    if (specsToInstall.length === 0) {
        patchInstalledProviderPlugins(answers.instanceDir, providerPackages);
        return;
    }

    const command = installCommand(options.packageManager, specsToInstall);
    await runForegroundCommand(command, {
        cwd: answers.instanceDir,
        label: 'Install dependencies',
    });
    patchInstalledProviderPlugins(answers.instanceDir, providerPackages);
}
