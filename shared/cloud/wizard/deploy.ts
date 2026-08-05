/**
 * @module shared/cloud/wizard/deploy
 *
 * Purpose:
 * Executes deploy commands after configuration has been applied.
 * Supports local-dev, Docker, configure-only, and legacy prod-build targets.
 *
 * Responsibilities:
 * - Convex preflight checks (CLI availability, project detection)
 * - Convex backend env variable setting through the selected package manager
 * - Package-manager-neutral deploy plan generation
 * - Sequential command execution with error reporting
 *
 * Non-responsibilities:
 * - Configuration writing (see apply.ts)
 * - Validation (see validation.ts)
 * - Production process management (PM2, systemd, etc.)
 *
 * Constraints:
 * - Commands run synchronously in sequence; a failure throws with
 *   the command, args, and exit code.
 * - `stdio: 'inherit'` is used for deploy commands so the user sees
 *   real-time output.
 * - Convex env setting is a separate step from deploy because it
 *   requires the Convex CLI and a configured project directory.
 *
 * @see buildDeployPlan for command generation
 * @see applyConvexEnv for Convex-specific env setup
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import crossSpawn from 'cross-spawn';
import { deriveEnvFromAnswers } from './derive';
import { resolveEffectiveConnectProvider } from './connect-provider';
import {
    execPackageCommand,
    formatCommand,
    installCommand,
    runScriptCommand,
    type PackageManager,
} from './package-manager';
import type { WizardAnswers, WizardDeployResult } from './types';

type CommandSpec = {
    step: string;
    command: string;
    args: string[];
    optional?: boolean;
    env?: NodeJS.ProcessEnv;
};

function usesConvexProvider(
    answers: Pick<
        WizardAnswers,
        | 'syncEnabled'
        | 'syncProvider'
        | 'storageEnabled'
        | 'storageProvider'
        | 'connectEnabled'
        | 'connectProvider'
        | 'allAdvancedEnabled'
        | 'connectAdvancedEnabled'
    >
): boolean {
    return (
        (answers.syncEnabled && answers.syncProvider === 'convex') ||
        (answers.storageEnabled && answers.storageProvider === 'convex') ||
        (answers.connectEnabled &&
            resolveEffectiveConnectProvider(answers) === 'convex')
    );
}

function isSelfHostedConvex(
    answers: Pick<WizardAnswers, 'convexSelfHostedAdminKey' | 'convexUrl'>
): boolean {
    return (
        (answers.convexSelfHostedAdminKey?.trim() ?? '').length > 0 &&
        (answers.convexUrl?.trim() ?? '').length > 0
    );
}

function buildConvexCliEnv(answers: WizardAnswers): NodeJS.ProcessEnv {
    const nextEnv: NodeJS.ProcessEnv = { ...process.env };
    if (!isSelfHostedConvex(answers)) {
        return nextEnv;
    }

    nextEnv.CONVEX_SELF_HOSTED_URL = answers.convexUrl!.trim();
    nextEnv.CONVEX_SELF_HOSTED_ADMIN_KEY = answers.convexSelfHostedAdminKey!.trim();
    nextEnv.VITE_CONVEX_URL = answers.convexUrl!.trim();
    if ((answers.convexSelfHostedSiteUrl?.trim() ?? '').length > 0) {
        nextEnv.VITE_CONVEX_SITE_URL = answers.convexSelfHostedSiteUrl!.trim();
    }
    // Prevent mixed-mode conflict when a stale deployment value exists.
    delete nextEnv.CONVEX_DEPLOYMENT;

    return nextEnv;
}

function runCommand(spec: CommandSpec, cwd: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = crossSpawn(spec.command, spec.args, {
            cwd,
            stdio: 'inherit',
            shell: false,
            env: spec.env ?? process.env,
        });

        child.on('error', (error) => {
            rejectPromise(
                new Error(
                    `${spec.step} failed: "${spec.command} ${spec.args.join(' ')}" (${error.message})`
                )
            );
        });

        child.on('exit', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            rejectPromise(
                new Error(
                    `${spec.step} failed with exit code ${code}: "${spec.command} ${spec.args.join(
                        ' '
                    )}"`
                )
            );
        });
    });
}

function runCommandCapture(
    command: string,
    args: string[],
    cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
        const child = crossSpawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
            shell: false,
        });

        let stdout = '';
        let stderr = '';
        child.stdout!.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr!.on('data', (chunk) => {
            stderr += String(chunk);
        });

        child.on('error', () => {
            resolvePromise({ code: 1, stdout, stderr });
        });
        child.on('exit', (code) => {
            resolvePromise({
                code: code ?? 1,
                stdout,
                stderr,
            });
        });
    });
}

function hasConvexProject(instanceDir: string): boolean {
    return (
        existsSync(resolve(instanceDir, 'convex')) ||
        existsSync(resolve(instanceDir, 'convex.json'))
    );
}

/**
 * Checks whether the Convex CLI is accessible and whether a Convex project
 * exists in the instance directory. Returns warnings for any issues found.
 * Does not throw; all problems are reported as warning strings.
 */
export async function preflightConvex(
    instanceDir: string,
    packageManager: PackageManager = 'npm'
): Promise<string[]> {
    const warnings: string[] = [];
    const convexCommand = execPackageCommand(packageManager, [
        'convex',
        '--version',
    ]);

    const convexVersion = await runCommandCapture(
        convexCommand.command,
        convexCommand.args,
        instanceDir
    );
    if (convexVersion.code !== 0) {
        warnings.push(
            `Convex CLI is not accessible via \`${formatCommand(convexCommand)}\`. Install it or run Convex setup manually.`
        );
    }

    if (!hasConvexProject(instanceDir)) {
        const initCommand = execPackageCommand(packageManager, [
            'or3-provider-convex',
            'init',
        ]);
        warnings.push(
            `No Convex project detected in instance directory (missing \`convex/\` or \`convex.json\`). Run \`${formatCommand(initCommand)}\` to scaffold it.`
        );
    }

    return warnings;
}

/**
 * Sets Convex backend environment variables through the selected package manager.
 * Only relevant for Clerk + Convex flows (sets `CLERK_ISSUER_URL` and
 * `OR3_ADMIN_JWT_SECRET`).
 *
 * Behavior:
 * - Runs preflight checks first and collects warnings.
 * - In dry-run mode, returns the commands that would be executed.
 * - In live mode, executes each `convex env set` command sequentially.
 *
 * @throws Error when a `convex env set` command fails.
 */
export async function applyConvexEnv(
    answers: WizardAnswers,
    options: {
        dryRun?: boolean;
    } = {}
): Promise<{ commands: string[]; warnings: string[] }> {
    const { convexEnv } = deriveEnvFromAnswers(answers);
    const commands: string[] = [];
    const dryRun = options.dryRun ?? answers.dryRun;
    const initialWarnings = await preflightConvex(
        answers.instanceDir,
        answers.packageManager
    );
    const convexCliEnv = buildConvexCliEnv(answers);

    if (!hasConvexProject(answers.instanceDir)) {
        const initArgs = ['or3-provider-convex', 'init'];
        const initCommand = execPackageCommand(
            answers.packageManager,
            initArgs
        );
        commands.push(formatCommand(initCommand));
        if (!dryRun) {
            await runCommand(
                {
                    step: 'Initialize Convex scaffold',
                    ...initCommand,
                    env: convexCliEnv,
                },
                answers.instanceDir
            );
        }
    }

    for (const [key, value] of Object.entries(convexEnv)) {
        if (!value) continue;
        const args = ['convex', 'env', 'set', `${key}=${value}`];
        const convexCommand = execPackageCommand(
            answers.packageManager,
            args
        );
        const printable = formatCommand(convexCommand);
        commands.push(printable);
        if (!dryRun) {
            await runCommand(
                {
                    step: `Set Convex env ${key}`,
                    ...convexCommand,
                    env: convexCliEnv,
                },
                answers.instanceDir
            );
        }
    }

    const warnings = dryRun
        ? initialWarnings
        : await preflightConvex(answers.instanceDir, answers.packageManager);
    return { commands, warnings };
}

/**
 * Generates the ordered list of shell commands for the deploy step.
 *
 * - `local-dev`: install, optional Convex preparation, then start dev:ssr
 * - `docker`: Docker Compose build/start
 * - `configure-only`: no commands
 * - `prod-build`: install then build (legacy sessions)
 */
export function buildDeployPlan(answers: WizardAnswers): CommandSpec[] {
    if (answers.deploymentTarget === 'configure-only') {
        return [];
    }

    if (answers.deploymentTarget === 'docker') {
        const args = ['compose', '-f', 'compose.yaml'];
        if (answers.dockerExposure === 'public') {
            args.push('-f', 'compose.public.yaml');
        }
        args.push('up', '--build', '-d', '--wait', '--wait-timeout', '120');
        return [
            {
                step: 'Build and start OR3 with Docker Compose',
                command: 'docker',
                args,
            },
        ];
    }

    const install = installCommand(answers.packageManager);
    const commands: CommandSpec[] = [
        { step: 'Install dependencies', ...install },
    ];
    const convexEnabled = usesConvexProvider(answers);
    const selfHostedConvex = isSelfHostedConvex(answers);

    if (convexEnabled) {
        const initCommand = execPackageCommand(answers.packageManager, [
            'or3-provider-convex',
            'init',
        ]);
        commands.push({
            step: 'Initialize Convex scaffold',
            ...initCommand,
        });
    }

    if (answers.deploymentTarget === 'local-dev') {
        if (convexEnabled && !selfHostedConvex) {
            const convexDevCommand = execPackageCommand(
                answers.packageManager,
                ['convex', 'dev', '--once']
            );
            commands.push({
                step: 'Sync Convex backend',
                ...convexDevCommand,
                optional: true,
            });
        }
        const startCommand = runScriptCommand(
            answers.packageManager,
            'dev:ssr'
        );
        commands.push({
            step: 'Start Nuxt SSR',
            ...startCommand,
        });
    } else {
        const buildCommand = runScriptCommand(answers.packageManager, 'build');
        commands.push({
            step: 'Build Nuxt app',
            ...buildCommand,
        });
    }

    return commands;
}

/**
 * Executes the full deploy plan for the configured deployment target.
 *
 * Behavior:
 * - Runs each command from `buildDeployPlan()` in sequence.
 * - For prod builds, returns instructions to run `bun run preview`.
 * - For local-dev with Convex providers, returns a hint to run
 *   `bunx convex dev` in a separate terminal.
 *
 * @throws Error when any deploy command fails.
 */
export async function deployAnswers(
    answers: WizardAnswers
): Promise<WizardDeployResult> {
    const commands = buildDeployPlan(answers);
    const printableCommands = commands.map(
        (command) => `${command.command} ${command.args.join(' ')}`
    );
    const optionalStepFailures: string[] = [];

    for (const command of commands) {
        try {
            await runCommand(command, answers.instanceDir);
        } catch (error) {
            if (command.optional) {
                const message = error instanceof Error ? error.message : String(error);
                optionalStepFailures.push(message);
                console.warn(`[wizard:deploy] Optional step failed: ${message}`);
                continue;
            }
            if (answers.deploymentTarget === 'docker') {
                const composeFiles =
                    answers.dockerExposure === 'public'
                        ? '-f compose.yaml -f compose.public.yaml'
                        : '-f compose.yaml';
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(
                    `${message}\nDiagnostics: docker compose ${composeFiles} ps && docker compose ${composeFiles} logs --tail=200`
                );
            }
            throw error;
        }
    }

    if (answers.deploymentTarget === 'configure-only') {
        return {
            started: false,
            commands: [],
            instructions: 'Configuration complete. No services were started.',
            nextSteps: [
                `Start locally with: ${formatCommand(runScriptCommand(answers.packageManager, 'dev'))}`,
                'Re-run setup at any time to choose a deployment target.',
            ],
        };
    }

    if (answers.deploymentTarget === 'docker') {
        const accessUrl =
            answers.dockerExposure === 'public' && answers.publicDomain
                ? `https://${answers.publicDomain}`
                : 'http://127.0.0.1:3000';
        let healthy = false;
        const composeArgs = ['compose', '-f', 'compose.yaml'];
        if (answers.dockerExposure === 'public') {
            composeArgs.push('-f', 'compose.public.yaml');
        }
        const healthProbeArgs = [
            ...composeArgs,
            'exec',
            '-T',
            'or3',
            'node',
            '-e',
            "fetch('http://127.0.0.1:3000/api/health?deep=true').then(async r=>{const body=await r.json();if(!r.ok||body.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))",
        ];
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
            const probe = await runCommandCapture(
                'docker',
                healthProbeArgs,
                answers.instanceDir
            );
            healthy = probe.code === 0;
            if (healthy) break;
            await new Promise((resolvePromise) =>
                setTimeout(resolvePromise, 1_000)
            );
        }

        const composeFiles =
            answers.dockerExposure === 'public'
                ? '-f compose.yaml -f compose.public.yaml'
                : '-f compose.yaml';
        return {
            started: true,
            commands: printableCommands,
            instructions: healthy
                ? 'OR3 is running and all configured providers are healthy.'
                : `Docker started, but its local deep-health endpoint did not report healthy within 120 seconds. Run: docker compose ${composeFiles} ps && docker compose ${composeFiles} logs --tail=200`,
            accessUrl,
            nextSteps: [
                `Open ${accessUrl} in your browser.`,
                `Open the admin dashboard at ${accessUrl}/admin.`,
                `View logs: docker compose ${composeFiles} logs -f`,
                `Stop OR3: docker compose ${composeFiles} down`,
                'List this project’s volumes with `docker compose ' +
                    `${composeFiles} config --volumes` +
                    '` and back up the `or3-data` volume before upgrades.',
                ...(answers.dockerExposure === 'public'
                    ? [
                          `Confirm ${answers.publicDomain} resolves to this server before opening the public URL.`,
                      ]
                    : []),
            ],
        };
    }

    if (answers.deploymentTarget === 'prod-build') {
        const previewCommand = runScriptCommand(
            answers.packageManager,
            'preview'
        );
        const nextSteps = [
            `Run \`${formatCommand(previewCommand)}\` to start the production preview server.`,
            'Open http://localhost:3000 in your browser.',
        ];
        if (answers.ssrAuthEnabled) {
            nextSteps.push('Sign in with your bootstrap/admin account.');
            nextSteps.push('Open the admin panel and verify providers are healthy.');
        }
        if (answers.connectEnabled) {
            nextSteps.push(
                'After the public URL is live, connect a computer with `npx @or3/connect`.'
            );
        }
        return {
            started: true,
            commands: printableCommands,
            instructions:
                `Build complete. Start the production preview with: ${formatCommand(previewCommand)}`,
            accessUrl: 'http://localhost:3000',
            nextSteps,
        };
    }

    const nextSteps = ['Open http://localhost:3000 in your browser.'];
    if (answers.ssrAuthEnabled) {
        nextSteps.push('Sign in with your bootstrap/admin account.');
        nextSteps.push('Open the admin panel and verify auth/sync/storage status.');
    }
    if (answers.connectEnabled) {
        nextSteps.push(
            'Connect requires a public HTTPS URL; once it is reachable, run `npx @or3/connect`.'
        );
    }
    if (usesConvexProvider(answers)) {
        const convexCommand = execPackageCommand(answers.packageManager, [
            'convex',
            'dev',
            '--once',
        ]);
        nextSteps.push(
            `Keep an eye on \`${formatCommand(convexCommand)}\` output while using Convex.`
        );
    }
    const convexRetryCommand = formatCommand(
        execPackageCommand(answers.packageManager, [
            'convex',
            'dev',
            '--once',
        ])
    );
    return {
        started: true,
        commands: printableCommands,
        instructions: optionalStepFailures.length
            ? `Local dev is running. Convex backend sync failed; run \`${convexRetryCommand}\` manually after fixing Convex deployment access.`
            : usesConvexProvider(answers) && !isSelfHostedConvex(answers)
                ? `Local dev is running. Re-run \`${convexRetryCommand}\` after editing Convex functions.`
                : 'Local dev is running.',
        accessUrl: 'http://localhost:3000',
        nextSteps,
    };
}
