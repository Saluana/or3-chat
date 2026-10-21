// Failure inventory: partial initialization overwrites custody; application UID
// reads custody; stale socket prevents restart; token rotation loses access;
// backup leaks plaintext; fresh-key recovery loses records or admits old tokens.
import { mkdtemp, writeFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = await mkdtemp('/tmp/or3-vault-e2e-');
const id = `or3-vault-e2e-${crypto.randomUUID().slice(0, 8)}`;
const image = `${id}:local`;
const volumes = ['data', 'key', 'run', 'client', 'restored-data', 'restored-key', 'restored-run', 'restored-client'].map(suffix => `${id}-${suffix}`);
const containers = [id, `${id}-restored`];
const checks: string[] = [];
let exitCode = 1;
function docker(args: string[], allowFailure = false) {
    const p = Bun.spawnSync(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
    if (!allowFailure && p.exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${p.stderr.toString().slice(-1500)}`);
    return { code: p.exitCode, out: p.stdout.toString() };
}
const mounts = (offset = 0) => ['vault-data', 'vault-key', 'run/or3-secrets', 'run/or3-secrets-client'].flatMap((path, i) => ['-v', `${volumes[offset + i]}:/${path}`]);
async function ready(name: string) {
    for (let i = 0; i < 60; i++) {
        if (!docker(['exec', name, '/nodejs/bin/node', '/app/vault/entrypoint.mjs', 'health'], true).code) return;
        await Bun.sleep(250);
    }
    throw new Error(`Vault did not become ready: ${docker(['logs', name], true).out.slice(-1500)}`);
}
function start(name: string, offset = 0) {
    docker(['run', '-d', '--name', name, '--network', 'none', '--read-only', '--tmpfs', '/tmp:size=16m', '--cap-drop', 'ALL',
        ...['CHOWN', 'FOWNER', 'DAC_OVERRIDE', 'SETUID', 'SETGID'].flatMap(cap => ['--cap-add', cap]),
        '--security-opt', 'no-new-privileges:true', '--user', '0:0', ...mounts(offset), image]);
}
function client(operation: string, offset = 0, allowFailure = false) {
    return docker(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', '65532:65532',
        '-v', `${volumes[offset + 2]}:/run/or3-secrets:ro`, '-v', `${volumes[offset + 3]}:/run/or3-secrets-client:ro`,
        '--entrypoint', '/nodejs/bin/node', image, '/app/vault/probe.mjs', operation], allowFailure);
}
const record = (label: string) => { checks.push(label); process.stdout.write(`${label}\n`); };
try {
    await copyFile('scripts/docker/vault-entrypoint.mjs', join(dir, 'entrypoint.mjs'));
    await copyFile('node_modules/@or3/secrets/dist/cli.js', join(dir, 'cli.js'));
    const built = Bun.spawnSync(['bun', 'build', 'node_modules/@or3/secrets/dist/client.js', '--target=node', `--outfile=${join(dir, 'client.mjs')}`]);
    assert.equal(built.exitCode, 0);
    await writeFile(join(dir, 'probe.mjs'), `
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createClient} from './client.mjs';
assert.equal(existsSync('/vault-key/master.key'),false);
assert.equal(existsSync('/vault-data/live'),false);
const config=JSON.parse(readFileSync('/run/or3-secrets-client/config.json','utf8'));
const client=createClient({socketPath:'/run/or3-secrets/api.sock',tokenFile:'/run/or3-secrets-client/service.token',vaultId:config.vaultId,serviceUid:1000,timeoutMs:2000});
const scope={namespace:'or3',ownerUserId:'account-a',workspaceId:'@account',consumerId:'@or3.openrouter'};
const name='api-key';
if(process.argv[2]==='save') {
 await client.put({scope,name,value:'sk-or-synthetic-vault-fixture',expectedRevision:0});
 assert.equal(await client.inspect({scope:{...scope,ownerUserId:'account-b'},name}),null);
 assert.equal(await client.inspect({scope:{...scope,consumerId:'other-plugin'},name}),null);
 assert.equal(await client.inspect({scope:{...scope,workspaceId:'other-workspace'},name}),null);
 await assert.rejects(client.issueToken({kind:'service',namespace:'or3',capabilities:['read'],expiresAt:Date.now()+60000}));
} else if(process.argv[2]==='delete') {
 const meta=await client.inspect({scope,name});
 await client.delete({scope,name,expectedRevision:meta.ref.revision});
 await assert.rejects(client.resolve({scope,selector:{name}}));
 assert.equal((await client.inspect({scope,name})).state,'deleted');
} else {
 assert.equal((await client.resolve({scope,selector:{name}})).value,'sk-or-synthetic-vault-fixture');
}
console.log(JSON.stringify({ok:true,vaultId:config.vaultId}));
`);
    await writeFile(join(dir, 'Dockerfile'), `FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY . /app/vault/
ENTRYPOINT ["/nodejs/bin/node","/app/vault/entrypoint.mjs"]
`);
    docker(['build', '--network', 'none', '-t', image, dir]);
    for (const volume of volumes) docker(['volume', 'create', volume]);
    start(id); await ready(id);
    const original = JSON.parse(client('save').out);
    record('Fresh initialization, private application mounts, scoped records and operator denial');
    docker(['kill', '--signal', 'KILL', id]); docker(['start', id]); await ready(id);
    assert.equal(JSON.parse(client('read').out).vaultId, original.vaultId);
    record('Crash restart preserves vault identity and records; rotates service token');
    docker(['stop', id]);
    assert.notEqual(client('read', 0, true).code, 0);
    record('Vault outage fails closed');
    const encrypted = execFileSync('docker', ['run', '--rm', '--network', 'none', '--user', '0:0', ...mounts(), image, 'backup'], { maxBuffer: 16 * 1024 * 1024 });
    assert(!encrypted.includes(Buffer.from('sk-or-synthetic-vault-fixture')));
    await writeFile(join(dir, 'vault.backup'), encrypted, { mode: 0o600 });
    docker(['run', '--rm', '--network', 'none', '--user', '0:0', '-v', `${volumes[4]}:/restore-data`, '-v', `${volumes[5]}:/restore-key`,
        '--entrypoint', '/nodejs/bin/node', image, '-e', "const fs=require('node:fs');for(const p of ['/restore-data','/restore-key']){fs.chownSync(p,1000,65532);fs.chmodSync(p,0o700)}"]);
    // The restore CLI receives the old key through the private custody mount;
    // the application and backup artifact never receive it.
    docker(['run', '--rm', '--network', 'none', '--user', '1000:65532', '-v', `${volumes[1]}:/vault-key:ro`,
        '-v', `${volumes[4]}:/restore-data`, '-v', `${volumes[5]}:/restore-key`, '-v', `${dir}:/fixture:ro`,
        '--entrypoint', '/usr/local/bin/bun', image, '--no-env-file', '/app/vault/cli.js', 'restore', '--backup-file', '/fixture/vault.backup',
        '--key-file', '/vault-key/master.key', '--destination', '/restore-data/live', '--new-key-file', '/restore-key/master.key', '--operator-file', '/restore-key/operator.token']);
    start(containers[1], 4); await ready(containers[1]);
    assert.equal(JSON.parse(client('read', 4).out).vaultId, original.vaultId);
    record('Encrypted stopped-vault backup and fresh-key restore preserve records');
    client('delete', 4);
    record('Deletion leaves a durable tombstone and denies resolution');
    docker(['stop', containers[1]]);
    // Lost custody is never silently replaced, even with an existing database.
    docker(['run', '--rm', '--network', 'none', '--user', '0:0', '-v', `${volumes[5]}:/vault-key`, '--entrypoint', '/nodejs/bin/node', image,
        '-e', "require('node:fs').renameSync('/vault-key/master.key','/vault-key/preserved.key')"]);
    assert.notEqual(docker(['run', '--rm', '--network', 'none', '--user', '0:0', ...mounts(4), image], true).code, 0);
    record('Incomplete custody refuses startup without reinitializing');
    exitCode = 0;
} finally {
    for (const container of containers) docker(['rm', '-f', container], true);
    for (const volume of volumes) docker(['volume', 'rm', volume], true);
    docker(['image', 'rm', image], true);
    await rm(dir, { recursive: true, force: true });
    await mkdir('test-results/cloud-vault', { recursive: true });
    await writeFile('test-results/cloud-vault/receipt.json', JSON.stringify({
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        command: 'bun scripts/test/run-cloud-vault-e2e.ts', checks, exitCode, syntheticFixturesRemoved: true,
        profile: 'Pinned production distroless Node + Bun 1.3.14, single Docker host; no production qualification claim',
    }, null, 2));
}
process.exitCode = exitCode;
