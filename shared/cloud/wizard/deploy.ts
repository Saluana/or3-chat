/**
 * @module shared/cloud/wizard/deploy
 *
 * Purpose:
 * Executes deploy commands after configuration has been applied.
 * Supports local-dev (SSR dev server) and prod-build targets.
 *
 * Responsibilities:
 * - Convex preflight checks (CLI availability, project detection)
 * - Convex backend env variable setting via `bunx convex env set`
 * - Deploy plan generation (`bun install` + dev/build)
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
import { spawn } from 'node:child_process';
import { deriveEnvFromAnswers } from './derive';
import type { WizardAnswers, WizardDeployResult } from './types';

type CommandSpec = {
    step: string;
    command: string;
    args: string[];
    optional?: boolean;
};

function runCommand(spec: CommandSpec, cwd: string): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(spec.command, spec.args, {
            cwd,
            stdio: 'inherit',
            shell: false,
            env: process.env,
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
        const child = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
            shell: false,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
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
export async function preflightConvex(instanceDir: string): Promise<string[]> {
    const warnings: string[] = [];

    const convexVersion = await runCommandCapture('bunx', ['convex', '--version'], instanceDir);
    if (convexVersion.code !== 0) {
        warnings.push(
            'Convex CLI is not accessible via `bunx convex`. Install it or run Convex setup manually.'
        );
    }

    if (!hasConvexProject(instanceDir)) {
        warnings.push(
            'No Convex project detected in instance directory (missing `convex/` or `convex.json`).'
        );
    }

    return warnings;
}

/**
 * Sets Convex backend environment variables via `bunx convex env set`.
 * Only relevant for Clerk + Convex flows (sets `CLERK_ISSUER_URL` and
 * `OR3_ADMIN_JWT_SECRET`).
 *
 * Behavior:
 * - Runs preflight checks first and collects warnings.
 * - In dry-run mode, returns the commands that would be executed.
 * - In live mode, executes each `bunx convex env set` sequentially.
 *
 * @throws Error when a `bunx convex env set` command fails.
 */
export async function applyConvexEnv(
    answers: WizardAnswers,
    options: {
        dryRun?: boolean;
    } = {}
): Promise<{ commands: string[]; warnings: string[] }> {
    const { convexEnv } = deriveEnvFromAnswers(answers);
    const commands: string[] = [];
    const warnings = await preflightConvex(answers.instanceDir);
    const dryRun = options.dryRun ?? answers.dryRun;

    for (const [key, value] of Object.entries(convexEnv)) {
        if (!value) continue;
        const args = ['convex', 'env', 'set', `${key}=${value}`];
        const printable = `bunx ${args.join(' ')}`;
        commands.push(printable);
        if (!dryRun) {
            await runCommand(
                {
                    step: `Set Convex env ${key}`,
                    command: 'bunx',
                    args,
                },
                answers.instanceDir
            );
        }
    }

    return { commands, warnings };
}

/**
 * Generates the ordered list of shell commands for the deploy step.
 *
 * - `local-dev`: `bun install` then `bun run dev:ssr`
 * - `prod-build`: `bun install` then `bun run build`
 */
export function buildDeployPlan(answers: WizardAnswers): CommandSpec[] {
    const commands: CommandSpec[] = [{ step: 'Install dependencies', command: 'bun', args: ['install'] }];

    if (answers.deploymentTarget === 'local-dev') {
        commands.push({
            step: 'Start Nuxt SSR',
            command: 'bun',
            args: ['run', 'dev:ssr'],
        });
    } else {
        commands.push({
            step: 'Build Nuxt app',
            command: 'bun',
            args: ['run', 'build'],
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

    for (const command of commands) {
        await runCommand(command, answers.instanceDir);
    }

    const usesConvexProvider =
        (answers.syncEnabled && answers.syncProvider === 'convex') ||
        (answers.storageEnabled && answers.storageProvider === 'convex');
    const needsConvexDevHint =
        answers.deploymentTarget === 'local-dev' && usesConvexProvider;

    if (answers.deploymentTarget === 'prod-build') {
        return {
            started: true,
            commands: printableCommands,
            instructions:
                'Build complete. Start the production preview with: bun run preview',
        };
    }

    return {
        started: true,
        commands: printableCommands,
        instructions: needsConvexDevHint
            ? 'Run `bunx convex dev` in a separate terminal before or alongside `bun run dev:ssr`.'
            : undefined,
    };
}
