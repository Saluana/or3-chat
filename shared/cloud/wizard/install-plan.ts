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
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { getProviderDescriptor } from './catalog';
import type { WizardAnswers } from './types';

/** Supported package managers for dependency installation. */
export type InstallPackageManager = 'bun' | 'npm';

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

function resolveProviderLocalInstallSpec(
    packageName: string,
    instanceDir: string
): string | null {
    if (!packageName.startsWith('or3-provider-')) return null;
    const localProviderDir = resolve(instanceDir, '..', packageName);
    const providerPackageJson = resolve(localProviderDir, 'package.json');
    if (!existsSync(providerPackageJson)) return null;
    const providerPath = relative(instanceDir, localProviderDir).replaceAll('\\', '/');
    const normalizedPath = providerPath.startsWith('.') ? providerPath : `./${providerPath}`;
    return `file:${normalizedPath}`;
}

function resolveInstallSpecs(
    packageNames: string[],
    instanceDir: string
): string[] {
    return packageNames.map(
        (packageName) =>
            resolveProviderLocalInstallSpec(packageName, instanceDir) ?? packageName
    );
}

export function isInstallPackageManager(
    value: string
): value is InstallPackageManager {
    return value === 'bun' || value === 'npm';
}

export function parseInstallPackageManager(
    value?: string
): InstallPackageManager {
    if (!value) return 'bun';
    const normalized = value.trim().toLowerCase();
    if (isInstallPackageManager(normalized)) {
        return normalized;
    }
    throw new Error(
        `Invalid package manager "${value}". Expected one of: bun, npm.`
    );
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
 * - Always includes auth provider dependencies.
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

    const packages = Array.from(packageSet).sort();
    const installSpecs = resolveInstallSpecs(packages, answers.instanceDir);
    const themeArtifacts =
        answers.themeInstallMode === 'install-all'
            ? ['all-built-in-themes']
            : answers.themeInstallMode === 'install-selected'
              ? answers.themesToInstall
              : [];

    return {
        packages,
        reasons,
        themeArtifacts,
        commands: {
            bun: installSpecs.length > 0 ? `bun add ${installSpecs.join(' ')}` : 'bun add',
            npm: installSpecs.length > 0 ? `npm install ${installSpecs.join(' ')}` : 'npm install',
        },
    };
}

function runCommand(
    command: string,
    args: string[],
    cwd: string
): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd,
            stdio: 'inherit',
            env: process.env,
            shell: false,
        });

        child.on('error', (error) => {
            rejectPromise(error);
        });
        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(
                new Error(
                    `Install command failed with exit code ${code}: ${command} ${args.join(
                        ' '
                    )}`
                )
            );
        });
    });
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
    const installSpecs = resolveInstallSpecs(plan.packages, answers.instanceDir);

    if (options.packageManager === 'bun') {
        await runCommand('bun', ['add', ...installSpecs], answers.instanceDir);
        return;
    }

    await runCommand('npm', ['install', ...installSpecs], answers.instanceDir);
}
