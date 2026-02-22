#!/usr/bin/env bun
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { isAbsolute, resolve } from 'node:path';
import { Or3CloudWizardApi } from '../../shared/cloud/wizard/api';
import {
    buildRedactedSummary,
    summarizeValidationErrors,
} from '../../shared/cloud/wizard/validation';
import {
    applySkippedAdvancedDefaults,
    createDefaultAnswers,
    isWizardMode,
    normalizeWizardMode,
    normalizeAdvancedToggles,
    recommendedPreset,
    WIZARD_OWNED_ENV_KEYS,
} from '../../shared/cloud/wizard/catalog';
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
import type {
    WizardAnswers,
    WizardDeployResult,
    WizardField,
    WizardStep,
} from '../../shared/cloud/wizard/types';

type CliFlags = {
    [key: string]: string | boolean | undefined;
};

type PromptNavigation = 'nav-back' | 'nav-next';
const NAV_BACK: PromptNavigation = 'nav-back';
const NAV_NEXT: PromptNavigation = 'nav-next';
const WIZARD_OWNED_ENV_KEY_SET = new Set<string>(WIZARD_OWNED_ENV_KEYS);
let hasLoggedInvalidWizardModeWarning = false;

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
    if (
        sessionAnswers.wizardMode !== undefined &&
        !isWizardMode(sessionAnswers.wizardMode) &&
        !hasLoggedInvalidWizardModeWarning
    ) {
        console.log(
            `Unknown wizard mode "${String(sessionAnswers.wizardMode)}". Falling back to custom flow.`
        );
        hasLoggedInvalidWizardModeWarning = true;
    }

    const merged = {
        ...createDefaultAnswers({
            instanceDir: sessionAnswers.instanceDir ?? process.cwd(),
            envFile: sessionAnswers.envFile,
            presetName: sessionAnswers.presetName,
        }),
        ...sessionAnswers,
        wizardMode: normalizeWizardMode(
            sessionAnswers.wizardMode,
            sessionAnswers.presetName
        ),
    };
    return applySkippedAdvancedDefaults(normalizeAdvancedToggles(merged));
}

function getVisibleFields(step: WizardStep, answers: WizardAnswers): WizardField[] {
    return step.fields.filter((field) =>
        typeof field.visibleWhen === 'function' ? field.visibleWhen(answers) : true
    );
}

function isStepVisible(step: WizardStep, answers: WizardAnswers): boolean {
    if (step.canSkip?.(answers)) {
        return false;
    }
    if (step.id === 'review') {
        return true;
    }
    return getVisibleFields(step, answers).length > 0;
}

function getVisibleSteps(steps: WizardStep[], answers: WizardAnswers): WizardStep[] {
    return steps.filter((step) => isStepVisible(step, answers));
}

class Prompt {
    private readonly rl = readline.createInterface({ input, output });

    async close(): Promise<void> {
        this.rl.close();
    }

    async text(
        label: string,
        defaultValue?: string,
        required = false
    ): Promise<string | PromptNavigation> {
        while (true) {
            const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : '';
            const answer = (await this.rl.question(`${label}${suffix}: `)).trim();
            const normalized = answer.toLowerCase();
            if (normalized === '/back') return NAV_BACK;
            if (normalized === '/next') return NAV_NEXT;
            if (!answer && defaultValue !== undefined) return defaultValue;
            if (!answer && required) {
                console.log('Value is required.');
                continue;
            }
            return answer;
        }
    }

    async boolean(
        label: string,
        defaultValue: boolean
    ): Promise<boolean | PromptNavigation> {
        const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
        while (true) {
            const answer = (await this.rl.question(`${label}${suffix}: `)).trim().toLowerCase();
            if (answer === '/back') return NAV_BACK;
            if (answer === '/next') return NAV_NEXT;
            if (!answer) return defaultValue;
            if (['y', 'yes'].includes(answer)) return true;
            if (['n', 'no'].includes(answer)) return false;
            console.log('Please enter y or n.');
        }
    }

    async select(
        label: string,
        options: Array<{ label: string; value: unknown; description?: string }>,
        defaultValue?: unknown
    ): Promise<unknown | PromptNavigation> {
        console.log(label);
        let defaultIndex = 0;
        options.forEach((option, index) => {
            if (defaultValue !== undefined && option.value === defaultValue) {
                defaultIndex = index;
            }
            console.log(`  ${index + 1}. ${option.label}`);
            if (option.description) {
                option.description
                    .split('\n')
                    .forEach((line) => console.log(`     ${line}`));
            }
        });
        const answer = await this.text('Choose number', String(defaultIndex + 1), true);
        if (answer === NAV_BACK || answer === NAV_NEXT) {
            return answer;
        }
        const index = toInt(answer);
        if (index === null || index < 1 || index > options.length) {
            console.log('Invalid selection. Using default.');
            return options[defaultIndex]?.value;
        }
        return options[index - 1]?.value;
    }

    async multiString(
        label: string,
        currentValue: string[]
    ): Promise<string[] | PromptNavigation> {
        const defaultValue = currentValue.join(',');
        const answer = await this.text(label, defaultValue);
        if (answer === NAV_BACK || answer === NAV_NEXT) {
            return answer;
        }
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
    ): Promise<string | PromptNavigation> {
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
            const normalized = answer.trim().toLowerCase();
            if (normalized === '/back') return NAV_BACK;
            if (normalized === '/next') return NAV_NEXT;
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
  During setup questions, type /back or /next to navigate.
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
    }
    console.log('');
}

function printFieldHelp(help: string): void {
    console.log(`  💡 ${help}`);
    console.log('');
}

async function promptBooleanNoNav(
    prompt: Prompt,
    label: string,
    defaultValue: boolean
): Promise<boolean> {
    while (true) {
        const value = await prompt.boolean(label, defaultValue);
        if (value === NAV_BACK || value === NAV_NEXT) {
            console.log('Navigation commands are only available inside setup questions.');
            continue;
        }
        return value;
    }
}

async function promptTextNoNav(
    prompt: Prompt,
    label: string,
    defaultValue?: string,
    required = false
): Promise<string> {
    while (true) {
        const value = await prompt.text(label, defaultValue, required);
        if (value === NAV_BACK || value === NAV_NEXT) {
            console.log('Navigation commands are only available inside setup questions.');
            continue;
        }
        return value;
    }
}

function printFocusedFieldScreen(
    stepIndex: number,
    totalSteps: number,
    stepTitle: string,
    stepDescription: string | undefined,
    fieldIndex: number,
    totalFields: number
): void {
    console.clear();
    printStepHeader(stepIndex, totalSteps, stepTitle, stepDescription);
    console.log(`  Question ${fieldIndex + 1} of ${totalFields}`);
    console.log('  Commands: /back = previous question, /next = skip this question');
    console.log('');
}

async function promptField(
    prompt: Prompt,
    field: WizardField,
    answers: WizardAnswers
): Promise<unknown | PromptNavigation> {
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
                if (answer === NAV_BACK || answer === NAV_NEXT) {
                    return answer;
                }
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
            const canAutoGenerate =
                Boolean(field.secret) && Boolean(field.required);
            const value = await prompt.password(field.label, {
                required:
                    field.required &&
                    !hasCurrentValue &&
                    !canAutoGenerate,
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

function hasExistingWizardConfiguration(envMap: Record<string, string>): boolean {
    return Object.keys(envMap).some((key) => WIZARD_OWNED_ENV_KEY_SET.has(key));
}

function resolvePathForValidation(
    fieldKey: keyof WizardAnswers,
    value: unknown,
    answers: WizardAnswers
): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (fieldKey === 'instanceDir') {
        return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
    }

    if (fieldKey === 'sqliteDbPath') {
        return isAbsolute(trimmed)
            ? trimmed
            : resolve(answers.instanceDir, trimmed);
    }

    return null;
}

async function validatePathFieldIfNeeded(
    api: Or3CloudWizardApi,
    prompt: Prompt,
    fieldKey: keyof WizardAnswers,
    value: unknown,
    answers: WizardAnswers
): Promise<boolean> {
    const pathToCheck = resolvePathForValidation(fieldKey, value, answers);
    if (!pathToCheck) {
        return true;
    }

    const exists = await api.validatePath(pathToCheck, false);
    if (exists) {
        return true;
    }

    const shouldCreate = await promptBooleanNoNav(
        prompt,
        `Path "${pathToCheck}" does not exist. Create it now?`,
        true
    );
    if (!shouldCreate) {
        console.log('Please provide a valid path to continue.');
        return false;
    }

    const created = await api.validatePath(pathToCheck, true);
    if (!created) {
        console.log(`Unable to create "${pathToCheck}".`);
        return false;
    }

    console.log(`Created "${pathToCheck}".`);
    return true;
}

type ConnectionTestTarget = {
    providerId: 'clerk' | 'convex' | 's3';
    label: string;
    credentials: Record<string, string>;
};

function getConnectionTestTarget(
    step: WizardStep,
    answers: WizardAnswers
): ConnectionTestTarget | null {
    if (step.id === 'provider-auth' && answers.authProvider === 'clerk') {
        const clerkSecretKey = answers.clerkSecretKey?.trim() ?? '';
        if (!clerkSecretKey) return null;
        return {
            providerId: 'clerk',
            label: 'Clerk',
            credentials: {
                clerkSecretKey,
                clerkPublishableKey: answers.clerkPublishableKey?.trim() ?? '',
            },
        };
    }

    if (step.id === 'provider-sync' && answers.syncProvider === 'convex') {
        const convexUrl = answers.convexUrl?.trim() ?? '';
        if (!convexUrl) return null;
        return {
            providerId: 'convex',
            label: 'Convex',
            credentials: {
                convexUrl,
                convexSelfHostedAdminKey:
                    answers.convexSelfHostedAdminKey?.trim() ?? '',
            },
        };
    }

    if (step.id === 'provider-storage' && answers.storageProvider === 's3') {
        const s3Bucket = answers.s3Bucket?.trim() ?? '';
        const s3AccessKeyId = answers.s3AccessKeyId?.trim() ?? '';
        const s3SecretAccessKey = answers.s3SecretAccessKey?.trim() ?? '';
        if (!s3Bucket || !s3AccessKeyId || !s3SecretAccessKey) {
            return null;
        }
        return {
            providerId: 's3',
            label: 'S3',
            credentials: {
                s3Endpoint: answers.s3Endpoint?.trim() ?? '',
                s3Region: answers.s3Region?.trim() ?? 'us-east-1',
                s3Bucket,
                s3AccessKeyId,
                s3SecretAccessKey,
                s3SessionToken: answers.s3SessionToken?.trim() ?? '',
            },
        };
    }

    return null;
}

function findValidationFailureStepId(
    errors: string[],
    answers: WizardAnswers
): string | null {
    const visibleSteps = getVisibleSteps(getWizardSteps(answers), answers).filter(
        (step) => step.id !== 'review'
    );
    const visibleStepIds = new Set(visibleSteps.map((step) => step.id));
    const rules: Array<{ stepId: string; patterns: string[] }> = [
        {
            stepId: 'target',
            patterns: ['INSTANCEDIR', 'INSTANCE DIR'],
        },
        {
            stepId: 'branding',
            patterns: ['OR3 SITE NAME', 'OR3_SITE_NAME'],
        },
        {
            stepId: 'provider-auth',
            patterns: ['OR3_BASIC_AUTH_', 'NUXT_PUBLIC_CLERK_', 'NUXT_CLERK_SECRET_KEY'],
        },
        {
            stepId: 'provider-sync',
            patterns: ['OR3_SQLITE_', 'VITE_CONVEX_URL', 'CONVEX_SELF_HOSTED_'],
        },
        {
            stepId: 'provider-storage',
            patterns: ['OR3_STORAGE_FS_', 'OR3_STORAGE_S3_'],
        },
        {
            stepId: 'convex-env',
            patterns: ['CLERK_ISSUER_URL', 'OR3_ADMIN_JWT_SECRET'],
        },
        {
            stepId: 'openrouter-limits-security',
            patterns: [
                'OPENROUTER_',
                'OR3_OPENROUTER_',
                'OR3_REQUESTS_PER_MINUTE',
                'OR3_MAX_CONVERSATIONS',
                'OR3_MAX_MESSAGES_PER_DAY',
                'OR3_ALLOWED_ORIGINS',
                'OR3_FORWARDED_FOR_HEADER',
                'OR3_TRUST_PROXY',
                'OR3_STRICT_CONFIG',
            ],
        },
    ];

    for (const rawError of errors) {
        const error = rawError.toUpperCase();
        for (const rule of rules) {
            if (!visibleStepIds.has(rule.stepId)) continue;
            if (rule.patterns.some((pattern) => error.includes(pattern))) {
                return rule.stepId;
            }
        }
    }

    return visibleSteps[0]?.id ?? null;
}

function printDeployResult(result: WizardDeployResult): void {
    if (result.accessUrl) {
        console.log(`\n  URL: ${result.accessUrl}`);
    }

    if (result.nextSteps && result.nextSteps.length > 0) {
        console.log('\n  Next steps:');
        result.nextSteps.forEach((step, index) => {
            console.log(`    ${index + 1}. ${step}`);
        });
    }

    if (result.instructions) {
        console.log(`\n  ${result.instructions}`);
    }
}

async function runFastInit(flags: CliFlags): Promise<void> {
    const api = new Or3CloudWizardApi();
    const dryRun = toBooleanFlag(flags, 'dry-run');
    const strict = hasFlag(flags, 'strict') ? toBooleanFlag(flags, 'strict') : undefined;
    const instanceDir = toStringFlag(flags, 'instance-dir') ?? process.cwd();
    const envFile =
        (toStringFlag(flags, 'env-file') as '.env' | '.env.local') ?? '.env';

    const bootstrapEmail = 'admin@example.com';
    const bootstrapPassword = api.generateSecureSecret(24);
    const fsRoot = resolve(instanceDir, '.data', 'or3-storage');
    await api.validatePath(fsRoot, true);

    const session = await api.createSession({
        presetName: recommendedPreset.name,
        instanceDir,
        envFile,
        includeSecrets: false,
        prefillFromEnv: false,
    });

    await api.submitAnswers(session.id, {
        wizardMode: 'preset-local',
        presetName: 'recommended',
        dryRun,
        basicAuthJwtSecret: api.generateSecureSecret(48),
        basicAuthRefreshSecret: api.generateSecureSecret(48),
        basicAuthBootstrapEmail: bootstrapEmail,
        basicAuthBootstrapPassword: bootstrapPassword,
        fsTokenSecret: api.generateSecureSecret(48),
        fsRoot,
    });

    const validation = await api.validate(
        session.id,
        strict === undefined ? {} : { strict }
    );
    if (!validation.ok) {
        throw new Error(
            `Fast setup validation failed:\n${summarizeValidationErrors(validation)}`
        );
    }

    const applyResult = await api.apply(session.id, {
        dryRun,
        createBackup: !toBooleanFlag(flags, 'no-backup'),
    });

    console.log('\n  ✅ Fast setup complete.\n');
    if (applyResult.dryRun) {
        console.log('  Dry run mode enabled: no files were written.');
        return;
    }

    console.log(`  Bootstrap email: ${bootstrapEmail}`);
    console.log(`  Bootstrap password: ${bootstrapPassword}`);

    const deployResult = await api.deploy(session.id);
    printDeployResult(deployResult);
}

function printHelp(): void {
    console.log(`or3-cloud commands

  or3-cloud init [--preset recommended|clerk-convex] [--instance-dir <path>] [--env-file .env|.env.local] [--dry-run] [--manual] [--fast] [--enable-install] [--package-manager bun|npm] [--no-focused-prompts]
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
    if (toBooleanFlag(flags, 'fast')) {
        await runFastInit(flags);
        return;
    }
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
    const focusedPrompts =
        !toBooleanFlag(flags, 'no-focused-prompts') &&
        Boolean(input.isTTY && output.isTTY);
    const presetFlag = toStringFlag(flags, 'preset');
    const normalizedPresetName =
        presetFlag === 'clerk-convex' ? 'legacy-clerk-convex' : presetFlag;

    try {
        const instanceDir = toStringFlag(flags, 'instance-dir') ?? process.cwd();
        const envFile =
            (toStringFlag(flags, 'env-file') as '.env' | '.env.local') ?? '.env';
        const existingEnv = await readEnvFile({
            instanceDir,
            envFile,
        });
        const hasExistingConfig = hasExistingWizardConfiguration(existingEnv.map);
        let prefillFromEnv = true;
        if (hasExistingConfig) {
            console.log(`\nDetected existing wizard-managed settings in ${existingEnv.path}.`);
            prefillFromEnv = await promptBooleanNoNav(
                prompt,
                'Update this existing setup (recommended) instead of starting fresh?',
                true
            );
        }

        const session = await api.createSession({
            presetName: normalizedPresetName ?? recommendedPreset.name,
            instanceDir,
            envFile,
            includeSecrets: false,
            prefillFromEnv,
            existingEnvMap: prefillFromEnv ? existingEnv.map : undefined,
        });

        let stepIndex = 0;
        let finalAnswers: WizardAnswers | null = null;
        let validationWarnings: string[] = [];
        while (true) {
            while (true) {
                const latestSession = await api.getSession(session.id, {
                    includeSecrets: true,
                });
                const answers = normalizeAnswers(latestSession.answers);
                const steps = getWizardSteps(answers);
                const visibleSteps = getVisibleSteps(steps, answers);
                if (stepIndex >= visibleSteps.length) break;
                const step = visibleSteps[stepIndex];
                if (!step) break;

                if (step.id === 'review') {
                    if (focusedPrompts) {
                        console.clear();
                    }
                    printStepHeader(
                        stepIndex,
                        visibleSteps.length,
                        step.title,
                        step.description
                    );
                    const review = await api.review(session.id);
                    console.log('\n' + review.summary + '\n');
                    const confirm = await promptBooleanNoNav(
                        prompt,
                        'Does this look right? Apply it?',
                        true
                    );
                    if (confirm) break;

                    console.log('\n  Which step would you like to change?\n');
                    const editable = visibleSteps.filter(
                        (candidate) => candidate.id !== 'review'
                    );
                    editable.forEach((candidate, index) => {
                        console.log(`  ${index + 1}. ${candidate.title}`);
                    });
                    const selected = await promptTextNoNav(
                        prompt,
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
                        const nextIndex = visibleSteps.findIndex(
                            (candidate) => candidate.id === targetStepId
                        );
                        stepIndex = nextIndex >= 0 ? nextIndex : 0;
                        continue;
                    }
                    stepIndex = 0;
                    continue;
                }

                const initialVisibleFields = getVisibleFields(step, answers);
                if (initialVisibleFields.length === 0) {
                    stepIndex += 1;
                    continue;
                }

                if (!focusedPrompts) {
                    printStepHeader(
                        stepIndex,
                        visibleSteps.length,
                        step.title,
                        step.description
                    );
                    console.log(
                        '  Commands: /back = previous question, /next = skip this question'
                    );
                    console.log('');
                }

                const patch: Partial<WizardAnswers> = {};
                let fieldIndex = 0;
                let moveToPreviousStep = false;
                const draftAnswers: WizardAnswers = { ...answers };
                while (true) {
                    const visibleFields = getVisibleFields(step, draftAnswers);
                    if (fieldIndex >= visibleFields.length) {
                        break;
                    }

                    const field = visibleFields[fieldIndex];
                    if (!field) {
                        fieldIndex += 1;
                        continue;
                    }

                    if (focusedPrompts) {
                        printFocusedFieldScreen(
                            stepIndex,
                            visibleSteps.length,
                            step.title,
                            step.description,
                            fieldIndex,
                            visibleFields.length
                        );
                    } else {
                        console.log('');
                    }

                    if (field.help) {
                        printFieldHelp(field.help);
                    }

                    while (true) {
                        const value = await promptField(prompt, field, draftAnswers);
                        if (value === NAV_BACK) {
                            if (fieldIndex === 0) {
                                if (stepIndex === 0) {
                                    console.log('Already at the first visible question.');
                                    break;
                                }
                                moveToPreviousStep = true;
                                break;
                            }
                            fieldIndex -= 1;
                            break;
                        }
                        if (value === NAV_NEXT) {
                            fieldIndex += 1;
                            break;
                        }

                        const validationError =
                            typeof field.validate === 'function'
                                ? field.validate(value as never, draftAnswers)
                                : null;
                        if (validationError) {
                            console.log(validationError);
                            continue;
                        }

                        let nextValue: unknown = value;
                        if (
                            typeof nextValue === 'string' &&
                            field.secret &&
                            field.required &&
                            nextValue.trim().length === 0
                        ) {
                            nextValue = api.generateSecureSecret();
                            console.log(
                                `Generated secure value for "${field.label}".`
                            );
                        }

                        const pathIsValid = await validatePathFieldIfNeeded(
                            api,
                            prompt,
                            field.key,
                            nextValue,
                            draftAnswers
                        );
                        if (!pathIsValid) {
                            continue;
                        }

                        patch[field.key] = nextValue as never;
                        (
                            draftAnswers as Record<keyof WizardAnswers, unknown>
                        )[field.key] = nextValue;
                        fieldIndex += 1;
                        break;
                    }

                    if (moveToPreviousStep) {
                        break;
                    }
                }

                if (moveToPreviousStep) {
                    stepIndex = Math.max(0, stepIndex - 1);
                    continue;
                }

                if (step.id === 'target') {
                    patch.dryRun = dryRun || Boolean(patch.dryRun);
                }

                const connectionTestTarget = getConnectionTestTarget(
                    step,
                    draftAnswers
                );
                if (connectionTestTarget) {
                    console.log(
                        `\nTesting ${connectionTestTarget.label} connection...`
                    );
                    const connectionResult = await api.testProviderConnection(
                        connectionTestTarget.providerId,
                        connectionTestTarget.credentials
                    );
                    if (!connectionResult.success) {
                        console.log(`  ❌ ${connectionResult.message}`);
                        const bypassFailure = await promptBooleanNoNav(
                            prompt,
                            'Connection test failed. Continue anyway?',
                            false
                        );
                        if (!bypassFailure) {
                            continue;
                        }
                    } else {
                        console.log(`  ✅ ${connectionResult.message}`);
                    }
                }

                await api.submitAnswers(session.id, patch);
                stepIndex += 1;
            }

            const latestSession = await api.getSession(session.id, {
                includeSecrets: true,
            });
            const candidateAnswers = normalizeAnswers(latestSession.answers);
            const validation = await api.validate(
                session.id,
                strict === undefined ? {} : { strict }
            );
            if (!validation.ok) {
                console.log('\n  ❌ Some settings need fixing:\n');
                console.log(summarizeValidationErrors(validation));

                const failedStepId = findValidationFailureStepId(
                    validation.errors,
                    candidateAnswers
                );
                if (!failedStepId) {
                    return;
                }

                const visibleSteps = getVisibleSteps(
                    getWizardSteps(candidateAnswers),
                    candidateAnswers
                );
                const failedStep = visibleSteps.find(
                    (step) => step.id === failedStepId
                );
                const shouldRecover = await promptBooleanNoNav(
                    prompt,
                    failedStep
                        ? `Jump to "${failedStep.title}" to fix this now?`
                        : 'Jump back to fix validation issues now?',
                    true
                );
                if (!shouldRecover) {
                    return;
                }

                const nextIndex = visibleSteps.findIndex(
                    (step) => step.id === failedStepId
                );
                stepIndex = nextIndex >= 0 ? nextIndex : 0;
                continue;
            }

            finalAnswers = candidateAnswers;
            validationWarnings = validation.warnings;
            break;
        }

        if (!finalAnswers) {
            return;
        }
        const answers = finalAnswers;

        if (validationWarnings.length > 0) {
            console.log('\n  ⚠️  Heads up:');
            for (const warning of validationWarnings) {
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
                const shouldInstall = await promptBooleanNoNav(
                    prompt,
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
            const deployNow = await promptBooleanNoNav(
                prompt,
                'Run deploy commands now?',
                false
            );
            if (deployNow) {
                const result = await api.deploy(session.id);
                printDeployResult(result);
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
            const shouldSetConvexEnv = await promptBooleanNoNav(
                prompt,
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

        const presetName = await promptTextNoNav(
            prompt,
            'Save this setup as a reusable template? Enter a name or press Enter to skip',
            ''
        );
        if (presetName.trim()) {
            await api.savePreset(session.id, presetName.trim());
            console.log(`Preset "${presetName.trim()}" saved.`);
        }

        const deployNow = await promptBooleanNoNav(
            prompt,
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
                const shouldInstallBeforeDeploy = await promptBooleanNoNav(
                    prompt,
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
            printDeployResult(deployResult);
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
    printDeployResult(result);
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
