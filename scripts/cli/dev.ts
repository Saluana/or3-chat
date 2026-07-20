#!/usr/bin/env bun
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
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const DEFAULT_PORT = 3000;

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

function canBind(port: number, host: string): Promise<boolean> {
    return new Promise((resolvePromise) => {
        const server = createServer();
        server.once('error', () => resolvePromise(false));
        server.once('listening', () => {
            server.close(() => resolvePromise(true));
        });
        server.listen(port, host);
    });
}

export async function isPortAvailable(port: number, host: string): Promise<boolean> {
    // Dev servers may bind to IPv4 (127.0.0.1) or IPv6 (::1) loopback — a
    // server on one family does not block binding the other, so check both.
    // This is what catches "stale Nuxt dev server on localhost:3000".
    const hosts = new Set<string>([host, '127.0.0.1', '::1']);
    for (const candidate of hosts) {
        if (!(await canBind(port, candidate))) return false;
    }
    return true;
}

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
 * Args that `dev:ssr` / `dev:offline` should pass through `bun run dev -- …`.
 * Kept as a pure helper so tests can assert the package.json → wrapper contract.
 */
export function forwardDevArgs(argvAfterDoubleDash: string[]): string[] {
    return argvAfterDoubleDash.filter((arg) => arg !== '--');
}

function runNuxtDev(argv: string[]): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('bunx', ['nuxt', 'dev', ...argv], {
            stdio: 'inherit',
            env: process.env,
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
    const port = parsePort(argv);
    const host = parseHost(argv);

    if (await isPortAvailable(port, host)) {
        return await runNuxtDev(argv);
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
            console.log(`    bun run dev -- --port ${nextFree}`);
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
    return await runNuxtDev(rewritePortArg(argv, nextFree));
}

if (import.meta.main) {
    main().then(
        (code) => process.exit(code),
        (error) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    );
}
