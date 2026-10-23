import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { createClient as ClientFactory } from '@or3/secrets/client';
import { AdvisoryPluginOperationLock } from '../../server/admin/plugins/package-operation-lock';
import { writeEnvFileDetailed } from '../../server/admin/config/env-file';

const execute = promisify(execFile);
const prefix = 'NUXT_SECRETS_';
const fields = ['SOCKET_PATH', 'TOKEN_FILE', 'NAMESPACE', 'VAULT_ID', 'SERVICE_UID'] as const;
type Settings = Record<typeof fields[number] | 'PROVIDER', string>;
type Mode = 'auto' | 'manual' | 'disable';
type Owner = { env: NodeJS.ProcessEnv; close: () => Promise<void> };
const noop = async () => {};
const setupRequired = 'Secrets setup required. After updating, run bun install. Run bun run setup:secrets in a terminal (automatic local vault, manual attachment, or explicit instance-billing-only mode).';

async function optionalRead(path: string): Promise<string | undefined> {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function privateDirectory(path: string) {
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
        throw new Error(`Unsafe local vault directory: ${path}. Preserve existing custody and correct its ownership/permissions.`);
    }
}
function environmentSettings(config: Partial<Settings>): Record<string, string> {
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [prefix + key, value]));
}
function settings(env: NodeJS.ProcessEnv): Settings {
    return Object.fromEntries(['PROVIDER', ...fields].map(key => [key, env[prefix + key] ?? ''])) as Settings;
}
function validate(config: Settings) {
    if (!isAbsolute(config.SOCKET_PATH) || !isAbsolute(config.TOKEN_FILE) || !config.NAMESPACE.trim()
        || !/^[a-f0-9]{32}$/.test(config.VAULT_ID) || !/^\d+$/.test(config.SERVICE_UID)
        || !Number.isSafeInteger(Number(config.SERVICE_UID)) || Number(config.SERVICE_UID) > 4294967295) {
        throw new Error(`${setupRequired} Socket/token paths must be absolute; namespace, the initialized vault ID and the numeric vault service UID are required.`);
    }
}
function clientFor(createClient: typeof ClientFactory, config: Settings, operatorFile?: string) {
    validate(config);
    return createClient({ socketPath: config.SOCKET_PATH, tokenFile: operatorFile ?? config.TOKEN_FILE,
        vaultId: config.VAULT_ID, serviceUid: Number(config.SERVICE_UID), timeoutMs: 5_000 });
}

async function verify(createClient: typeof ClientFactory, config: Settings) {
    const client = clientFor(createClient, config);
    await client.status();
    // A valid token for a different namespace must not pass manual setup.
    await client.list({ scope: { namespace: config.NAMESPACE, ownerUserId: '@or3-startup', workspaceId: '@or3-startup', consumerId: '@or3-startup' }, limit: 1 });
}

/** Only a refused connection proves staleness; auth failures and timeouts do not. */
async function recoverStaleSocket(socketPath: string): Promise<void> {
    let before;
    try { before = await lstat(socketPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!before.isSocket() || before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o600) {
        throw new Error('Unsafe local vault socket. Existing path and custody were preserved.');
    }
    // Bun 1.3 reports ENOENT for refused Unix connections. Use the required
    // Node runtime to distinguish a stale endpoint from an ambiguous failure.
    const probe = await execute('node', ['-e', `
        const connection = require('node:net').createConnection({ path: process.argv[1] });
        connection.setTimeout(3000, () => { console.log('ETIMEDOUT'); connection.destroy(); });
        connection.once('connect', () => { console.log('reachable'); connection.destroy(); });
        connection.once('error', error => console.log(error.code));
    `, socketPath], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 5_000, maxBuffer: 1024 });
    if (probe.stdout.trim() !== 'ECONNREFUSED') {
        throw new Error(`Local vault socket is reachable or its staleness cannot be proven (${probe.stdout.trim()}). Check its identity/token; existing socket was preserved.`);
    }
    const current = await lstat(socketPath);
    if (current.dev !== before.dev || current.ino !== before.ino || !current.isSocket()
        || current.uid !== before.uid || current.mode !== before.mode) {
        throw new Error('Local vault socket changed during recovery; existing path was preserved.');
    }
    // The launcher lock fences other source launchers through bind and readiness.
    await rm(socketPath);
    console.log('Recovered stale local vault socket; vault data and keys preserved.');
}

/** Source launch boundary. Never runs during Nuxt builds or from a web request. */
export async function prepareSourceSecrets(
    projectRoot: string,
    environment: NodeJS.ProcessEnv,
    options: { envFile?: string; mode?: Mode } = {},
): Promise<Owner> {
    const selected = environment.NUXT_SECRETS_PROVIDER ?? (environment.SSR_AUTH_ENABLED === 'true' ? 'or3-secrets' : '');
    if ((!options.mode && selected !== 'or3-secrets') || options.mode === 'manual' || options.mode === 'disable'
        || process.getuid?.() === undefined) return prepareSourceSecretsLocked(projectRoot, environment, options);
    const root = await realpath(projectRoot);
    const socketDirectory = join(await realpath(tmpdir()), `or3-vault-${process.getuid()}-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`);
    await privateDirectory(socketDirectory);
    // Reuse the process-owned repository lock: a live owner is never displaced
    // by age, and a dead launcher's lease can be recovered on the next launch.
    const lock = new AdvisoryPluginOperationLock(socketDirectory, undefined, true);
    const acquire = () => lock.acquire('launcher', { requireDeadOwner: true });
    const lease = await acquire();
    try {
        const owner = await prepareSourceSecretsLocked(root, environment, options);
        let closing: Promise<void> | undefined;
        return { env: owner.env, close: () => closing ??= (async () => {
            const shutdownLease = await acquire();
            try { await owner.close(); } finally { await shutdownLease.release(); }
        })() };
    } finally { await lease.release(); }
}

async function prepareSourceSecretsLocked(
    projectRoot: string,
    environment: NodeJS.ProcessEnv,
    options: { envFile?: string; mode?: Mode },
): Promise<Owner> {
    const env = { ...environment };
    const selected = env.NUXT_SECRETS_PROVIDER ?? (env.SSR_AUTH_ENABLED === 'true' ? 'or3-secrets' : '');
    if (!options.mode && selected !== 'or3-secrets') return { env, close: noop };
    const root = await realpath(projectRoot);
    const envFile = resolve(root, options.envFile ?? '.env');
    const expectedContent = await optionalRead(envFile) ?? '';
    let config = { ...settings(env), PROVIDER: 'or3-secrets' };
    let mode = options.mode;
    const complete = fields.every(field => config[field] !== '');
    if (!mode && !complete) {
        if (!process.stdin.isTTY || !process.stdout.isTTY || (env.CI && env.CI !== 'false')) throw new Error(setupRequired);
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try {
            console.log('\nOR3 needs a secret store before starting. Existing vault data will be preserved.');
            console.log('1. Automatically create/use a local development vault (same OS user)');
            console.log('2. Manually attach an existing vault service');
            console.log('3. Instance billing only (personal keys, OAuth and remembered plugin secrets unavailable)');
            const answer = (await prompt.question('Choose 1, 2 or 3; Enter cancels: ')).trim();
            mode = new Map<string, Mode>([['1', 'auto'], ['2', 'manual'], ['3', 'disable']]).get(answer);
            if (!mode) throw new Error(setupRequired);
        } finally { prompt.close(); }
    }
    const persist = async (value: Settings | { PROVIDER: string }) => {
        const updates = environmentSettings(value);
        await writeEnvFileDetailed(updates, { envFile, expectedContent, createBackup: true });
        Object.assign(env, updates);
    };
    if (mode === 'disable') {
        await persist({ PROVIDER: '' });
        console.log('Personal secret storage disabled explicitly; instance billing remains available.');
        return { env, close: noop };
    }

    let clientEntry: string;
    try { clientEntry = createRequire(join(root, 'package.json')).resolve('@or3/secrets/client'); }
    catch { throw new Error('The selected @or3/secrets package is missing. Run bun install after updating, then bun run setup:secrets.'); }
    const { createClient } = await import(pathToFileURL(clientEntry).href) as { createClient: typeof ClientFactory };
    if (mode === 'manual' && process.stdin.isTTY && process.stdout.isTTY) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try {
            for (const field of fields) {
                const answer = (await prompt.question(`${prefix + field}${config[field] ? ` [${config[field]}]` : ''}: `)).trim();
                config[field] = answer || config[field];
            }
        } finally { prompt.close(); }
    }

    const directory = join(root, '.or3/secrets');
    const stateFile = join(directory, 'launch.json');
    let state: Settings | undefined;
    const existingState = mode === 'auto' || (!mode && config.TOKEN_FILE === join(directory, 'service.token'))
        ? await optionalRead(stateFile) : undefined;
    if (existingState !== undefined) {
        await privateDirectory(directory);
        state = JSON.parse(existingState) as Settings;
        validate(state);
    }
    if (mode === 'auto') {
        if (process.platform === 'win32' || process.getuid?.() === undefined) throw new Error('Local vault setup requires macOS or Linux. Use the managed Docker installation.');
        if (env.NODE_ENV === 'production') throw new Error('Automatic same-user vault setup is for source development. Attach a separately provisioned vault with bun run setup:secrets --manual for production.');
        // Partial external settings must never be replaced by a fresh local vault.
        if (state
            ? fields.some(field => config[field] && config[field] !== state![field])
            : fields.some(field => field !== 'NAMESPACE' && config[field])) {
            throw new Error('Existing vault settings differ from local custody. Use manual attachment; no settings or keys were replaced.');
        }
        if (!state) {
            // Check the provider's qualified runtime before creating the custody lock directory.
            await execute('bun', ['--no-env-file', join(dirname(clientEntry), 'cli.js'), 'init', '--help'],
                { env: { PATH: env.PATH, HOME: env.HOME }, timeout: 10_000, maxBuffer: 64 * 1024 });
            await mkdir(join(root, '.or3'), { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
            // Exclusive creation is the initialization lock. An incomplete directory is never reset.
            try { await mkdir(directory, { mode: 0o700 }); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Local vault custody already exists but is incomplete. Preserve .or3/secrets; restore its matching configuration/key instead of regenerating it.');
                throw error;
            }
            const socketDir = join(await realpath(tmpdir()), `or3-vault-${process.getuid!()}-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`);
            await privateDirectory(socketDir);
            const result = await execute('bun', ['--no-env-file', join(dirname(clientEntry), 'cli.js'), 'init',
                '--vault-dir', join(directory, 'vault'), '--key-file', join(directory, 'master.key'), '--operator-file', join(directory, 'operator.token')],
            { env: { PATH: env.PATH, HOME: env.HOME }, timeout: 30_000, maxBuffer: 64 * 1024 });
            state = { PROVIDER: 'or3-secrets', SOCKET_PATH: join(socketDir, 'api.sock'), TOKEN_FILE: join(directory, 'service.token'),
                NAMESPACE: config.NAMESPACE || 'or3', VAULT_ID: (JSON.parse(result.stdout) as { vaultId: string }).vaultId, SERVICE_UID: String(process.getuid!()) };
            validate(state);
            await writeFile(stateFile, JSON.stringify(state) + '\n', { mode: 0o600, flag: 'wx' });
        }
        config = state;
    }
    validate(config);
    const owned = mode !== 'manual' && state && ['PROVIDER', ...fields].every(field => config[field as keyof Settings] === state![field as keyof Settings]);
    if (!owned) {
        try { await verify(createClient, config); }
        catch (error) { throw new Error(`Cannot connect to the configured vault (${error instanceof Error ? error.message : 'unavailable'}). Verify the service, pinned UID/ID and token. Run bun run setup:secrets --manual; existing custody was preserved.`); }
        if (mode) await persist(config);
        return { env, close: noop };
    }
    await privateDirectory(directory);
    await privateDirectory(dirname(config.SOCKET_PATH));
    // A live vault may belong to another launcher. Validate it; never kill or unlink it.
    try {
        await verify(createClient, config);
        if (mode) await persist(config);
        return { env: { ...env, ...environmentSettings(config) }, close: noop };
    } catch { /* A token/identity failure alone never authorizes removing a socket. */ }
    await recoverStaleSocket(config.SOCKET_PATH);
    const child = spawn('bun', ['--no-env-file', join(dirname(clientEntry), 'cli.js'), 'serve', '--vault-dir', join(directory, 'vault'),
        '--key-file', join(directory, 'master.key'), '--socket', config.SOCKET_PATH],
    { env: { PATH: env.PATH, HOME: env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8192); });
    let closing = false;
    const exited = new Promise<void>(resolveExit => child.once('close', () => resolveExit()));
    const exitCleanup = () => { child.kill('SIGTERM'); };
    process.once('exit', exitCleanup);
    let renewal: ReturnType<typeof setInterval> | undefined;
    let closePromise: Promise<void> | undefined;
    const close = () => closePromise ??= (async () => {
        closing = true;
        clearInterval(renewal);
        process.off('exit', exitCleanup);
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
        try { await exited; } finally { clearTimeout(force); }
    })();
    try {
        await new Promise<void>((resolveReady, reject) => {
            let output = '';
            const timer = setTimeout(() => finish(new Error('Local vault startup timed out.')), 10_000);
            const finish = (error?: Error) => { clearTimeout(timer); child.stdout.off('data', data); child.off('error', fail); child.off('close', stopped); error ? reject(error) : resolveReady(); };
            const data = (chunk: Buffer) => {
                output += String(chunk);
                if (output.length > 8192) return finish(new Error('Unexpected local vault output.'));
                if (!output.includes('\n')) return;
                try { if (JSON.parse(output.split('\n')[0]!).ready) finish(); else finish(new Error('Local vault was not ready.')); }
                catch { finish(new Error('Invalid local vault readiness response.')); }
            };
            const fail = (error: Error) => finish(error);
            const stopped = () => finish(new Error(`Local vault failed to start. ${stderr.trim()} Preserve custody; do not delete or regenerate the key.`));
            child.stdout.on('data', data); child.once('error', fail); child.once('close', stopped);
        });
        const operator = clientFor(createClient, config, join(directory, 'operator.token'));
        const renew = async () => {
            const current = await optionalRead(config.TOKEN_FILE);
            if (current !== undefined) {
                const stat = await lstat(config.TOKEN_FILE);
                if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) throw new Error('Unsafe local service token file.');
            }
            const issued = await operator.issueToken({ kind: 'service', namespace: config.NAMESPACE, capabilities: ['metadata', 'read', 'write', 'delete'], expiresInSeconds: 7 * 86400 });
            const temporary = join(directory, `service-${randomUUID()}.tmp`);
            try {
                await writeFile(temporary, issued.token + '\n', { mode: 0o600, flag: 'wx' });
                await clientFor(createClient, { ...config, TOKEN_FILE: temporary }).status();
                await rename(temporary, config.TOKEN_FILE);
            } finally { await rm(temporary, { force: true }); }
            const previousId = current?.trim().match(/^ors1\.([a-f0-9]{32})\./)?.[1];
            if (previousId) await operator.revokeToken(previousId);
        };
        await renew();
        await verify(createClient, config);
        if (mode) await persist(config);
        Object.assign(env, environmentSettings(config));
        renewal = setInterval(() => { void renew().catch(() => console.error('Local vault token renewal failed. Restart the source launcher to recheck custody.')); }, 86400_000);
        renewal.unref();
        child.once('exit', () => { if (!closing) console.error('Local secret vault stopped unexpectedly. Personal secret operations fail closed; restart the source launcher.'); });
        console.log('Local development vault ready. Keep .or3/secrets backed up; do not delete its master key.');
        return { env, close };
    } catch (error) { await close(); throw error; }
}
