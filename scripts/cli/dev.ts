#!/usr/bin/env node
/**
 * @module scripts/cli/dev
 *
 * Thin wrapper around `nuxt dev` that prevents the most common self-inflicted
 * wound: starting a second dev server while an old one is still running
 * (which makes code changes appear to "not apply" and API routes 404).
 *
 * Behavior:
 * - Determines the target port from `--port`, `PORT`, or the default 3000.
 * - If the port is free, forwards all arguments to `nuxt dev`.
 * - If the port is busy, explains what is likely wrong and offers to start
 *   on the next free port (interactive) or exits with instructions (CI).
 */
import crossSpawn from 'cross-spawn';
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    detectPackageManager,
    execPackageCommand,
    runForegroundCommand,
    type PackageManager,
    type PackageManagerCommand,
} from '../../shared/cloud/wizard/package-manager';
import { isPortAvailable } from '../../shared/cloud/wizard/dev-server';

export const DEFAULT_PORT = 3000;

export type NativeSqliteDependencyTarget = {
    cwd: string;
    label: string;
};

type NativeSqliteDependencyHooks = {
    verify?: (target: NativeSqliteDependencyTarget) => void;
    repair?: (
        target: NativeSqliteDependencyTarget,
        packageManager: PackageManager,
    ) => Promise<void>;
};

function enabled(value: string | undefined): boolean {
    return value?.trim().toLowerCase() === 'true';
}

/** Whether the active configuration needs the native better-sqlite3 binding. */
export function usesNativeSqlite(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (!enabled(env.SSR_AUTH_ENABLED)) return false;

    const authProvider =
        env.OR3_AUTH_PROVIDER?.trim().toLowerCase() ||
        env.AUTH_PROVIDER?.trim().toLowerCase();
    if (authProvider === 'basic-auth') return true;

    const syncEnabled = env.OR3_CLOUD_SYNC_ENABLED ?? env.OR3_SYNC_ENABLED;
    const syncProvider = env.OR3_SYNC_PROVIDER?.trim().toLowerCase();
    const sqliteDriver =
        env.OR3_SQLITE_DRIVER?.trim().toLowerCase() || 'better-sqlite3';
    return (
        enabled(syncEnabled) &&
        syncProvider === 'sqlite' &&
        sqliteDriver === 'better-sqlite3'
    );
}

/**
 * Find all copies that can be resolved by a source checkout. Published installs
 * only have the first target; contributor checkouts can also link provider repos.
 */
export function nativeSqliteDependencyTargets(
    env: NodeJS.ProcessEnv = process.env,
    projectRoot = process.cwd(),
): NativeSqliteDependencyTarget[] {
    if (!usesNativeSqlite(env)) return [];

    const targets: NativeSqliteDependencyTarget[] = [
        { cwd: projectRoot, label: 'OR3 Chat' },
    ];
    const authProvider =
        env.OR3_AUTH_PROVIDER?.trim().toLowerCase() ||
        env.AUTH_PROVIDER?.trim().toLowerCase();
    const syncEnabled = env.OR3_CLOUD_SYNC_ENABLED ?? env.OR3_SYNC_ENABLED;
    const syncProvider = env.OR3_SYNC_PROVIDER?.trim().toLowerCase();
    const sqliteDriver =
        env.OR3_SQLITE_DRIVER?.trim().toLowerCase() || 'better-sqlite3';

    if (authProvider === 'basic-auth') {
        targets.push({
            cwd: resolve(projectRoot, '..', 'or3-provider-basic-auth'),
            label: 'or3-provider-basic-auth',
        });
    }
    if (
        enabled(syncEnabled) &&
        syncProvider === 'sqlite' &&
        sqliteDriver === 'better-sqlite3'
    ) {
        targets.push({
            cwd: resolve(projectRoot, '..', 'or3-provider-sqlite'),
            label: 'or3-provider-sqlite',
        });
    }

    return targets;
}

/** True only for the ABI drift error produced by a stale native addon. */
export function isNativeAddonAbiMismatch(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const moduleVersions = error.message.match(/NODE_MODULE_VERSION\s+\d+/g);
    return (
        moduleVersions !== null &&
        moduleVersions.length >= 2 &&
        /compiled against/.test(error.message) &&
        /\brequires\b/.test(error.message)
    );
}

function verifyNativeSqliteDependency(target: NativeSqliteDependencyTarget): void {
    const dependency = resolve(
        target.cwd,
        'node_modules',
        'better-sqlite3',
        'package.json',
    );
    if (!existsSync(dependency)) return;

    const requireFromTarget = createRequire(resolve(target.cwd, 'package.json'));
    const Database = requireFromTarget('better-sqlite3') as new (
        filename: string,
    ) => { close: () => void };
    const database = new Database(':memory:');
    database.close();
}

function nativeSqliteRepairCommand(
    packageManager: PackageManager,
): PackageManagerCommand {
    if (packageManager === 'bun') {
        return {
            command: 'bun',
            args: ['install', '--force', '--frozen-lockfile'],
        };
    }
    return { command: 'npm', args: ['rebuild', 'better-sqlite3'] };
}

async function repairNativeSqliteDependency(
    target: NativeSqliteDependencyTarget,
    packageManager: PackageManager,
): Promise<void> {
    await runForegroundCommand(nativeSqliteRepairCommand(packageManager), {
        cwd: target.cwd,
        label: `Native SQLite repair for ${target.label}`,
    });
}

/**
 * Rebuild stale better-sqlite3 bindings before Nuxt can fail on their ABI.
 * Nothing runs when the active configuration does not use native SQLite.
 */
export async function ensureNativeSqliteDependencies(
    targets = nativeSqliteDependencyTargets(),
    packageManager = detectPackageManager(),
    hooks: NativeSqliteDependencyHooks = {},
): Promise<void> {
    const verify = hooks.verify ?? verifyNativeSqliteDependency;
    const repair = hooks.repair ?? repairNativeSqliteDependency;
    const staleTargets: NativeSqliteDependencyTarget[] = [];

    for (const target of targets) {
        try {
            verify(target);
        } catch (error) {
            if (!isNativeAddonAbiMismatch(error)) throw error;
            staleTargets.push(target);
        }
    }

    if (staleTargets.length === 0) return;

    console.log('');
    console.log('  Repairing native SQLite bindings for this runtime…');
    for (const target of staleTargets) {
        await repair(target, packageManager);
        try {
            verify(target);
        } catch (error) {
            throw new Error(
                `Native SQLite repair completed but ${target.label} still cannot load: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        console.log(`  ✓ Repaired better-sqlite3 in ${target.label}`);
    }
    console.log('');
}

export function parsePort(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--port') {
            const value = Number(argv[index + 1]);
            if (Number.isInteger(value) && value > 0) return value;
        }
        if (arg?.startsWith('--port=')) {
            const value = Number(arg.slice('--port='.length));
            if (Number.isInteger(value) && value > 0) return value;
        }
    }
    const envPort = Number(env.PORT);
    if (Number.isInteger(envPort) && envPort > 0) return envPort;
    return DEFAULT_PORT;
}

export function parseHost(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--host') {
            const value = argv[index + 1];
            if (value && !value.startsWith('--')) return value;
        }
        if (arg?.startsWith('--host=')) {
            return arg.slice('--host='.length);
        }
    }
    return env.HOST || '127.0.0.1';
}

export { isPortAvailable };

export async function findFreePort(start: number, host: string): Promise<number | null> {
    for (let port = start + 1; port < start + 50; port += 1) {
        if (await isPortAvailable(port, host)) return port;
    }
    return null;
}

export function rewritePortArg(argv: string[], port: number): string[] {
    const next = [...argv];
    for (let index = 0; index < next.length; index += 1) {
        if (next[index] === '--port') {
            next[index + 1] = String(port);
            return next;
        }
        if (next[index]?.startsWith('--port=')) {
            next[index] = `--port=${port}`;
            return next;
        }
    }
    next.push('--port', String(port));
    return next;
}

/**
 * Args that `dev:ssr` / `dev:offline` should pass through to the dev script.
 * Kept as a pure helper so tests can assert the package.json → wrapper contract.
 */
export function forwardDevArgs(argvAfterDoubleDash: string[]): string[] {
    return argvAfterDoubleDash.filter((arg) => arg !== '--');
}

/**
 * Node 22+ exposes an experimental server-side localStorage global. Nuxt's
 * devtools dependency sees Node's built-in navigator and probes that global,
 * which otherwise emits an ExperimentalWarning after the first browser load.
 * Keep its ephemeral state inside Nuxt's ignored build directory.
 */
export function nuxtDevEnvironment(
    env: NodeJS.ProcessEnv = process.env,
    projectRoot = process.cwd(),
): NodeJS.ProcessEnv {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const nodeOptions = env.NODE_OPTIONS?.trim() ?? '';
    if (
        nodeMajor < 22 ||
        /(?:^|\s)--localstorage-file(?:=|\s|$)/.test(nodeOptions)
    ) {
        return env;
    }

    const localStorageFile = resolve(projectRoot, '.nuxt', 'node-localstorage');
    return {
        ...env,
        NODE_OPTIONS: [nodeOptions, `--localstorage-file=${localStorageFile}`]
            .filter(Boolean)
            .join(' '),
    };
}

function runNuxtDev(argv: string[]): Promise<number> {
    const command = execPackageCommand(detectPackageManager(), [
        'nuxt',
        'dev',
        ...argv,
    ]);
    return new Promise((resolvePromise, rejectPromise) => {
        const child = crossSpawn(command.command, command.args, {
            stdio: 'inherit',
            env: nuxtDevEnvironment(),
        });
        child.on('error', rejectPromise);
        child.on('exit', (code) => resolvePromise(code ?? 0));
        // Forward termination signals to the child so Ctrl+C behaves normally.
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

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const offline = argv.includes('--or3-offline');
    const ssr = argv.includes('--or3-ssr');
    const nuxtArgs = argv.filter(
        (arg) => arg !== '--or3-offline' && arg !== '--or3-ssr'
    );
    if (offline) {
        Object.assign(process.env, {
            SSR_AUTH_ENABLED: 'false',
            OR3_SYNC_ENABLED: 'false',
            OR3_CLOUD_SYNC_ENABLED: 'false',
            OR3_STORAGE_ENABLED: 'false',
            OR3_CLOUD_STORAGE_ENABLED: 'false',
            OR3_BACKGROUND_STREAMING_ENABLED: 'false',
        });
    } else if (ssr) {
        process.env.SSR_AUTH_ENABLED = 'true';
    }

    await ensureNativeSqliteDependencies();

    const port = parsePort(nuxtArgs);
    const host = parseHost(nuxtArgs);

    if (await isPortAvailable(port, host)) {
        return await runNuxtDev(nuxtArgs);
    }

    console.log('');
    console.log(`  ⚠️  Port ${port} is already in use.`);
    console.log('');
    console.log('  Most likely another OR3/Nuxt dev server is still running.');
    console.log('  A stale server makes code changes appear to "not work"');
    console.log('  and can cause confusing 404s on API routes.');
    console.log('');
    console.log('  To kill whatever is using the port:');
    console.log(`    lsof -ti:${port} | xargs kill`);
    console.log('');

    const isInteractive = Boolean(input.isTTY && output.isTTY);
    const nextFree = await findFreePort(port, host);

    if (!isInteractive || nextFree === null) {
        if (nextFree !== null) {
            console.log(`  Or start on a free port instead:`);
            console.log(
                `    ${detectPackageManager()} run dev -- --port ${nextFree}`
            );
            console.log('');
        }
        return 1;
    }

    const rl = readline.createInterface({ input, output });
    try {
        const answer = (
            await rl.question(`  Start on port ${nextFree} instead? [Y/n]: `)
        )
            .trim()
            .toLowerCase();
        if (answer && answer !== 'y' && answer !== 'yes') {
            console.log('  Aborted. Free up the port and try again.');
            return 1;
        }
    } finally {
        rl.close();
    }

    console.log(`\n  Starting on http://localhost:${nextFree}\n`);
    return await runNuxtDev(rewritePortArg(nuxtArgs, nextFree));
}

const isDirectRun =
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
    main().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    );
}
