#!/usr/bin/env node
/**
 * @module scripts/cli/start
 *
 * The single "just run it" entry point for OR3 Chat.
 *
 * Behavior:
 * - Installs dependencies on first run (missing node_modules).
 * - On a fresh clone (no .env / mode marker), asks ONE question: local or cloud.
 *   - local → writes a minimal local `.env` marker, then starts the selected package manager's dev script
 *   - cloud → hands off to the install wizard
 * - On subsequent runs, starts the dev server directly.
 * - Non-interactive environments (CI, pipes) go straight to the dev script.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crossSpawn from 'cross-spawn';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
    detectPackageManager,
    installCommand,
    runScriptCommand,
} from '../../shared/cloud/wizard/package-manager';

/** Marker written after the user picks local so we never re-ask. */
export const LOCAL_MODE_ENV_CONTENTS = `# OR3 personal local mode
# Your conversations stay in this browser. No cloud providers configured.
# Run \`npm run setup\` or \`bun run setup\` anytime to add accounts, sync & storage.
SSR_AUTH_ENABLED=false
`;

/**
 * Args passed to `setup` when the user picks cloud from `bun start`.
 * Locks the wizard onto the recommended self-hosted path (no personal-local).
 */
export const CLOUD_SETUP_ARGS = ['--mode', 'self-hosted'] as const;

export function shouldAskModeChoice(cwd: string): boolean {
    return !existsSync(resolve(cwd, '.env')) && !existsSync(resolve(cwd, '.env.local'));
}

export function writeLocalModeMarker(cwd: string): string {
    const envPath = resolve(cwd, '.env');
    writeFileSync(envPath, LOCAL_MODE_ENV_CONTENTS, 'utf8');
    return envPath;
}

function run(command: string, args: string[]): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = crossSpawn(command, args, {
            stdio: 'inherit',
            env: process.env,
        });
        child.on('error', rejectPromise);
        child.on('exit', (code) => resolvePromise(code ?? 0));
        const forward = (signal: NodeJS.Signals) => {
            try {
                child.kill(signal);
            } catch {
                // Best effort.
            }
        };
        process.once('SIGINT', () => forward('SIGINT'));
        process.once('SIGTERM', () => forward('SIGTERM'));
    });
}

async function main(): Promise<void> {
    const cwd = process.cwd();
    const packageManager = detectPackageManager();

    if (!existsSync(resolve(cwd, 'node_modules'))) {
        console.log('\n  Installing dependencies (first run only)...\n');
        const install = installCommand(packageManager);
        const installCode = await run(install.command, install.args);
        if (installCode !== 0) {
            console.error(
                `\n  Dependency install failed. Fix the error above and re-run \`${packageManager} start\`.`
            );
            process.exit(installCode);
            return;
        }
    }

    const isInteractive =
        Boolean(input.isTTY && output.isTTY) && process.env.CI !== 'true';

    if (!shouldAskModeChoice(cwd) || !isInteractive) {
        const dev = runScriptCommand(packageManager, 'dev');
        process.exit(await run(dev.command, dev.args));
        return;
    }

    console.log(`
  ╔══════════════════════════════════════╗
  ║                                      ║
  ║          Welcome to OR3!             ║
  ║                                      ║
  ╚══════════════════════════════════════╝

  How do you want to run it?

    1. Just chat locally (recommended)
       No setup. Your data stays in this browser.

    2. Set up cloud features
       Accounts, cross-device sync and file storage.
       A setup wizard opens in your browser.
`);

    const rl = readline.createInterface({ input, output });
    let answer = '';
    try {
        answer = (await rl.question('  Choose 1 or 2 [1]: ')).trim();
    } finally {
        rl.close();
    }

    if (answer === '2') {
        // Skip personal-local re-prompt: start already chose cloud features.
        const setup = runScriptCommand(packageManager, 'setup', [
            ...CLOUD_SETUP_ARGS,
        ]);
        process.exit(await run(setup.command, setup.args));
        return;
    }

    const envPath = writeLocalModeMarker(cwd);
    console.log(`\n  Local mode saved to ${envPath}`);
    console.log(
        `  Next time just run \`${packageManager} start\` — we will not ask again.\n`
    );

    const dev = runScriptCommand(packageManager, 'dev');
    process.exit(await run(dev.command, dev.args));
}

const isDirectRun =
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
