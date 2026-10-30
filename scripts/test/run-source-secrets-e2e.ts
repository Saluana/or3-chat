/** Real published CLI, Unix socket, token and persistence checks; no provider mocks. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@or3/secrets/client';
import { prepareSourceSecrets } from '../../shared/dev/secrets';

const repo = process.cwd();
const root = await realpath(await mkdtemp('/tmp/or3-source-secrets-'));
const cli = resolve('scripts/cli/secrets.ts');
const base = { PATH: process.env.PATH, HOME: process.env.HOME, SSR_AUTH_ENABLED: 'true', NODE_ENV: 'development' };
const passed: string[] = [];
const children: ChildProcess[] = [];
async function until(check: () => Promise<boolean>, label: string, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${label}`);
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill(signal);
    const force = setTimeout(() => child.kill('SIGKILL'), 35_000);
    try { await exited; } finally { clearTimeout(force); }
}
let owner: Awaited<ReturnType<typeof prepareSourceSecrets>> | undefined;
const setup = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) => spawnSync('bun', ['--no-env-file', cli, ...args], {
    cwd, encoding: 'utf8', timeout: 30_000, env: { ...base, ...env },
});
const hash = async () => createHash('sha256').update(await readFile(join(root, '.or3/secrets/master.key'))).digest('hex');
let exitCode = 1;
try {
    await symlink(resolve('node_modules'), join(root, 'node_modules'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const original = '# Preserve this comment\nUNRELATED=keep-me\nSSR_AUTH_ENABLED=true\nNUXT_SECRETS_NAMESPACE=or3\n';
    await writeFile(join(root, '.env'), original);
    await assert.rejects(prepareSourceSecrets(root, base), /Secrets setup required/);
    assert.equal(await readFile(join(root, '.env'), 'utf8'), original);
    passed.push('unattended missing configuration stops before launch without modifying .env');
    let transcript = '', answered = false;
    const interactive = Bun.spawn(['bun', '--no-env-file', cli], { cwd: root, env: base,
        terminal: { data(terminal, data) {
            transcript = (transcript + new TextDecoder().decode(data)).slice(-64 * 1024);
            if (!answered && transcript.includes('Choose 1, 2 or 3')) {
                answered = true;
                terminal.write('1\n');
            }
        } },
    });
    const timeout = setTimeout(() => interactive.kill('SIGKILL'), 30_000);
    try {
        assert.equal(await interactive.exited, 0, transcript);
        assert.equal(answered, true, transcript);
    } finally { clearTimeout(timeout); interactive.terminal?.close(); }
    passed.push('interactive terminal launch offers automatic setup, manual attachment and explicit opt-out');
    const configured: NodeJS.ProcessEnv = { ...base, ...parse(await readFile(join(root, '.env'))) };
    assert.equal(configured.NUXT_SECRETS_PROVIDER, 'or3-secrets');
    assert.match(await readFile(join(root, '.env'), 'utf8'), /# Preserve this comment\nUNRELATED=keep-me/);
    const initialHash = await hash();
    owner = await prepareSourceSecrets(root, configured);
    const client = createClient({ socketPath: configured.NUXT_SECRETS_SOCKET_PATH!, tokenFile: configured.NUXT_SECRETS_TOKEN_FILE!, vaultId: configured.NUXT_SECRETS_VAULT_ID!, serviceUid: Number(configured.NUXT_SECRETS_SERVICE_UID) });
    const scope = { namespace: 'or3', ownerUserId: 'fixture', workspaceId: 'fixture', consumerId: 'openrouter' };
    await client.put({ scope, name: 'fixture', value: 'synthetic-source-startup-fixture', expectedRevision: 0 });
    passed.push('automatic setup provisions a real vault and usable scoped service token');

    // A watched profile's automatic vault is separate, persists on restart,
    // and a previously configured checkout vault remains usable unchanged.
    const profile = join(root, 'plugin-profile');
    await mkdir(profile, { mode: 0o700 });
    const profileEnv = join(profile, '.env');
    await writeFile(profileEnv, '', { mode: 0o600 });
    let profileOwner = await prepareSourceSecrets(root, base, { mode: 'auto', envFile: profileEnv, custodyRoot: profile });
    const profileConfig: NodeJS.ProcessEnv = { ...base, ...parse(await readFile(profileEnv)) };
    const profileClient = createClient({ socketPath: profileConfig.NUXT_SECRETS_SOCKET_PATH!, tokenFile: profileConfig.NUXT_SECRETS_TOKEN_FILE!, vaultId: profileConfig.NUXT_SECRETS_VAULT_ID!, serviceUid: Number(profileConfig.NUXT_SECRETS_SERVICE_UID) });
    try {
        assert.equal(profileConfig.NUXT_SECRETS_TOKEN_FILE, join(profile, '.or3/secrets/service.token'));
        assert.notEqual(profileConfig.NUXT_SECRETS_SOCKET_PATH, configured.NUXT_SECRETS_SOCKET_PATH);
        await profileClient.put({ scope, name: 'fixture', value: 'synthetic-profile-secret', expectedRevision: 0 });
        await profileOwner.close();
        profileOwner = await prepareSourceSecrets(root, profileConfig, { envFile: profileEnv, custodyRoot: profile });
        assert.equal((await profileClient.resolve({ scope, selector: { name: 'fixture' } })).value, 'synthetic-profile-secret');
        assert.equal((await client.resolve({ scope, selector: { name: 'fixture' } })).value, 'synthetic-source-startup-fixture');
        assert.equal(await hash(), initialHash);
    } finally { await profileOwner.close(); }
    const legacy = await prepareSourceSecrets(root, configured, { custodyRoot: profile });
    try {
        assert.equal((await client.resolve({ scope, selector: { name: 'fixture' } })).value, 'synthetic-source-startup-fixture');
        assert.equal(await hash(), initialHash);
    } finally { await legacy.close(); }
    passed.push('plugin profiles own their vault across restart; existing checkout vault configuration and data remain usable');

    const manual = join(root, 'manual'); await mkdir(manual, { mode: 0o700 });
    await symlink(join(repo, 'node_modules'), join(manual, 'node_modules'));
    await writeFile(join(manual, 'package.json'), '{}');
    const attached = setup(manual, ['--manual'], configured);
    assert.equal(attached.status, 0, attached.stderr);
    const before = await readFile(join(manual, '.env'), 'utf8');
    const invalid = setup(manual, ['--manual'], { ...configured, NUXT_SECRETS_VAULT_ID: '0'.repeat(32) });
    assert.notEqual(invalid.status, 0);
    assert.equal(await readFile(join(manual, '.env'), 'utf8'), before);
    const wrongNamespace = setup(manual, ['--manual'], { ...configured, NUXT_SECRETS_NAMESPACE: 'other-namespace' });
    assert.notEqual(wrongNamespace.status, 0);
    assert.equal(await readFile(join(manual, '.env'), 'utf8'), before);
    passed.push('manual attach validates vault identity and namespace before persisting settings');

    await owner.close(); owner = undefined;
    owner = await prepareSourceSecrets(root, configured, { custodyRoot: profile });
    assert.equal((await client.resolve({ scope, selector: { name: 'fixture' } })).value, 'synthetic-source-startup-fixture');
    await owner.close(); owner = undefined;
    owner = await prepareSourceSecrets(root, configured);
    const persisted = await client.resolve({ scope, selector: { name: 'fixture' } });
    assert.equal(persisted.value, 'synthetic-source-startup-fixture');
    assert.equal(await hash(), initialHash);
    const again = setup(root, ['--auto']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(await hash(), initialHash);
    passed.push('restart and repeated setup preserve master key, vault identity and saved credentials');
    await owner.close(); owner = undefined;

    // Failure model: SIGKILL leaves a socket; racing starters must not unlink a
    // successor or rotate its token twice; reachable/unsafe endpoints must survive.
    // These process-boundary checks extend the existing custody/persistence owner.
    const worker = join(root, 'worker.ts');
    await writeFile(worker, `
        import { prepareSourceSecrets } from ${JSON.stringify(resolve('shared/dev/secrets.ts'))};
        import { readFile } from 'node:fs/promises';
        import { parse } from ${JSON.stringify(resolve('node_modules/dotenv/lib/main.js'))};
        const owner = await prepareSourceSecrets(process.cwd(), { ...process.env, ...parse(await readFile('.env')) });
        console.log('FIXTURE_READY');
        process.stdin.once('data', async () => { await Promise.all([owner.close(), owner.close()]); process.exit(0); });
        process.stdin.resume();
    `);
    const launch = () => {
        const child = spawn('bun', ['--no-env-file', worker], { cwd: root, env: base, stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(child);
        let output = '';
        child.stdout!.on('data', chunk => { output += chunk; });
        child.stderr!.on('data', chunk => { output += chunk; });
        return { child, output: () => output, ready: () => until(async () => {
            assert.equal(child.exitCode, null, output);
            return output.includes('FIXTURE_READY');
        }, 'vault worker readiness') };
    };
    const socket = configured.NUXT_SECRETS_SOCKET_PATH!;
    const custody = join(root, '.or3/secrets');
    const vaultCli = resolve('node_modules/@or3/secrets/dist/cli.js');
    const crashed = spawn('bun', ['--no-env-file', vaultCli, 'serve', '--vault-dir', join(custody, 'vault'),
        '--key-file', join(custody, 'master.key'), '--socket', socket], { env: base, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(crashed);
    let crashOutput = '';
    crashed.stdout!.on('data', chunk => { crashOutput += chunk; });
    await until(async () => crashOutput.includes('"ready":true'), 'disposable vault readiness');
    await stop(crashed, 'SIGKILL');
    assert.equal((await lstat(socket)).isSocket(), true);
    const starters = [launch(), launch()];
    await Promise.all(starters.map(start => start.ready()));
    assert.equal(starters.filter(start => start.output().includes('Local development vault ready.')).length, 1);
    const owning = starters.find(start => start.output().includes('Local development vault ready.'))!;
    const attachedWorker = starters.find(start => start !== owning)!;
    assert.equal((await client.resolve({ scope, selector: { name: 'fixture' } })).value, 'synthetic-source-startup-fixture');
    assert.equal(await hash(), initialHash);
    const identity = await lstat(socket);
    attachedWorker.child.stdin!.write('close\n');
    await until(async () => attachedWorker.child.exitCode !== null, 'attached launcher exit');
    assert.equal((await lstat(socket)).ino, identity.ino);
    await client.status();
    owning.child.stdin!.write('close\n');
    await until(async () => owning.child.exitCode !== null, 'owning launcher exit');
    await assert.rejects(lstat(socket), { code: 'ENOENT' });
    assert.equal(await hash(), initialHash);
    passed.push('SIGKILL stale-socket recovery and simultaneous launchers preserve credentials/key, share one vault, and await cleanup');

    const live = createServer(connection => connection.end());
    await new Promise<void>(resolve => live.listen(socket, resolve));
    await chmod(socket, 0o600);
    const liveIdentity = await lstat(socket);
    try {
        await assert.rejects(prepareSourceSecrets(root, configured), /reachable|listening/i);
        assert.equal((await lstat(socket)).ino, liveIdentity.ino);
    } finally { await new Promise<void>(resolve => live.close(() => resolve())); }
    const sentinel = join(root, 'preserve-me');
    await writeFile(sentinel, 'preserve');
    await symlink(sentinel, socket);
    await assert.rejects(prepareSourceSecrets(root, configured), /unsafe/i);
    assert.equal((await lstat(socket)).isSymbolicLink(), true);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
    await rm(socket);
    passed.push('reachable unauthenticated socket and symlink are refused without replacement');

    // Exercise the real dev launcher/supervisor with minimal Nuxt, not a fake
    // lifecycle. Only the app is disposable; published vault and CLI are real.
    await mkdir(join(root, 'shared/dev'), { recursive: true });
    await writeFile(join(root, 'shared/dev/nuxt-child.mjs'), await readFile(join(repo, 'shared/dev/nuxt-child.mjs')));
    await writeFile(join(root, 'nuxt.config.ts'), `export default { workspaceDir: ${JSON.stringify(root)}, srcDir: 'app', devtools: { enabled: false }, ignore: ['**/.or3/**', '**/shared/**', '**/manual/**', '**/worker.ts'], watchers: { chokidar: { usePolling: true } } };`);
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app/app.vue'), '<template><main>Lifecycle fixture</main></template>');
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    // A signal while the real setup prompt is waiting must cancel the question,
    // without persisting a choice or replacing existing custody.
    const promptEnv = join(root, '.env-interrupt');
    const promptConfiguration = 'SSR_AUTH_ENABLED=false\nNUXT_SECRETS_PROVIDER=or3-secrets\n';
    await writeFile(promptEnv, promptConfiguration);
    owner = await prepareSourceSecrets(root, configured);
    let promptLog = '';
    const prompting = Bun.spawn(['node', '--import', 'tsx', resolve('scripts/cli/dev.ts'), '--dotenv', promptEnv,
        '--host=127.0.0.1', '--port', String(port)], { cwd: root,
        env: { ...base, SSR_AUTH_ENABLED: 'false', OR3_SYNC_ENABLED: 'false', OR3_STORAGE_ENABLED: 'false', OR3_LOCAL_PROVIDERS: 'false' },
        terminal: { data(_terminal, data) { promptLog = (promptLog + new TextDecoder().decode(data)).slice(-64 * 1024); } },
    });
    try {
        await until(async () => {
            assert.equal(prompting.exitCode, null, promptLog);
            return promptLog.includes('Choose 1, 2 or 3');
        }, 'interactive dev setup prompt');
        const promptAttachment = await prepareSourceSecrets(root, configured, { signal: AbortSignal.timeout(2_000) });
        await promptAttachment.close();
        await client.status();
        await owner.close(); owner = undefined;
        prompting.kill('SIGTERM');
        await until(async () => prompting.exitCode !== null, 'interrupted setup prompt exits', 5_000);
        assert.equal(await prompting.exited, 0, promptLog);
        assert.equal(await readFile(promptEnv, 'utf8'), promptConfiguration);
        assert.equal(await hash(), initialHash);
        passed.push('setup prompts do not block another launcher or vault shutdown; interruption exits without changing configuration/custody');
    } finally {
        if (prompting.exitCode === null) prompting.kill('SIGKILL');
        await prompting.exited;
        prompting.terminal?.close();
    }
    for (const [signal, duringStartup] of [['SIGTERM', false], ['SIGINT', false], ['SIGTERM', true]] as const) {
        const dev = spawn('node', ['--import', 'tsx', resolve('scripts/cli/dev.ts'), '--host=127.0.0.1', '--port', String(port)], {
            cwd: root, env: { ...base, SSR_AUTH_ENABLED: 'false', OR3_SYNC_ENABLED: 'false', OR3_STORAGE_ENABLED: 'false', OR3_LOCAL_PROVIDERS: 'false', CHOKIDAR_USEPOLLING: 'true' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(dev);
        let log = '';
        dev.stdout!.on('data', chunk => { log += chunk; });
        dev.stderr!.on('data', chunk => { log += chunk; });
        await until(async () => {
            assert.equal(dev.exitCode, null, log);
            if (duringStartup) return log.includes('Local development vault ready.');
            return fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false);
        }, 'minimal Nuxt readiness', 60_000).catch(error => { throw new Error(log, { cause: error }); });
        if (!duringStartup) await client.status();
        dev.kill(signal);
        // Deliver a separate interrupt rather than relying on coalesced signals.
        await new Promise(resolve => setTimeout(resolve, 25));
        if (dev.exitCode === null && dev.signalCode === null) dev.kill(signal);
        await until(async () => dev.exitCode !== null || dev.signalCode !== null, 'dev shutdown', 35_000);
        assert.equal(dev.signalCode, null, log);
        assert.equal(dev.exitCode, 0, log);
        await assert.rejects(lstat(socket), { code: 'ENOENT' });
        assert.equal(await hash(), initialHash);
        passed.push(`${signal} dev shutdown ${duringStartup ? 'during startup' : 'after readiness'} awaits Nuxt and vault cleanup; restart retains custody`);
    }

    const partial = join(root, 'partial'); await mkdir(join(partial, '.or3/secrets'), { recursive: true, mode: 0o700 });
    await symlink(join(repo, 'node_modules'), join(partial, 'node_modules'));
    await writeFile(join(partial, 'package.json'), '{}');
    await writeFile(join(partial, '.or3/secrets/master.key'), 'DO NOT REPLACE', { mode: 0o600 });
    const refused = setup(partial, ['--auto']);
    assert.notEqual(refused.status, 0);
    assert.equal(await readFile(join(partial, '.or3/secrets/master.key'), 'utf8'), 'DO NOT REPLACE');
    passed.push('incomplete custody refuses regeneration and preserves existing files');
    const disabled = setup(partial, ['--disable']);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.equal(parse(await readFile(join(partial, '.env'))).NUXT_SECRETS_PROVIDER, '');
    await prepareSourceSecrets(partial, { ...base, NUXT_SECRETS_PROVIDER: '' });
    passed.push('explicit instance-billing opt-out remains available without touching custody');
    exitCode = 0;
} finally {
    for (const child of children) {
        if (child.exitCode === null && child.signalCode === null && child.stdin?.writable) {
            child.stdin.write('close\n');
            await until(async () => child.exitCode !== null || child.signalCode !== null, 'worker cleanup', 5_000).catch(() => stop(child));
        } else await stop(child);
    }
    await owner?.close();
    await rm(root, { recursive: true, force: true });
    await mkdir('test-results/source-secrets', { recursive: true });
    await writeFile('test-results/source-secrets/receipt.json', JSON.stringify({
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        command: 'bun scripts/test/run-source-secrets-e2e.ts', exitCode, passed, syntheticFixturesRemoved: true,
    }, null, 2));
}
console.log(`Source secrets lifecycle: ${passed.length} checks passed.`);
process.exitCode = exitCode;
