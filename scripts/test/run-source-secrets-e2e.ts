/** Real published CLI, Unix socket, token and persistence checks; no provider mocks. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@or3/secrets/client';
import { prepareSourceSecrets } from '../../shared/dev/secrets';

const repo = process.cwd();
const root = await realpath(await mkdtemp('/tmp/or3-source-secrets-'));
const cli = resolve('scripts/cli/secrets.ts');
const base = { PATH: process.env.PATH, HOME: process.env.HOME, SSR_AUTH_ENABLED: 'true', NODE_ENV: 'development' };
const passed: string[] = [];
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
    owner = await prepareSourceSecrets(root, configured);
    const persisted = await client.resolve({ scope, selector: { name: 'fixture' } });
    assert.equal(persisted.value, 'synthetic-source-startup-fixture');
    assert.equal(await hash(), initialHash);
    const again = setup(root, ['--auto']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(await hash(), initialHash);
    passed.push('restart and repeated setup preserve master key, vault identity and saved credentials');
    await owner.close(); owner = undefined;

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
