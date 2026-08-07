#!/usr/bin/env node
/**
 * The single "just run it" entry point for OR3 Chat.
 *
 * This intentionally has no package dependencies, so `npm start` or
 * `bun start` works in a fresh checkout before node_modules exists.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

/** Marker written after a user picks local mode so we never re-ask. */
export const LOCAL_MODE_STATE_CONTENTS = `${JSON.stringify({ version: 1, mode: 'local' })}\n`;
export const LOCAL_MODE_STATE_PATH = '.or3/setup.json';

/** Args passed to the managed installer when the user picks cloud from start. */
export const CLOUD_SETUP_ARGS = ['init', '--local'];

function detectPackageManager(userAgent = process.env.npm_config_user_agent) {
    if (process.versions.bun) return 'bun';
    return userAgent?.trim().toLowerCase().startsWith('bun/') ? 'bun' : 'npm';
}

function installCommand(packageManager) {
    return packageManager === 'bun'
        ? { command: 'bun', args: ['install'] }
        : { command: 'npm', args: ['install', '--package-lock=false'] };
}

function runScriptCommand(packageManager, script, args = []) {
    return {
        command: packageManager,
        args: ['run', script, ...(args.length > 0 ? ['--', ...args] : [])],
    };
}

function cloudInstallCommand(packageManager) {
    return packageManager === 'bun'
        ? { command: 'bunx', args: ['@or3/cloud', ...CLOUD_SETUP_ARGS] }
        : {
              command: 'npm',
              args: ['exec', '--yes', '@or3/cloud', '--', ...CLOUD_SETUP_ARGS],
          };
}

export function shouldAskModeChoice(cwd) {
    if (existsSync(resolve(cwd, '.env')) || existsSync(resolve(cwd, '.env.local'))) {
        return false;
    }
    return !existsSync(resolve(cwd, LOCAL_MODE_STATE_PATH));
}

export function writeLocalModeMarker(cwd) {
    const statePath = resolve(cwd, LOCAL_MODE_STATE_PATH);
    mkdirSync(resolve(cwd, '.or3'), { recursive: true, mode: 0o700 });
    writeFileSync(statePath, LOCAL_MODE_STATE_CONTENTS, { encoding: 'utf8', mode: 0o600 });
    return statePath;
}

function run(command, args) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, { stdio: 'inherit', env: process.env });
        child.on('error', rejectPromise);
        child.on('exit', (code) => resolvePromise(code ?? 0));
        const forward = (signal) => {
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

async function main() {
    const cwd = process.cwd();
    const packageManager = detectPackageManager();

    if (!existsSync(resolve(cwd, 'node_modules'))) {
        console.log('\n  Installing dependencies (first run only)...\n');
        const install = installCommand(packageManager);
        const installCode = await run(install.command, install.args);
        if (installCode !== 0) {
            console.error(`\n  Dependency install failed. Fix the error above and re-run \`${packageManager} start\`.`);
            process.exit(installCode);
            return;
        }
    }

    const isInteractive = Boolean(input.isTTY && output.isTTY) && process.env.CI !== 'true';
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
       A guided installer asks for your administrator email.
`);

    const rl = readline.createInterface({ input, output });
    let answer = '';
    try {
        answer = (await rl.question('  Choose 1 or 2 [1]: ')).trim();
    } finally {
        rl.close();
    }

    if (answer === '2') {
        const cloud = cloudInstallCommand(packageManager);
        process.exit(await run(cloud.command, cloud.args));
        return;
    }

    const statePath = writeLocalModeMarker(cwd);
    console.log(`\n  Local mode saved to ${statePath}`);
    console.log(`  Next time just run \`${packageManager} start\` — we will not ask again.\n`);

    const dev = runScriptCommand(packageManager, 'dev');
    process.exit(await run(dev.command, dev.args));
}

const isDirectRun = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
