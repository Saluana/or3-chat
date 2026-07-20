#!/usr/bin/env bun
/**
 * @module scripts/cli/start
 *
 * The single "just run it" entry point for OR3 Chat.
 *
 * Behavior:
 * - Installs dependencies on first run (missing node_modules).
 * - On a fresh clone (no .env / mode marker), asks ONE question: local or cloud.
 *   - local → writes a minimal local `.env` marker, then starts `bun run dev`
 *   - cloud → hands off to the install wizard (`bun run or3-cloud:init`)
 * - On subsequent runs, starts the dev server directly.
 * - Non-interactive environments (CI, pipes) go straight to `bun run dev`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/** Marker written after the user picks local so we never re-ask. */
export const LOCAL_MODE_ENV_CONTENTS = `# OR3 local-first mode (created by \`bun start\`)
# Your conversations stay in this browser. No cloud providers configured.
# Run \`bun run or3-cloud:init\` anytime to add accounts, sync & storage.
SSR_AUTH_ENABLED=false
`;

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
        const child = spawn(command, args, {
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

    if (!existsSync(resolve(cwd, 'node_modules'))) {
        console.log('\n  Installing dependencies (first run only)...\n');
        const installCode = await run('bun', ['install']);
        if (installCode !== 0) {
            console.error(
                '\n  Dependency install failed. Fix the error above and re-run `bun start`.'
            );
            process.exit(installCode);
            return;
        }
    }

    const isInteractive =
        Boolean(input.isTTY && output.isTTY) && process.env.CI !== 'true';

    if (!shouldAskModeChoice(cwd) || !isInteractive) {
        process.exit(await run('bun', ['run', 'dev']));
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
        process.exit(await run('bun', ['run', 'or3-cloud:init']));
        return;
    }

    const envPath = writeLocalModeMarker(cwd);
    console.log(`\n  Local mode saved to ${envPath}`);
    console.log('  Next time just run `bun start` — we will not ask again.\n');

    process.exit(await run('bun', ['run', 'dev']));
}

const isDirectRun =
    typeof Bun !== 'undefined'
        ? Boolean(Bun.main && import.meta.path === Bun.main)
        : process.argv[1]?.endsWith('start.ts') === true ||
          process.argv[1]?.endsWith('start.js') === true;

if (isDirectRun) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
