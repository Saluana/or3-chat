// Managed single-host custody. This supervisor is confined to the vault container.
// Only it has the key/database volumes; Bun service commands run as UID 1000.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { createReadStream, lstatSync, readdirSync, readFileSync, writeFileSync, chmodSync, chownSync, openSync, closeSync, fsyncSync, fchownSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

process.umask(0o077);
const uid = 1000, appUid = 65532, gid = 65532;
const data = '/vault-data', custody = '/vault-key', client = '/run/or3-secrets-client', run = '/run/or3-secrets';
const vault = `${data}/live`, key = `${custody}/master.key`, operator = `${custody}/operator.token`, socket = `${run}/api.sock`;
const namespace = process.env.OR3_VAULT_NAMESPACE || 'or3';
const fail = () => { throw new Error('Vault lifecycle refused. Preserve existing custody; inspect private vault logs and recovery documentation.'); };
const args = command => ['--no-env-file', '/app/vault/cli.js', ...command];
function cli(command) {
    const result = spawnSync('/usr/local/bin/bun', args(command), { uid, gid, encoding: 'utf8', timeout: 120000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) fail();
    return JSON.parse(result.stdout);
}
function sync(path) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function directory(path, owner, mode) {
    const st = lstatSync(path);
    if (!st.isDirectory() || st.isSymbolicLink()) fail();
    if (st.uid === 0 && readdirSync(path).length === 0) { chownSync(path, owner, gid); chmodSync(path, mode); sync(path); }
    else if (st.uid !== owner || (st.mode & 0o777) !== mode) fail();
}
function privateFile(path, owner) {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== owner || (st.mode & 0o777) !== 0o600 || st.nlink !== 1) fail();
}
function atomicClientFile(name, contents) {
    const temp = `${client}/.${name}-${randomUUID()}`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, contents); fchownSync(fd, appUid, gid); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, `${client}/${name}`); sync(client);
}

if (process.argv[2] === 'health') {
    try {
        if (!existsSync('/tmp/or3-vault-ready') || !lstatSync(socket).isSocket()) fail();
        const meta = JSON.parse(readFileSync(`${client}/config.json`, 'utf8'));
        if (typeof meta.expiresAt !== 'number' || !Number.isFinite(meta.expiresAt) || meta.expiresAt <= Date.now() + 60000) fail();
    } catch { process.exit(1); }
} else if (process.argv[2] === 'backup') {
    // The Cloud updater first stops app and vault. Only encrypted output crosses stdout.
    const output = `${data}/snapshot-${randomUUID()}.backup`;
    cli(['backup', '--vault-dir', vault, '--key-file', key, '--out-file', output]);
    await pipeline(createReadStream(output), process.stdout);
    unlinkSync(output); sync(data);
} else {
    let service;
    let renewal;
    try {
        if (process.getuid() !== 0) fail();
        process.setgroups([]);
        directory(data, uid, 0o700); directory(custody, uid, 0o700);
        directory(client, appUid, 0o700); directory(run, uid, 0o750);
        if (!existsSync(vault)) {
            if (readdirSync(data).length || readdirSync(custody).length || readdirSync(client).length) fail();
            cli(['init', '--vault-dir', vault, '--key-file', key, '--operator-file', operator]);
        }
        privateFile(key, uid); privateFile(operator, uid); privateFile(`${vault}/complete`, uid);
        const vaultId = readFileSync(`${vault}/complete`, 'utf8').trim();
        if (!/^[a-f0-9]{32}$/.test(vaultId)) fail();
        // A container crash can leave a socket. Refuse a live listener; remove only
        // the unchanged service-owned dead inode after an actual ECONNREFUSED.
        if (existsSync(socket)) {
            const before = lstatSync(socket);
            if (!before.isSocket() || before.uid !== uid) fail();
            const dead = await new Promise(resolve => {
                const connection = createConnection(socket);
                connection.once('connect', () => { connection.destroy(); resolve(false); });
                connection.once('error', error => resolve(error.code === 'ECONNREFUSED'));
                connection.setTimeout(2000, () => { connection.destroy(); resolve(false); });
            });
            const after = lstatSync(socket);
            if (!dead || before.ino !== after.ino || before.dev !== after.dev) fail();
            unlinkSync(socket); sync(run);
        }
        service = spawn('/usr/local/bin/bun', args(['serve', '--vault-dir', vault, '--key-file', key, '--socket', socket, '--socket-group', String(gid)]), { uid, gid, stdio: ['ignore', 'pipe', 'inherit'] });
        const exited = new Promise(resolve => { service.once('exit', (code, signal) => resolve({ code, signal })); service.once('error', () => resolve({ code: 1 })); });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Vault startup deadline')), 15000);
            let text = '';
            service.stdout.on('data', bytes => {
                text += bytes.toString();
                if (text.length > 1024) { clearTimeout(timeout); reject(new Error('Invalid readiness')); }
                if (text.includes('\n')) {
                    clearTimeout(timeout);
                    try { const result = JSON.parse(text.trim()); result.ready && result.vaultId === vaultId ? resolve() : reject(new Error('Wrong vault')); } catch { reject(new Error('Invalid readiness')); }
                }
            });
            exited.then(() => { clearTimeout(timeout); reject(new Error('Vault exited before readiness')); });
        });
        const operatorArgs = ['--socket', socket, '--vault-id', vaultId, '--service-uid', String(uid), '--token-file', operator];
        const renew = () => {
            let previous;
            if (existsSync(`${client}/config.json`)) { privateFile(`${client}/config.json`, appUid); previous = JSON.parse(readFileSync(`${client}/config.json`, 'utf8')); if (previous.vaultId !== vaultId) fail(); }
            const output = `${custody}/service-${randomUUID()}.token`;
            const result = cli(['token', 'issue', ...operatorArgs, '--kind', 'service', '--namespace', namespace, '--capabilities', 'metadata,read,write,delete', '--expires-in', '7d', '--out-file', output]);
            privateFile(output, uid);
            atomicClientFile('service.token', readFileSync(output));
            atomicClientFile('config.json', JSON.stringify({ vaultId, namespace, tokenId: result.id, expiresAt: result.expiresAt }));
            unlinkSync(output); sync(custody);
            if (previous?.tokenId) cli(['token', 'revoke', ...operatorArgs, '--id', previous.tokenId]);
        };
        renew();
        writeFileSync('/tmp/or3-vault-ready', 'ready', { mode: 0o600 });
        renewal = setInterval(() => { try { renew(); } catch { process.stderr.write('Vault token renewal failed; stopping admission.\n'); service.kill('SIGTERM'); process.exitCode = 1; } }, 24 * 60 * 60 * 1000);
        for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(renewal); service.kill(signal); });
        const result = await exited;
        clearInterval(renewal);
        if (result.code !== 0) process.exitCode = 1;
    } catch {
        clearInterval(renewal); service?.kill('SIGTERM');
        process.stderr.write('Vault lifecycle refused; preserve volumes and inspect configuration/custody.\n');
        process.exitCode = 1;
    }
}
