import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const cli = resolve(import.meta.dirname, '../cli/marketplace-submit.mjs');

function runCli(args, configDirectory, executable = cli) {
    return new Promise((done, fail) => {
        const child = spawn(process.execPath, [executable, ...args], {
            env: { ...process.env, XDG_CONFIG_HOME: configDirectory, CI: 'true' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        const timer = setTimeout(() => child.kill(), 10_000);
        child.on('error', fail);
        child.on('close', (code) => { clearTimeout(timer); done({ code, output }); });
    });
}

async function withServer(run) {
    const calls = [];
    let origin;
    const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString();
        calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, raw });
        let body;
        if (req.url === '/api/v1/oauth/authorize') {
            const input = JSON.parse(raw);
            setTimeout(() => {
                const callback = new URL(input.redirect_uri);
                callback.searchParams.set('code', 'or3_ac_test');
                callback.searchParams.set('state', input.state);
                fetch(callback).catch(() => {});
            }, 100);
            body = { id: 'coa_test' };
        } else if (req.url === '/api/v1/oauth/device/code') body = {
            device_code: 'or3_dc_test', user_code: 'ABCD-EFGH-IJKL-MNOP',
            verification_uri: `${origin}/device`, verification_uri_complete: `${origin}/device?code=ABCD-EFGH-IJKL-MNOP`,
            expires_in: 60, interval: 1,
        };
        else if (req.url === '/api/v1/oauth/token') body = {
            access_token: 'or3_at_test', refresh_token: 'or3_rt_test', expires_in: 900, token_type: 'Bearer',
        };
        else if (req.url === '/api/v1/oauth/revoke') body = { revoked: true };
        else if (req.headers.authorization !== 'Bearer or3_at_test') { res.writeHead(401).end(); return; }
        else if (req.url === '/api/v1/developer/profile') body = { namespace: 'author', status: 'active', submissionEnabled: true };
        else if (req.url === '/api/v1/developer/submissions/sub_test' && req.method === 'GET') {
            body = { id: 'sub_test', status: 'draft', submittable: true, checklist: [] };
        } else if (req.url === '/api/v1/developer/submissions/sub_test' && req.method === 'PATCH') {
            body = { id: 'sub_test' };
        } else { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    origin = `http://127.0.0.1:${server.address().port}`;
    try { await run({ origin, calls }); }
    finally { await new Promise((done) => server.close(done)); }
}

test('the linked command prints help', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'or3-marketplace-link-'));
    try {
        const link = join(directory, 'or3-marketplace');
        await symlink(cli, link);
        const result = await runCli(['--help'], directory, link);
        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /or3-marketplace login/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const mode of ['browser', 'device']) {
    test(`${mode} login saves private credentials and a draft uses its bearer token`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-marketplace-login-'));
        try {
            await withServer(async ({ origin, calls }) => {
                const login = await runCli(['login', '--origin', origin, '--no-browser', ...(mode === 'device' ? ['--device'] : [])], directory);
                assert.equal(login.code, 0, login.output);
                assert.match(login.output, /Signed in/);
                if (mode === 'device') assert.match(login.output, /ABCD-EFGH/);
                const sessionDirectory = join(directory, 'or3-marketplace');
                const [sessionName] = await readdir(sessionDirectory);
                assert.ok(sessionName?.endsWith('.json'));
                assert.equal((await stat(join(sessionDirectory, sessionName))).mode & 0o777, 0o600);
                assert.equal(JSON.parse(await readFile(join(sessionDirectory, sessionName), 'utf8')).refreshToken, 'or3_rt_test');
                const listing = join(directory, 'listing.json');
                await writeFile(listing, JSON.stringify({ category: 'automation', supportUrl: 'https://example.com/support' }));
                const submit = await runCli(['--resume', 'sub_test', '--listing', listing, '--origin', origin, '--draft'], directory);
                assert.equal(submit.code, 0, submit.output);
                assert.match(submit.output, /Draft saved/);
                assert.ok(calls.some((call) => call.url === '/api/v1/developer/submissions/sub_test' && call.authorization === 'Bearer or3_at_test'));
                const logout = await runCli(['logout', '--origin', origin], directory);
                assert.equal(logout.code, 0, logout.output);
                assert.ok(calls.some((call) => call.url === '/api/v1/oauth/revoke' && JSON.parse(call.raw).refresh_token === 'or3_rt_test'));
                assert.deepEqual(await readdir(sessionDirectory), []);
            });
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
}
