import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { watch, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { RestartController, RestartError } from '../server/restarts/controller';
import { createRestartConfigurationSource } from '../server/restarts/configuration';
import { handleRestartRequest } from '../server/restarts/http';
import { probeDevelopmentReadiness } from './readiness';

type Options = {
    signal?: AbortSignal;
    root: string; runtime: string; args: string[]; origin: string; envFile: string;
    environment(): Promise<NodeJS.ProcessEnv>;
    prerequisites?(): void;
};

/** Check prepared inputs twice around acceptance; never rebuild on replacement. */
export function createDevelopmentPrerequisiteCheck(root: string, artifacts: string[]): () => void {
    const files = ['package.json', 'bun.lock', 'bun.lockb', 'or3.providers.generated.ts'].map(file => join(root, file));
    const signature = () => {
        const hash = createHash('sha256');
        for (const file of files) {
            try {
                if (statSync(file).size > 8 * 1024 * 1024) throw new RestartError('setup_required');
                hash.update(file).update(readFileSync(file));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                hash.update(file).update('missing');
            }
        }
        return hash.digest('hex');
    };
    const prepared = signature();
    return () => {
        try {
            if (signature() !== prepared || artifacts.some(file => !statSync(file).isFile())) throw new RestartError('setup_required');
        } catch { throw new RestartError('setup_required'); }
    };
}

/** OR3 owns a private child process group; no lookup/termination by occupied port. */
export async function superviseDevelopment(options: Options): Promise<number> {
    const socketDirectory = await mkdtemp(join(tmpdir(), 'o3r-'));
    try { return await superviseOwnedDevelopment(options, socketDirectory); }
    finally { await rm(socketDirectory, { recursive: true, force: true }); }
}

async function superviseOwnedDevelopment(options: Options, socketDirectory: string): Promise<number> {
    await chmod(socketDirectory, 0o700);
    const socketPath = join(socketDirectory, 'control.sock');
    const initial = await options.environment();
    const identity = createHash('sha256').update(`${options.root}:${options.origin}`).digest('hex');
    const stateDirectory = initial.OR3_DEV_RESTART_STATE_DIR || join(options.root, '.or3', 'restarts', identity.slice(0, 16));
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const configuration = await createRestartConfigurationSource(options.envFile, stateDirectory, options.environment);
    const token = randomBytes(32).toString('hex');
    const emptyEnv = join(socketDirectory, 'launch.env');
    await writeFile(emptyEnv, '', { mode: 0o600 });
    let child: ChildProcess | null = null;
    let childExit: Promise<void> = Promise.resolve();
    let stopping = false;
    let replacing = false;
    let hasRun = false;
    let dashboardRevision: string | null = null;
    let finish!: (code: number) => void;
    const finished = new Promise<number>(resolve => { finish = resolve; });

    function signalOwned(signal: NodeJS.Signals) {
        if (!child?.pid) return;
        try { process.kill(-child.pid, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    async function stopChild() {
        if (!child?.pid) return;
        const pid = child.pid;
        signalOwned('SIGTERM');
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([childExit, new Promise<void>(resolve => { timer = setTimeout(resolve, 25_000); })]);
        clearTimeout(timer!);
        // Clean only our process group, including a descendant left after its leader exits.
        try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        await childExit;
        child = null;
    }
    async function launch() {
        options.signal?.throwIfAborted();
        if (stopping) throw new RestartError('supervisor_stopping');
        const environment = await options.environment();
        options.signal?.throwIfAborted();
        const args = [...options.args];
        // Nuxt must not independently watch/reload the authoritative file.
        const dotenv = args.indexOf('--dotenv');
        if (dotenv >= 0) args.splice(dotenv, 2);
        const filtered = args.filter(arg => !arg.startsWith('--dotenv='));
        filtered.push('--dotenv', emptyEnv);
        const launched = spawn(options.runtime, filtered, {
            cwd: options.root, stdio: 'inherit', detached: true,
            env: { ...environment, NITRO_SHUTDOWN_TIMEOUT: '20000', DOTENV_CONFIG_PATH: emptyEnv, OR3_DEV_RESTART_SOCKET: socketPath, OR3_DEV_RESTART_TOKEN: token },
        });
        child = launched;
        childExit = new Promise<void>(resolve => {
            launched.once('exit', code => {
                resolve();
                if (!replacing && !stopping && !hasRun) finish(code ?? 1);
                if (!replacing && !stopping && hasRun) console.error('[restart] Development child exited; inspect the terminal before retrying.');
            });
            launched.once('error', () => { resolve(); if (!hasRun) finish(1); });
        });
        await new Promise<void>((resolve, reject) => { launched.once('spawn', resolve); launched.once('error', reject); });
    }
    const controller = new RestartController(stateDirectory, {
        mode: 'development', identity, ...configuration,
        async save(updates, expectedRevision) {
            await configuration.save(updates, expectedRevision);
            dashboardRevision = (await configuration.configuration()).revision;
        },
        async acquire() { options.prerequisites?.(); return async () => {}; }, // One serialized surviving supervisor.
        async assertOwnership() { options.prerequisites?.(); },
        async replace() {
            replacing = true; hasRun = true;
            try { await stopChild(); await launch(); } finally { replacing = false; }
        },
        async probe(deadline = performance.now() + 3_000) {
            await probeDevelopmentReadiness(options.origin, deadline);
        },
    });
    await controller.initialize();
    const server = createServer(async (request, response) => {
        const received = request.headers['x-or3-controller-token'];
        if (typeof received !== 'string' || received.length !== token.length || !timingSafeEqual(Buffer.from(received), Buffer.from(token))) {
            response.writeHead(403); response.end(); return;
        }
        if (!await handleRestartRequest(controller, request, response)) { response.writeHead(404); response.end(); }
    });
    server.requestTimeout = 5_000;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    let watcher: ReturnType<typeof watch> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let probeRunning = false;
    const probe = setInterval(() => {
        if (probeRunning || stopping) return;
        probeRunning = true;
        void probeDevelopmentReadiness(options.origin).catch(() => {}).finally(() => { probeRunning = false; });
    }, 1_000);
    const shutdown = () => {
        if (stopping) return;
        stopping = true;
        void stopChild().then(() => finish(0), error => {
            console.error('[shutdown] Unable to stop development child:', error);
            finish(1);
        });
    };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
    options.signal?.addEventListener('abort', shutdown);
    if (options.signal?.aborted) shutdown();
    try {
        await launch();
        watcher = watch(dirname(options.envFile), (_event, name) => {
            if (String(name) !== basename(options.envFile) || stopping) return;
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                void (async () => {
                    const status = await controller.status();
                    if (!status.bootId || status.savedRevision === dashboardRevision || status.activeRevision === status.savedRevision || (status.operation && !['succeeded', 'cancelled', 'failed'].includes(status.operation.phase))) return;
                    await controller.submit({ requestId: crypto.randomUUID(), policy: 'wait', target: { kind: 'saved', savedRevision: status.savedRevision } });
                })().catch(error => console.warn('[restart] Environment change requires setup or confirmation:', error instanceof RestartError ? error.code : 'configuration_unavailable'));
            }, 350);
        });
        return await finished;
    } finally {
        stopping = true; clearInterval(probe); clearTimeout(debounce); watcher?.close(); controller.dispose();
        options.signal?.removeEventListener('abort', shutdown);
        process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
        await stopChild();
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
