/**
 * @module shared/cloud/wizard/apply
 *
 * Purpose:
 * Writes validated wizard configuration to disk. Handles env file
 * merging, provider module file generation, and theme installation.
 *
 * Responsibilities:
 * - Non-destructive env file writing via `writeEnvFileDetailed()`
 * - Provider module file generation (`or3.providers.generated.ts`)
 * - Theme installation pipeline (no-op in v1 via `NoopThemeInstaller`)
 * - Dry-run mode for previewing changes without writing
 * - Backup creation before overwriting env files
 *
 * Non-responsibilities:
 * - Validation (must pass before apply; throws on failure)
 * - Deploy/boot commands (see deploy.ts)
 * - Session management (see api.ts)
 *
 * Constraints:
 * - `applyAnswers()` validates before writing and throws if validation fails.
 * - Only wizard-owned env keys are updated; existing unrelated keys,
 *   comments, and formatting are preserved.
 * - The provider modules file is always fully overwritten (not merged).
 *
 * @see writeEnvFileDetailed for the underlying env file writer
 * @see renderProviderModulesFile for the generated file format
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeEnvFileDetailed } from '../../../server/admin/config/env-file';
import { deriveWizardOwnedEnvUpdates } from './derive';
import { validateAnswers } from './validation';
import type { WizardAnswers, WizardApplyResult } from './types';

/**
 * Describes what themes would be installed and whether installation is supported.
 * In v1, `supported` is always `false` (no-op installer).
 */
export interface ThemeInstallPlan {
    mode: WizardAnswers['themeInstallMode'];
    themes: string[];
    /** When false, theme installation is a no-op. */
    supported: boolean;
    /** Advisory messages about installation limitations. */
    notes: string[];
}

/**
 * Interface for theme installation strategies.
 * Allows future implementations to install theme packages on demand.
 */
export interface ThemeInstaller {
    /** Compute an install plan without side effects. */
    plan(answers: WizardAnswers): ThemeInstallPlan;
    /** Execute the install plan (no-op when `plan.supported` is false). */
    execute(plan: ThemeInstallPlan): Promise<void>;
}

/**
 * No-op theme installer for v1.
 * Always returns `supported: false` and does nothing on `execute()`.
 * The `OR3_DEFAULT_THEME` env var is still written by the apply layer.
 */

export class NoopThemeInstaller implements ThemeInstaller {
    plan(answers: WizardAnswers): ThemeInstallPlan {
        const notes: string[] = [];
        if (answers.themeInstallMode !== 'use-existing') {
            notes.push(
                'Theme installation pipeline is not enabled in v1; only OR3_DEFAULT_THEME is written.'
            );
        }
        return {
            mode: answers.themeInstallMode,
            themes: answers.themesToInstall,
            supported: false,
            notes,
        };
    }

    async execute(_plan: ThemeInstallPlan): Promise<void> {
        return;
    }
}

/**
 * Renders the contents of `or3.providers.generated.ts` from a list of
 * Nuxt module IDs. The output is a self-contained TypeScript module
 * that exports the `or3ProviderModules` array.
 *
 * @example
 * ```ts
 * renderProviderModulesFile(['or3-provider-basic-auth/nuxt', 'or3-provider-sqlite/nuxt'])
 * // => '// Overwritten by the cloud install wizard.\n// ...\nexport const or3ProviderModules: ...'
 * ```
 */
export function renderProviderModulesFile(modules: string[]): string {
    const lines = [
        '// Overwritten by the cloud install wizard.',
        '// Keep this file tiny and explicit.',
        '',
        `export const or3ProviderModules: readonly string[] = ${JSON.stringify(modules, null, 4)};`,
        '',
    ];
    return lines.join('\n');
}

/** Resolves the absolute path to `or3.providers.generated.ts` in the instance directory. */
export function getProviderModuleFilePath(instanceDir: string): string {
    return resolve(instanceDir, 'or3.providers.generated.ts');
}

/**
 * Validates answers, then writes env file and provider module file to disk.
 *
 * Behavior:
 * 1. Runs `validateAnswers()` and throws if validation fails.
 * 2. Derives wizard-owned env updates from the validated answers.
 * 3. Optionally executes theme installation plan.
 * 4. Writes env file via `writeEnvFileDetailed()` with optional backup.
 * 5. Writes `or3.providers.generated.ts` with selected provider modules.
 *
 * Constraints:
 * - In dry-run mode (`options.dryRun` or `answers.dryRun`), no files are
 *   written but the result describes what would have been written.
 * - Backup creation defaults to `!answers.skipWriteBackup`.
 *
 * @throws Error when validation fails (joined error messages).
 */
export async function applyAnswers(
    answers: WizardAnswers,
    options: {
        dryRun?: boolean;
        createBackup?: boolean;
        themeInstaller?: ThemeInstaller;
    } = {}
): Promise<WizardApplyResult> {
    const validation = validateAnswers(answers);
    if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
    }

    const dryRun = options.dryRun ?? answers.dryRun;
    const envUpdates = deriveWizardOwnedEnvUpdates(validation.derived.env);
    const providerModuleFilePath = getProviderModuleFilePath(answers.instanceDir);
    const backupFiles: string[] = [];
    const writtenFiles: string[] = [];

    const themeInstaller = options.themeInstaller ?? new NoopThemeInstaller();
    const themePlan = themeInstaller.plan(answers);
    if (!dryRun && themePlan.supported) {
        await themeInstaller.execute(themePlan);
    }

    if (!dryRun) {
        const envWrite = await writeEnvFileDetailed(envUpdates, {
            instanceDir: answers.instanceDir,
            envFile: answers.envFile,
            createBackup: options.createBackup ?? !answers.skipWriteBackup,
        });
        if (envWrite.changed) writtenFiles.push(envWrite.path);
        if (envWrite.backupPath) backupFiles.push(envWrite.backupPath);

        await writeFile(
            providerModuleFilePath,
            renderProviderModulesFile(validation.derived.providerModules),
            'utf8'
        );
        writtenFiles.push(providerModuleFilePath);
    }

    return {
        writtenFiles,
        backupFiles,
        envUpdates,
        providerModules: validation.derived.providerModules,
        dryRun,
    };
}
