#!/usr/bin/env bun
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';
import {
    buildRedactedSummary,
    summarizeValidationErrors,
} from '../../shared/cloud/wizard/validation';
import { createDefaultAnswers, recommendedPreset } from '../../shared/cloud/wizard/catalog';
import { getWizardSteps } from '../../shared/cloud/wizard/steps';
import { readEnvFile } from '../../server/admin/config/env-file';
import {
    buildOr3CloudConfigFromEnv,
    buildOr3ConfigFromEnv,
} from '../../server/admin/config/resolve-config';
import { applyConvexEnv } from '../../shared/cloud/wizard/deploy';
import {
    createDependencyInstallPlan,
    executeDependencyInstallPlan,
    parseInstallPackageManager,
} from '../../shared/cloud/wizard/install-plan';
import { readLastSessionId, readSession } from '../../shared/cloud/wizard/store';
import type { WizardAnswers, WizardField } from '../../shared/cloud/wizard/types';

type CliFlags = {
    [key: string]: string | boolean | undefined;
};

function parseFlags(args: string[]): { command: string; rest: string[]; flags: CliFlags } {
    const [command = 'help', ...restArgs] = args;
    const rest: string[] = [];
    const flags: CliFlags = {};

    for (let index = 0; index < restArgs.length; index += 1) {
        const value = restArgs[index];
        if (!value.startsWith('--')) {
            rest.push(value);
            continue;
        }
        const key = value.slice(2);
        const next = restArgs[index + 1];
        if (!next || next.startsWith('--')) {
            flags[key] = true;
            continue;
        }
        flags[key] = next;
        index += 1;
    }

    return { command, rest, flags };
}

function toStringFlag(flags: CliFlags, key: string): string | undefined {
    const value = flags[key];
    return typeof value === 'string' ? value : undefined;
}

function toBooleanFlag(flags: CliFlags, key: string): boolean {
    return flags[key] === true;
}

function hasFlag(flags: CliFlags, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(flags, key);
}

function toInt(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.trunc(parsed);
}

function normalizeAnswers(sessionAnswers: Partial<WizardAnswers>): WizardAnswers {
    return {
        ...createDefaultAnswers({
            instanceDir: sessionAnswers.instanceDir ?? process.cwd(),
            envFile: sessionAnswers.envFile,
            presetName: sessionAnswers.presetName,
        }),
        ...sessionAnswers,
    };
}

class Prompt {
    private readonly rl = readline.createInterface({ input, output });

    async close(): Promise<void> {
        this.rl.close();
    }

    async text(label: string, defaultValue?: string, required = false): Promise<string> {
        while (true) {
            const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : '';
            const answer = (await this.rl.question(`${label}${suffix}: `)).trim();
            if (!answer && defaultValue !== undefined) return defaultValue;
            if (!answer && required) {
                console.log('Value is required.');
                continue;
            }
            return answer;
        }
    }

    async boolean(label: string, defaultValue: boolean): Promise<boolean> {
        const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
        while (true) {
            const answer = (await this.rl.question(`${label}${suffix}: `)).trim().toLowerCase();
            if (!answer) return defaultValue;
            if (['y', 'yes'].includes(answer)) return true;
            if (['n', 'no'].includes(answer)) return false;
            console.log('Please enter y or n.');
        }
    }

    async select(
        label: string,
        options: Array<{ label: string; value: unknown }>,
        defaultValue?: unknown
    ): Promise<unknown> {
        console.log(label);
        let defaultIndex = 0;
        options.forEach((option, index) => {
            if (defaultValue !== undefined && option.value === defaultValue) {
                defaultIndex = index;
            }
            console.log(`  ${index + 1}. ${option.label}`);
        });
        const answer = await this.text('Choose number', String(defaultIndex + 1), true);
        const index = toInt(answer);
        if (index === null || index < 1 || index > options.length) {
            console.log('Invalid selection. Using default.');
            return options[defaultIndex]?.value;
        }
        return options[index - 1]?.value;
    }

    async multiString(label: string, currentValue: string[]): Promise<string[]> {
        const defaultValue = currentValue.join(',');
        const answer = await this.text(label, defaultValue);
        if (!answer.trim()) return [];
        return answer
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
    }

    private async readHiddenLine(): Promise<string> {
        return new Promise((resolve) => {
            const previousRawMode = input.isTTY ? Boolean(input.isRaw) : false;
            let value = '';

            const cleanup = () => {
                input.off('data', onData);
                if (input.isTTY) {
                    input.setRawMode?.(previousRawMode);
                }
                this.rl.resume();
            };

            const finish = (nextValue: string) => {
                cleanup();
                resolve(nextValue);
            };

            const onData = (chunk: Buffer) => {
                const text = chunk.toString('utf8');
                for (const char of text) {
                    if (char === '\r' || char === '\n') {
                        output.write('\n');
                        finish(value);
                        return;
                    }

                    if (char === '\u0003') {
                        cleanup();
                        output.write('\n');
                        process.kill(process.pid, 'SIGINT');
                        return;
                    }

                    if (char === '\u007f' || char === '\b') {
                        value = value.slice(0, -1);
                        continue;
                    }

                    if (char < ' ') {
                        continue;
                    }

                    value += char;
                }
            };

            this.rl.pause();
            if (input.isTTY) {
                input.setRawMode?.(true);
            }
            input.resume();
            input.on('data', onData);
        });
    }

    async password(
        label: string,
        options: { required?: boolean; hasCurrent?: boolean } = {}
    ): Promise<string> {
        const required = options.required ?? false;
        const hasCurrent = options.hasCurrent ?? false;
        if (!input.isTTY || !output.isTTY) {
            return this.text(
                hasCurrent
                    ? `${label} (leave blank to keep current value)`
                    : label,
                undefined,
                required && !hasCurrent
            );
        }

        while (true) {
            const suffix = hasCurrent ? ' (leave blank to keep current value)' : '';
            output.write(`${label}${suffix}: `);
            const answer = await this.readHiddenLine();
            if (!answer && hasCurrent) return '';
            if (!answer && required) {
                console.log('Value is required.');
                continue;
            }
            return answer;
        }
    }
}

function printBanner(): void {
    console.log(`
  ╔══════════════════════════════════════╗
  ║                                      ║
  ║     ⚡  OR3 Cloud Setup Wizard  ⚡    ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  This wizard will walk you through setting up
  your OR3 Chat instance step by step.

  Press Enter to accept defaults shown in [brackets].
  Type your answer to change a value.
`);
}

function printStepHeader(index: number, total: number, title: string, description?: string): void {
    const bar = '─'.repeat(40);
    console.log(`\n${bar}`);
    console.log(`  Step ${index + 1} of ${total}: ${title}`);
    console.log(bar);
    if (description) {
        for (const line of description.split('\n')) {
            console.log(`  ${line}`);
        }
        console.log('');
    }
}

function printFieldHelp(help: string): void {
    console.log(`  💡 ${help}`);
}

async function promptField(
    prompt: Prompt,
    field: WizardField,
    answers: WizardAnswers
): Promise<unknown> {
    const currentValue = answers[field.key];
    switch (field.type) {
        case 'boolean':
            return prompt.boolean(
                field.label,
                typeof currentValue === 'boolean'
                    ? currentValue
                    : (field.defaultValue as boolean | undefined) ?? false
            );
        case 'select':
            return prompt.select(
                field.label,
                field.options ?? [],
                currentValue ?? field.defaultValue
            );
        case 'number': {
            while (true) {
                const answer = await prompt.text(
                    field.label,
                    currentValue !== undefined
                        ? String(currentValue)
                        : field.defaultValue !== undefined
                          ? String(field.defaultValue)
                          : undefined,
                    field.required
                );
                const parsed = toInt(answer);
                if (parsed === null) {
                    console.log('Please enter a valid number.');
                    continue;
                }
                return parsed;
            }
        }
        case 'multi-string':
            return prompt.multiString(
                field.label,
                Array.isArray(currentValue) ? currentValue.map(String) : []
            );
        case 'password': {
            const hasCurrentValue =
                typeof currentValue === 'string' && currentValue.length > 0;
            const value = await prompt.password(field.label, {
                required: field.required && !hasCurrentValue,
                hasCurrent: hasCurrentValue,
            });
            if (!value && hasCurrentValue) {
                return currentValue;
            }
            return value;
        }
        case 'text':
        default: {
            const value = await prompt.text(
                field.label,
                typeof currentValue === 'string' ? currentValue : undefined,
                field.required
            );
            return value;
        }
    }
}

function printHelp(): void {
    console.log(`or3-cloud commands

  or3-cloud init [--preset recommended|legacy-clerk-convex] [--instance-dir <path>] [--env-file .env|.env.local] [--dry-run] [--manual] [--enable-install] [--package-manager bun|npm]
  or3-cloud validate [--env-file .env|.env.local] [--strict]
  or3-cloud presets list
  or3-cloud presets save <name> [--session <id>]
  or3-cloud presets load <name>
  or3-cloud presets delete <name>
  or3-cloud deploy [--session <id>]
`);
}

async function runInit(flags: CliFlags): Promise<void> {
    printBanner();
    const api = new Or3CloudWizardApi();
    const prompt = new Prompt();
    const manualMode = toBooleanFlag(flags, 'manual');
    const dryRun = toBooleanFlag(flags, 'dry-run');
    const strict = hasFlag(flags, 'strict') ? toBooleanFlag(flags, 'strict') : undefined;
    const autoInstallDependencies =
        toBooleanFlag(flags, 'enable-install') ||
        process.env.OR3_WIZARD_ENABLE_INSTALL === '1';
    const packageManager = parseInstallPackageManager(
        toStringFlag(flags, 'package-manager')
    );

    try {
        const session = await api.createSession({
            presetName:
                toStringFlag(flags, 'preset') ?? recommendedPreset.name,
            instanceDir: toStringFlag(flags, 'instance-dir') ?? process.cwd(),
            envFile: (toStringFlag(flags, 'env-file') as '.env' | '.env.local') ?? '.env',
            includeSecrets: false,
        });

        let stepIndex = 0;
        while (true) {
            const latestSession = await api.getSession(session.id, {
                includeSecrets: true,
            });
            const answers = normalizeAnswers(latestSession.answers);
            const steps = getWizardSteps(answers);
            if (stepIndex >= steps.length) break;
            const step = steps[stepIndex];
            if (!step) break;
            if (step.canSkip?.(answers)) {
                stepIndex += 1;
                continue;
            }

            printStepHeader(stepIndex, steps.length, step.title, step.description);

            if (step.id === 'review') {
                const review = await api.review(session.id);
                console.log('\n' + review.summary + '\n');
                const confirm = await prompt.boolean('Does this look right? Apply it?', true);
                if (confirm) break;

                console.log('\n  Which step would you like to change?\n');
                const editable = steps.filter((candidate) => candidate.id !== 'review');
                editable.forEach((candidate, index) => {
                    console.log(`  ${index + 1}. ${candidate.title}`);
                });
                const selected = await prompt.text(
                    'Enter step number to edit',
                    String(Math.max(1, editable.length))
                );
                const selectedIndex = toInt(selected);
                if (
                    selectedIndex !== null &&
                    selectedIndex > 0 &&
                    selectedIndex <= editable.length
                ) {
                    const targetStepId = editable[selectedIndex - 1]?.id;
                    const nextIndex = steps.findIndex(
                        (candidate) => candidate.id === targetStepId
                    );
                    stepIndex = nextIndex >= 0 ? nextIndex : 0;
                    continue;
                }
                stepIndex = 0;
                continue;
            }

            const patch: Partial<WizardAnswers> = {};
            for (const field of step.fields) {
                if (field.help) {
                    printFieldHelp(field.help);
                }
                while (true) {
                    const value = await promptField(prompt, field, answers);
                    const validationError =
                        typeof field.validate === 'function'
                            ? field.validate(value as never, answers)
                            : null;
                    if (validationError) {
                        console.log(validationError);
                        continue;
                    }
                    patch[field.key] = value as never;
                    break;
                }
            }

            if (step.id === 'target') {
                patch.dryRun = dryRun || Boolean(patch.dryRun);
            }

            await api.submitAnswers(session.id, patch);
            stepIndex += 1;
        }

        const latestSession = await api.getSession(session.id, { includeSecrets: true });
        const answers = normalizeAnswers(latestSession.answers);
        const validation = await api.validate(
            session.id,
            strict === undefined ? {} : { strict }
        );
        if (!validation.ok) {
            console.log('\n  ❌ Some settings need fixing:\n');
            console.log(summarizeValidationErrors(validation));
            return;
        }

        if (validation.warnings.length > 0) {
            console.log('\n  ⚠️  Heads up:');
            for (const warning of validation.warnings) {
                console.log(`    - ${warning}`);
            }
        }

        const installPlan = createDependencyInstallPlan(answers);
        let dependenciesInstalled = false;
        if (installPlan.packages.length > 0) {
            console.log('\n  📦 Packages to install:');
            installPlan.packages.forEach((packageName) => {
                const reasons = installPlan.reasons[packageName] ?? [];
                console.log(`    - ${packageName}`);
                reasons.forEach((reason) => console.log(`      ${reason}`));
            });
            if (installPlan.themeArtifacts.length > 0) {
                console.log('- Theme artifacts (planned):');
                installPlan.themeArtifacts.forEach((artifact) =>
                    console.log(`  ${artifact}`)
                );
            }
            console.log(`- Bun command: ${installPlan.commands.bun}`);
            console.log(`- npm command: ${installPlan.commands.npm}`);
            if (autoInstallDependencies) {
                await executeDependencyInstallPlan(answers, installPlan, {
                    enabled: true,
                    packageManager,
                    dryRun,
                });
                dependenciesInstalled = !dryRun;
            } else {
                const shouldInstall = await prompt.boolean(
                    `Install these packages now with ${packageManager}?`,
                    true
                );
                if (shouldInstall) {
                    await executeDependencyInstallPlan(answers, installPlan, {
                        enabled: true,
                        packageManager,
                        dryRun,
                    });
                    dependenciesInstalled = !dryRun;
                }
            }
        }

        if (manualMode) {
            console.log('\nManual setup summary:\n');
            console.log(buildRedactedSummary(answers));
            const deployNow = await prompt.boolean('Run deploy commands now?', false);
            if (deployNow) {
                const result = await api.deploy(session.id);
                if (result.instructions) {
                    console.log(result.instructions);
                }
            }
            return;
        }

        const applyResult = await api.apply(session.id, {
            dryRun,
            createBackup: !toBooleanFlag(flags, 'no-backup'),
        });
        console.log('\n  ✅ Setup complete!\n');
        if (applyResult.dryRun) {
            console.log('  This was a dry run — no files were changed.');
        } else {
            if (applyResult.writtenFiles.length > 0) {
                console.log('  Files saved:');
                for (const file of applyResult.writtenFiles) {
                    console.log(`    ✓ ${file}`);
                }
            } else {
                console.log('  No file changes were needed.');
            }
            if (applyResult.backupFiles.length > 0) {
                console.log('  Backups created:');
                for (const file of applyResult.backupFiles) {
                    console.log(`    ↩ ${file}`);
                }
            }
        }

        if (
            answers.authProvider === 'clerk' &&
            (answers.syncProvider === 'convex' || answers.storageProvider === 'convex')
        ) {
            const shouldSetConvexEnv = await prompt.boolean(
                'Set Convex backend env vars now?',
                true
            );
            if (shouldSetConvexEnv) {
                const convexResult = await applyConvexEnv(answers, { dryRun });
                if (convexResult.warnings.length > 0) {
                    console.log('\nConvex preflight warnings:');
                    for (const warning of convexResult.warnings) {
                        console.log(`- ${warning}`);
                    }
                }
                if (convexResult.commands.length > 0 && dryRun) {
                    console.log('\nPlanned Convex commands:');
                    convexResult.commands.forEach((command) =>
                        console.log(`- ${command}`)
                    );
                }
            }
        }

        const presetName = await prompt.text(
            'Save this setup as a reusable template? Enter a name or press Enter to skip',
            ''
        );
        if (presetName.trim()) {
            await api.savePreset(session.id, presetName.trim());
            console.log(`Preset "${presetName.trim()}" saved.`);
        }

        const deployNow = await prompt.boolean(
            answers.deploymentTarget === 'local-dev'
                ? 'Start local dev now?'
                : 'Run production build now?',
            !dryRun
        );
        if (deployNow) {
            if (dryRun) {
                console.log('\n  Dry run mode: skipping startup commands.');
                return;
            }
            if (
                installPlan.packages.length > 0 &&
                !dependenciesInstalled
            ) {
                const shouldInstallBeforeDeploy = await prompt.boolean(
                    `Starting OR3 Cloud requires these packages. Install now with ${packageManager}?`,
                    true
                );
                if (!shouldInstallBeforeDeploy) {
                    console.log('\n  Start skipped. Install dependencies first with:');
                    console.log(
                        `  ${
                            packageManager === 'bun'
                                ? installPlan.commands.bun
                                : installPlan.commands.npm
                        }`
                    );
                    return;
                }
                await executeDependencyInstallPlan(answers, installPlan, {
                    enabled: true,
                    packageManager,
                    dryRun,
                });
            }
            const deployResult = await api.deploy(session.id);
            if (deployResult.instructions) {
                console.log(deployResult.instructions);
            }
        }
    } finally {
        await prompt.close();
    }
}

async function runValidate(flags: CliFlags): Promise<void> {
    const envFile = (toStringFlag(flags, 'env-file') as '.env' | '.env.local') ?? '.env';
    const { map } = await readEnvFile({
        instanceDir: process.cwd(),
        envFile,
    });
    const strict = hasFlag(flags, 'strict') ? toBooleanFlag(flags, 'strict') : undefined;
    try {
        buildOr3ConfigFromEnv(map);
        buildOr3CloudConfigFromEnv(map, strict === undefined ? {} : { strict });
        console.log(`Validation passed for ${envFile}.`);
    } catch (error) {
        console.log(`Validation failed for ${envFile}:`);
        console.log((error as Error).message);
        process.exitCode = 1;
    }
}

async function resolveSessionId(flags: CliFlags): Promise<string> {
    const explicit = toStringFlag(flags, 'session');
    if (explicit) return explicit;
    const last = await readLastSessionId();
    if (!last) {
        throw new Error('No session id provided and no previous session found.');
    }
    return last;
}

async function runPresets(rest: string[], flags: CliFlags): Promise<void> {
    const api = new Or3CloudWizardApi();
    const [action = 'list', name] = rest;

    if (action === 'list') {
        const presets = await api.listPresets();
        presets.forEach((preset) => {
            console.log(`${preset.name} (${preset.createdAt})`);
        });
        return;
    }

    if (action === 'save') {
        if (!name) {
            throw new Error('Preset name is required for save.');
        }
        const sessionId = await resolveSessionId(flags);
        await api.savePreset(sessionId, name);
        console.log(`Saved preset "${name}".`);
        return;
    }

    if (action === 'load') {
        if (!name) {
            throw new Error('Preset name is required for load.');
        }
        const preset = await api.loadPreset(name);
        console.log(JSON.stringify(preset, null, 2));
        return;
    }

    if (action === 'delete') {
        if (!name) {
            throw new Error('Preset name is required for delete.');
        }
        await api.deletePreset(name);
        console.log(`Deleted preset "${name}".`);
        return;
    }

    throw new Error(`Unknown presets action: ${action}`);
}

async function runDeploy(flags: CliFlags): Promise<void> {
    const api = new Or3CloudWizardApi();
    const sessionId = await resolveSessionId(flags);
    // Verify session exists early for clearer error
    await readSession(sessionId);
    const result = await api.deploy(sessionId);
    if (result.instructions) {
        console.log(result.instructions);
    }
}

async function main(): Promise<void> {
    const { command, rest, flags } = parseFlags(process.argv.slice(2));

    try {
        switch (command) {
            case 'init':
                await runInit(flags);
                return;
            case 'validate':
                await runValidate(flags);
                return;
            case 'presets':
                await runPresets(rest, flags);
                return;
            case 'deploy':
                await runDeploy(flags);
                return;
            case 'help':
            case '--help':
            case '-h':
            default:
                printHelp();
        }
    } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
    }
}

void main();
