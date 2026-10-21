// Real published baseline -> candidate assets -> backup -> rollback. Synthetic
// candidate version exists only in temporary fixtures; no version is published.
import { mkdtemp, realpath, readFile, writeFile, cp, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { parseEnv } from '../../packages/or3-cloud/src/deployment/env';

const root = process.cwd();
const dir = await realpath(await mkdtemp('/tmp/or3-vault-lifecycle-'));
const id = `or3-vault-lifecycle-${crypto.randomUUID().slice(0, 8)}`;
const deployment = join(dir, `${id}-upgrade`);
const fresh = join(dir, `${id}-fresh`);
const image = `${id}:local`;
const checks: string[] = [];
let exitCode = 1;
let env: Record<string, string> | undefined;
async function run(command: string[], cwd = dir, extra: Record<string, string> = {}) {
    const p = Bun.spawn(command, { cwd, env: { ...process.env, ...extra }, stdout: 'pipe', stderr: 'pipe' });
    const [out, errors, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code) throw new Error(`${command[0]} ${command[1]} failed: ${errors.slice(-4500)} ${out.slice(-1500)}`);
    return out;
}
const record = (label: string) => { checks.push(label); console.log(label); };
try {
    await run(['npm', 'pack', '@or3/cloud@0.1.90', '--pack-destination', dir]);
    await run(['tar', '-xzf', join(dir, 'or3-cloud-0.1.90.tgz')]);
    const candidate = join(dir, 'candidate');
    await cp(join(root, 'packages/or3-cloud'), candidate, { recursive: true, filter: source => !source.includes('/node_modules') });
    const packagePath = join(candidate, 'package.json');
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')); manifest.version = '0.1.91'; await writeFile(packagePath, JSON.stringify(manifest));
    const infoPath = join(candidate, 'src/package-info.ts');
    await writeFile(infoPath, (await readFile(infoPath, 'utf8')).replace("PACKAGE_VERSION = '0.1.90'", "PACKAGE_VERSION = '0.1.91'"));
    for (const relative of ['src/commands/recover-restart.ts', 'src/deployment/lease.ts']) {
        const path = join(candidate, relative);
        await writeFile(path, (await readFile(path, 'utf8')).replace("'../../../../shared/server/restarts/controller'", JSON.stringify(join(root, 'shared/server/restarts/controller.ts'))));
    }
    await run(['bun', 'build', 'src/cli.ts', '--target=node', '--format=esm', '--outfile=dist/cli.mjs'], candidate);
    await writeFile(join(dir, 'Dockerfile'), `FROM or3-cloud-credentials-qualification:local\nLABEL org.opencontainers.image.source="https://github.com/Saluana/or3-chat" org.opencontainers.image.version="0.1.91" org.opencontainers.image.revision="${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}"\n`);
    await run(['docker', 'build', '--network', 'none', '-t', image, dir]);
    const baselineCli = join(dir, 'package/dist/cli.mjs');
    const candidateCli = join(candidate, 'dist/cli.mjs');
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe') });
    const port = probe.port!; await probe.stop(true);
    await writeFile(join(dir, 'password'), 'DisposableLifecycleSuite!123', { mode: 0o600 });
    await run(['node', baselineCli, 'init', deployment, '--local', '--admin-email', 'lifecycle@example.test', '--admin-password-file', join(dir, 'password'), '--port', String(port)], dir,
        { OR3_CLOUD_SKIP_PULL: 'true' });
    env = parseEnv(await readFile(join(deployment, '.env'), 'utf8'));
    record('Published 0.1.90 installation and deep health');
    const cli = (args: string[]) => run(['node', candidateCli, ...args], deployment, { OR3_CLOUD_SKIP_PULL: 'true', OR3_CLOUD_TEST_IMAGE: image });
    await cli(['update', '--to', '0.1.91']);
    record('Managed update provisions the default vault from an existing installation');
    const origin = `http://127.0.0.1:${port}`;
    const credentials = parseEnv(await readFile(join(deployment, '.or3-initial-credentials'), 'utf8'));
    const signedIn = await fetch(`${origin}/api/basic-auth/sign-in`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
        body: JSON.stringify({ email: 'lifecycle@example.test', password: credentials.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD }) });
    assert(signedIn.ok);
    const cookie = signedIn.headers.getSetCookie().map(line => line.split(';')[0]).join('; ');
    const session = await (await fetch(`${origin}/api/auth/session`, { headers: { cookie } })).json();
    const account = JSON.stringify([session.session.provider, session.session.user.id]);
    const connection = async (operation: string) => {
        const response = await fetch(`${origin}/api/openrouter/credentials`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', 'x-or3-account': account },
            body: JSON.stringify({ operation, ...(operation === 'save' ? { key: 'sk-or-synthetic-lifecycle-fixture' } : {}) }) });
        assert(response.ok, `Connection operation ${operation}: ${response.status}`);
        return response.json();
    };
    assert.deepEqual(await connection('save'), { connected: true, persisted: true });
    const compose = ['docker', 'compose', '--profile', 'or3-vault', '--project-name', env.OR3_COMPOSE_PROJECT,
        '--project-directory', deployment, '--env-file', join(deployment, '.env'), '-f', join(deployment, 'compose.yaml')];
    await run([...compose, 'stop', 'or3-vault']);
    const outage = await fetch(`${origin}/api/openrouter/credentials`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', 'x-or3-account': account }, body: JSON.stringify({ operation: 'status' }) });
    assert.equal(outage.status, 503);
    assert.equal((await (await fetch(`${origin}/api/health?deep=true`)).json()).status, 'degraded');
    await run([...compose, 'up', '-d', '--wait', 'or3-vault']);
    assert.deepEqual(await connection('status'), { connected: true, persisted: true });
    record('Application credential operations fail closed during vault outage and recover after restart');
    await cli(['backup']);
    const backupRoot = join(deployment, '.or3-cloud/backups');
    const manifests = await Promise.all((await readdir(backupRoot)).map(async name => {
        const path = join(backupRoot, name); return { path, manifest: JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) };
    }));
    const snapshot = manifests.find(item => item.manifest.vaultSha256);
    assert(snapshot);
    const encrypted = await readFile(join(snapshot.path, 'vault.backup'));
    assert.equal(createHash('sha256').update(encrypted).digest('hex'), snapshot.manifest.vaultSha256);
    assert(!encrypted.includes(Buffer.from('sk-or-synthetic-lifecycle-fixture')));
    assert.deepEqual(await connection('status'), { connected: true, persisted: true });
    await cli(['restart']);
    assert.deepEqual(await connection('status'), { connected: true, persisted: true });
    record('Managed encrypted backup checksum, restart and credential persistence');
    await cli(['rollback', '--yes']);
    const health = await fetch(`${origin}/api/health?deep=true`); assert(health.ok); assert.equal((await health.json()).status, 'ok');
    // Rollback leaves vault custody volumes intact even when the older app has
    // no credential endpoint. No source vault is replayed or destroyed.
    for (const suffix of ['data', 'key', 'run', 'client']) await run(['docker', 'volume', 'inspect', `${env.OR3_VOLUME_NAME}-vault-${suffix}`]);
    record('Managed rollback returns to published image and preserves vault custody');
    const freshProbe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe') });
    const freshPort = freshProbe.port!; await freshProbe.stop(true);
    await run(['node', candidateCli, 'init', fresh, '--local', '--admin-email', 'fresh@example.test', '--admin-password-file', join(dir, 'password'), '--port', String(freshPort)], dir,
        { OR3_CLOUD_SKIP_PULL: 'true', OR3_CLOUD_TEST_IMAGE: image });
    const freshHealth = await fetch(`http://127.0.0.1:${freshPort}/api/health?deep=true`);
    assert.equal((await freshHealth.json()).providers.secrets.available, true);
    record('Fresh managed Cloud installation waits for initialized vault readiness');
    const freshEnvPath = join(fresh, '.env');
    const freshEnv = await readFile(freshEnvPath, 'utf8');
    // Compose restart retains container configuration; stop/start applies it.
    await run(['node', candidateCli, 'stop'], fresh, { OR3_CLOUD_SKIP_PULL: 'true', OR3_CLOUD_TEST_IMAGE: image });
    await writeFile(freshEnvPath, `${freshEnv}\nNUXT_SECRETS_PROVIDER=\n`, { mode: 0o600 });
    await run(['node', candidateCli, 'start'], fresh, { OR3_CLOUD_SKIP_PULL: 'true', OR3_CLOUD_TEST_IMAGE: image });
    const freshOrigin = `http://127.0.0.1:${freshPort}`;
    const freshCredentials = parseEnv(await readFile(join(fresh, '.or3-initial-credentials'), 'utf8'));
    const freshSession = await fetch(`${freshOrigin}/api/basic-auth/sign-in`, { method: 'POST', headers: { origin: freshOrigin, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation' },
        body: JSON.stringify({ email: 'fresh@example.test', password: freshCredentials.OR3_BASIC_AUTH_BOOTSTRAP_PASSWORD }) });
    assert(freshSession.ok);
    const freshCookie = freshSession.headers.getSetCookie().map(line => line.split(';')[0]).join('; ');
    const freshAccount = await (await fetch(`${freshOrigin}/api/auth/session`, { headers: { cookie: freshCookie } })).json();
    const disabled = await fetch(`${freshOrigin}/api/openrouter/credentials`, { method: 'POST', headers: { origin: freshOrigin, cookie: freshCookie, 'content-type': 'application/json', 'x-or3-cloud-intent': 'mutation', 'x-or3-account': JSON.stringify([freshAccount.session.provider, freshAccount.session.user.id]) }, body: JSON.stringify({ operation: 'save', key: 'sk-or-synthetic-disabled-fixture' }) });
    assert.equal(disabled.status, 503);
    record('Explicitly disabled vault refuses account credential persistence without browser downgrade');
    exitCode = 0;
} finally {
    let resourcesRemoved = true;
    for (const target of [deployment, fresh]) {
        const selected = await readFile(join(target, '.env'), 'utf8').then(parseEnv).catch(() => undefined);
        if (!selected) continue;
        const compose = ['docker', 'compose', '--project-name', selected.OR3_COMPOSE_PROJECT, '--project-directory', target, '--env-file', join(target, '.env'), '-f', join(target, 'compose.yaml')];
        // Only resources belonging to these uniquely named disposable deployments.
        await run([...compose, '--profile', 'or3-vault', 'down', '--remove-orphans']).catch(() => { resourcesRemoved = false; });
        for (const suffix of ['', '-vault-data', '-vault-key', '-vault-run', '-vault-client']) await run(['docker', 'volume', 'rm', `${selected.OR3_VOLUME_NAME}${suffix}`]).catch(() => { resourcesRemoved = false; });
    }
    await run(['docker', 'image', 'rm', image]).catch(() => { resourcesRemoved = false; });
    if (!resourcesRemoved) exitCode = 1;
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(root, 'test-results/cloud-vault-lifecycle'), { recursive: true });
    await writeFile(join(root, 'test-results/cloud-vault-lifecycle/receipt.json'), JSON.stringify({
        baseline: '@or3/cloud@0.1.90 + published ghcr.io/saluana/or3-chat:0.1.90', candidate: 'temporary local 0.1.91 fixture, unpublished',
        checks, exitCode, command: 'bun scripts/test/run-cloud-vault-lifecycle-e2e.ts', fixtureDirectoryRemoved: true, resourcesRemoved,
    }, null, 2));
}
process.exitCode = exitCode;
