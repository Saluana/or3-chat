import { mkdtemp, cp, symlink, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
const source = process.cwd();
const binary = resolve(process.argv[2] || '');
if (!binary.startsWith(join(process.env.HOME!, '.cache/convex/binaries/')) || !binary.endsWith('/convex-local-backend'))
    throw Error('Pass the official cached Convex local backend binary.');
if (!await Bun.file(join(source, 'public/_documentation/docmap.json')).exists())
    throw Error('Run from the OR3 source root.');
const root = await mkdtemp('/private/tmp/or3-files-convex-');
const pack = JSON.parse(gunzipSync(await Bun.file(resolve(process.env.OR3_PROJECT_CONVEX_SOURCE ?? resolve(source, '../or3-provider-convex'), 'templates/convex.pack.json.gz')).arrayBuffer()).toString());
for (const [name, text] of Object.entries(pack.files)) {
    if (name.includes('..') || name.startsWith('/'))
        throw Error('Invalid template path');
    const target = join(root, 'convex', name);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, text as string);
}
await cp(join(source, 'shared'), join(root, 'shared'), { recursive: true });
await symlink(source + '/node_modules', root + '/node_modules');
await writeFile(root + '/package.json', JSON.stringify({ private: true, dependencies: { convex: '1.46.0' } }));
const instance = 'anonymous-or3-files-' + crypto.randomUUID();
const secret = randomBytes(32).toString('hex');
const keygen = Bun.spawn([binary, 'keygen', 'admin-key', '--instance-name', instance, '--instance-secret', secret], { stdout: 'pipe', stderr: 'pipe' });
const adminKey = (await new Response(keygen.stdout).text()).trim();
if (await keygen.exited !== 0)
    throw Error('Local key generation failed');
function port() { const s = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('probe') }); const p = s.port!; s.stop(true); return p; }
const cloud = port(), site = port();
await writeFile(root + '/sandbox.json', JSON.stringify({ root, url: `http://127.0.0.1:${cloud}`, site: `http://127.0.0.1:${site}`, adminKey, instance }), { mode: 0o600 });
await writeFile(root + '/.env.local', `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${cloud}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`, { mode: 0o600 });
const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', rsa.publicKey);
Object.assign(jwk, { kid: 'sandbox', use: 'sig', alg: 'RS256' });
await writeFile(root + '/signing-key.json', JSON.stringify(await crypto.subtle.exportKey('jwk', rsa.privateKey)), { mode: 0o600 });
// Only sandbox authentication differs: locally signed JWTs, verified by the real backend.
const jwks = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ keys: [jwk] })).toString('base64');
await writeFile(root + '/convex/auth.config.ts', `export default {providers:[{type:'customJwt',issuer:'https://sandbox.or3.test/auth/clerk',applicationID:'convex',algorithm:'RS256',jwks:${JSON.stringify(jwks)}}]};\n`);
console.log(JSON.stringify({ root, url: `http://127.0.0.1:${cloud}`, site: `http://127.0.0.1:${site}` }));
const backend = Bun.spawn([binary, '--interface', '127.0.0.1', '--port', String(cloud), '--site-proxy-port', String(site), '--instance-name', instance, '--instance-secret', secret, '--disable-beacon', '--local-storage', root + '/storage', root + '/backend.sqlite3'], { cwd: root, stdout: Bun.file(root + '/backend.log'), stderr: Bun.file(root + '/backend-errors.log') });
await writeFile(root + '/backend.pid', String(backend.pid));
process.on('SIGTERM', () => { backend.kill(); process.exit(0); });
process.on('SIGINT', () => { backend.kill(); process.exit(0); });
try {
    // Every deploy is explicitly targeted to this newly created loopback instance.
    // Clear inherited cloud selectors; never read the operator's .env.
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            if ((await fetch('http://127.0.0.1:' + cloud + '/version')).ok)
                break;
        }
        catch { }
        if (attempt === 99)
            throw Error('Local backend did not start');
        await Bun.sleep(100);
    }
    const deployed = Bun.spawn(['bunx', 'convex', 'dev', '--once', '--typecheck', 'enable', '--env-file', root + '/.env.local'], { cwd: root, stdout: Bun.file(root + '/deploy.log'), stderr: Bun.file(root + '/deploy-errors.log'), env: { ...process.env, CONVEX_DEPLOY_KEY: '', CONVEX_DEPLOYMENT: '', CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:' + cloud, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey } });
    if (await deployed.exited !== 0) {
        backend.kill();
        throw Error('Sandbox deploy failed; inspect its deploy log.');
    }
    console.log('Sandbox deployment ready: ' + root);
    await backend.exited;
    
} finally {
    backend.kill();
}
