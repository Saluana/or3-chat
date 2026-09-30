import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { watch, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectSourceSnapshot, hashSourceSnapshot } from '../../packages/plugin-sdk/src/candidate';

export type WatchedCandidate = {
    runId: string;
    generation: number;
    pluginId: string;
    packageDigest: string;
    receiptDigest: string;
};

export type PluginWatchStatus = {
    runId: string;
    state: 'starting' | 'building' | 'ready' | 'error';
    generation: number;
    candidate: WatchedCandidate | null;
    lastGood: WatchedCandidate | null;
    message?: string;
};

const MAX_DISPOSABLE_BYTES = 512 * 1024 * 1024;

function snapshotHash(root: string): string {
    const snapshot = collectSourceSnapshot(root);
    return hashSourceSnapshot(root, snapshot.files);
}

function trySnapshotHash(root: string): string | null {
    try { return snapshotHash(root); } catch { return null; }
}

function writeStatus(profileRoot: string, status: PluginWatchStatus): void {
    const path = join(profileRoot, 'watch.json');
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(status)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
}

export function pluginBuildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env = { ...source };
    for (const key of Object.keys(env)) {
        if (/^(OR3_|NUXT_|AUTH_|CLERK_|CONVEX_|OPENROUTER_)/.test(key) || key === 'DOTENV_CONFIG_PATH') {
            delete env[key];
        }
    }
    return env;
}

async function runBun(args: string[], cwd: string, signal: AbortSignal): Promise<string> {
    return new Promise((accept, reject) => {
        // Authoring generators are plugin code. They need the developer's Bun
        // environment, never this host's local admin and provider secrets.
        const child = spawn('bun', args, { cwd, env: pluginBuildEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], signal });
        let output = '';
        const append = (chunk: Buffer) => {
            output = `${output}${chunk.toString()}`.slice(-16_000);
        };
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? accept(output) : reject(new Error(output.trim() || `bun ${args[0]} exited ${code}`)));
    });
}

function disposableSize(root: string): number {
    if (!existsSync(root)) return 0;
    let total = 0;
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (entry.isFile()) total += statSync(path).size;
        }
    };
    visit(root);
    return total;
}

export function watchPluginCandidate(pluginRoot: string, profileRoot: string): () => void {
    const root = resolve(pluginRoot);
    const runId = randomUUID();
    const candidatesRoot = join(profileRoot, 'candidates');
    const generations = join(candidatesRoot, runId);
    mkdirSync(generations, { recursive: true, mode: 0o700 });
    // The profile lock guarantees that no prior run can still serve these
    // disposable download copies. Admitted packages live in the host store.
    for (const entry of readdirSync(candidatesRoot, { withFileTypes: true })) {
        if (entry.name !== runId) rmSync(join(candidatesRoot, entry.name), { recursive: true, force: true });
    }
    let status: PluginWatchStatus = { runId, state: 'starting', generation: 0, candidate: null, lastGood: null };
    let lastBuiltHash = '';
    let lastAttemptHash = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let building = false;
    let closed = false;
    const abort = new AbortController();
    const publish = (next: PluginWatchStatus) => { status = next; writeStatus(profileRoot, next); };
    publish(status);

    const build = async (): Promise<void> => {
        if (closed || building) return;
        const started = performance.now();
        const initialHash = trySnapshotHash(root);
        if (initialHash === lastAttemptHash) return;
        if (initialHash) lastAttemptHash = initialHash;
        let attemptedHash = initialHash;
        let failed = false;
        building = true;
        const generation = status.generation + 1;
        const destination = join(generations, String(generation));
        publish({ ...status, state: 'building', generation, message: undefined });
        try {
            const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
            if (manifest.scripts?.['profile:generate']) {
                await runBun(['run', 'profile:generate'], root, abort.signal);
            }
            const before = snapshotHash(root);
            lastAttemptHash = before;
            attemptedHash = before;
            if (before === lastBuiltHash) {
                publish({ ...status, state: status.lastGood ? 'ready' : 'starting', candidate: status.lastGood });
                return;
            }
            if (disposableSize(generations) > MAX_DISPOSABLE_BYTES) {
                throw new Error('Watch artifacts exceed 512 MiB. Remove unused files from this local profile, then save again.');
            }
            const cli = resolve(root, 'node_modules/.bin/or3-plugin');
            await runBun([cli, 'candidate', root, '--out', destination], root, abort.signal);
            // An edit during build cannot publish a mixed source/package generation.
            const after = snapshotHash(root);
            if (before !== after) {
                rmSync(destination, { recursive: true, force: true });
                lastBuiltHash = '';
                schedule();
                return;
            }
            const verifiedOutput = await runBun([cli, 'candidate', '--verify', destination], root, abort.signal);
            const verified = JSON.parse(verifiedOutput.trim()) as {
                pluginId: string; receiptSha256: string;
            };
            const receipt = JSON.parse(readFileSync(join(destination, 'receipt.json'), 'utf8')) as {
                packageTreeSha256: string;
            };
            const candidate: WatchedCandidate = {
                runId, generation, pluginId: verified.pluginId,
                packageDigest: receipt.packageTreeSha256, receiptDigest: verified.receiptSha256,
            };
            lastBuiltHash = after;
            publish({ runId, state: 'ready', generation, candidate, lastGood: candidate });
            // A browser may still be downloading the immediately previous
            // generation; older copies cannot pass the run/generation gate.
            for (const entry of readdirSync(generations, { withFileTypes: true })) {
                const number = Number(entry.name);
                if (entry.isDirectory() && Number.isSafeInteger(number) && number < generation - 1) {
                    rmSync(join(generations, entry.name), { recursive: true, force: true });
                }
            }
            console.log(`[plugin-dev] ${verified.pluginId} ready in ${Math.round(performance.now() - started)} ms`);
        } catch (error) {
            if (closed) return;
            failed = true;
            // A later save of the same source should retry a failed build,
            // for example after the author installs a missing dependency.
            lastAttemptHash = '';
            rmSync(destination, { recursive: true, force: true });
            const raw = error instanceof Error ? error.message : String(error);
            const message = /could not resolve|cannot find module|module not found|lockfile/i.test(raw)
                ? `${raw}\nRun bun install in the plugin directory, then save again.`
                : raw;
            publish({ ...status, state: 'error', candidate: null, message: message.slice(0, 4000) });
            console.error(`[plugin-dev] ${message}`);
        } finally {
            building = false;
            // A save during this build is checked even if watcher events were coalesced.
            const latest = trySnapshotHash(root);
            if (!closed && latest !== null && latest !== (failed ? attemptedHash : lastAttemptHash)) schedule();
        }
    };

    const schedule = (): void => {
        if (closed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void build(); }, 150);
    };
    const watcher = watch(root, { recursive: true }, (_event, name) => {
        const relative = name?.toString().replaceAll('\\', '/') ?? '';
        if (/^(node_modules|\.git|\.or3-dev|dist|coverage|\.or3-pack)(\/|$)/.test(relative)) return;
        schedule();
    });
    schedule();
    return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        abort.abort();
        watcher.close();
    };
}
