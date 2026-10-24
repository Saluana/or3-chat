import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RestartController } from '../../shared/server/restarts/controller';
import { spawn } from 'node:child_process';
import { request as httpRequest, createServer } from 'node:http';
import { createDevelopmentEnvironment } from '../../shared/dev/environment';
import { createHash } from 'node:crypto';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { probeDevelopmentReadiness } from '../../shared/dev/readiness';
import { createDevelopmentPrerequisiteCheck } from '../../shared/dev/restart-supervisor';
import { attachDevHttpsListener } from '../../shared/dev/https-listener';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'or3-restart-journal-'));
    directories.push(directory);
    let replacements = 0;
    const driver = {
        mode: 'development' as const, identity: 'fixture',
        configuration: async () => ({ revision: 'revision-1', settings: { registrationMode: 'open' }, compatible: true }),
        acquire: async () => async () => {},
        replace: async () => { replacements++; },
        probe: async () => {},
    };
    const controller = new RestartController(directory, driver);
    await controller.initialize();
    await controller.boot({ bootId: 'boot-1', ready: true, settings: { registrationMode: 'open' } });
    return { controller, directory, replacements: () => replacements, driver };
}
const request = () => ({ requestId: crypto.randomUUID(), policy: 'wait' as const,
    target: { kind: 'current' as const, activeRevision: 'revision-1' } });

function journalProcess(directory: string, mode?: string) {
    let child: ReturnType<typeof spawn> | undefined;
    const start = async () => {
        await rm(join(directory, 'fixture.sock'), { force: true });
        child = spawn('bun', ['scripts/test/restart-controller-process.ts', directory, ...(mode ? [mode] : [])], {
            cwd: process.cwd(), env: { ...process.env, OR3_RESTART_PROCESS_FIXTURE: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('fixture startup timeout')), 5000);
            let output = '';
            child!.once('error', error => { clearTimeout(timer); reject(error); });
            child!.stdout!.on('data', chunk => {
                output = (output + String(chunk)).slice(-65536);
                if (output.split('\n').includes('fixture-ready')) { clearTimeout(timer); resolve(); }
            });
            child!.once('exit', () => { clearTimeout(timer); reject(new Error('fixture exited before readiness')); });
        });
    };
    const kill = async () => { if (!child || child.exitCode !== null) return; const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGKILL'); await exited; };
    const call = async (path: string, body?: unknown): Promise<{ code: number; body: any }> => await new Promise((resolve, reject) => {
        const req = httpRequest({ socketPath: join(directory, 'fixture.sock'), path: `/lifecycle/v1/${path}`, method: body ? 'POST' : 'GET', timeout: 2000 }, response => {
            const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
            response.once('end', () => resolve({ code: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
        });
        req.once('error', reject); req.once('timeout', () => req.destroy(new Error('fixture request timeout'))); req.end(body ? JSON.stringify(body) : undefined);
    });
    return { start, kill, call };
}

describe('durable restart supervision', () => {
    // Nuxt may serve a large startup/error page before /api/ready exists. The
    // bounded probe must reject without an unhandled socket error, then recover.
    it('survives oversized readiness responses and can probe the next boot', async () => {
        let ready = false;
        const server = createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': ready ? 'application/json' : 'text/html' });
            response.end(ready ? JSON.stringify({ status: 'ready' }) : 'x'.repeat(128 * 1024));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
            await expect(probeDevelopmentReadiness(origin)).rejects.toThrow('readiness_response_limit');
            ready = true;
            await expect(probeDevelopmentReadiness(origin)).resolves.toBeUndefined();
        } finally {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
    it('closes unanswered TLS WebSocket upgrades so Vite can retry, while retaining established sockets', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-restart-upgrade-')); directories.push(directory);
        const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
        const reservation = createServer();
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>(resolve => reservation.close(() => resolve()));
        const previous = { cert: process.env.OR3_DEV_HTTPS_CERT, key: process.env.OR3_DEV_HTTPS_KEY, port: process.env.OR3_DEV_HTTPS_PORT };
        Object.assign(process.env, { OR3_DEV_HTTPS_CERT: cert, OR3_DEV_HTTPS_KEY: key, OR3_DEV_HTTPS_PORT: String(port) });
        const server = createServer(); let ready = false;
        server.on('upgrade', (_request, socket) => {
            if (ready) socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const upgrade = () => httpsRequest(`https://127.0.0.1:${port}/_nuxt/`, {
            rejectUnauthorized: false, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'vite-ping' },
        });
        let stalled: ReturnType<typeof upgrade> | undefined;
        let established: ReturnType<typeof upgrade> | undefined;
        let upgraded: import('node:stream').Duplex | undefined;
        try {
            await attachDevHttpsListener(server);
            let closed = false;
            stalled = upgrade(); stalled.on('error', () => { closed = true; }); stalled.end();
            await expect.poll(() => closed, { timeout: 6500 }).toBe(true);
            ready = true; established = upgrade();
            const connected = new Promise<void>((resolve, reject) => {
                established!.once('upgrade', (_response, socket) => { upgraded = socket; resolve(); });
                established!.once('error', reject);
            });
            established.end(); await connected;
            await new Promise(resolve => setTimeout(resolve, 5500));
            expect(upgraded!.destroyed).toBe(false);
        } finally {
            stalled?.destroy(); established?.destroy(); upgraded?.destroy();
            await new Promise<void>(resolve => server.close(() => resolve()));
            for (const [name, value] of Object.entries({ OR3_DEV_HTTPS_CERT: previous.cert, OR3_DEV_HTTPS_KEY: previous.key, OR3_DEV_HTTPS_PORT: previous.port })) {
                if (value === undefined) delete process.env[name]; else process.env[name] = value;
            }
        }
    }, 20_000);
    it('refuses disappeared prepared artifacts and dependency changes without rebuilding during restart', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-restart-prerequisites-')); directories.push(directory);
        const artifact = join(directory, 'provider.mjs');
        await writeFile(join(directory, 'package.json'), '{}'); await writeFile(artifact, 'export default 1;');
        const check = createDevelopmentPrerequisiteCheck(directory, [artifact]);
        expect(() => check()).not.toThrow();
        await writeFile(artifact, 'export default 2;');
        expect(() => check()).not.toThrow(); // An explicitly rebuilt artifact is reusable.
        await rm(artifact);
        expect(() => check()).toThrow('setup_required');
        await writeFile(artifact, 'export default 2;'); await writeFile(join(directory, 'package.json'), '{"changed":true}');
        expect(() => check()).toThrow('setup_required');
    });
    it('observes a launcher-owned HTTPS listener without weakening global TLS', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-restart-tls-')); directories.push(directory);
        const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
        const server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (_request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ status: 'ready' }));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as { port: number }).port;
            await probeDevelopmentReadiness(`http://127.0.0.1:${port}`);
            expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe('0');
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
    it('fails closed on disk refusal, corrupt records, mismatched receipt identity and a full replay store', async () => {
        const f = await fixture(); const input = request();
        const journal = join(f.directory, 'restarts.json');
        await mkdir(journal);
        await expect(f.controller.submit(input)).rejects.toThrow();
        expect(f.replacements()).toBe(0);
        await rm(journal, { recursive: true });
        await f.controller.submit(input); await f.controller.cancel(input.requestId);
        expect((await stat(journal)).mode & 0o777).toBe(0o600);
        const valid = JSON.parse(await readFile(journal, 'utf8'));
        f.controller.dispose();
        for (const invalid of ['{broken', JSON.stringify({ ...valid, identity: 'another-deployment' }),
            JSON.stringify({ ...valid, operations: [{ ...valid.operations[0], requestId: crypto.randomUUID() }] })]) {
            await writeFile(journal, invalid);
            const reopened = new RestartController(f.directory, f.driver);
            await expect(reopened.initialize()).rejects.toThrow(); reopened.dispose();
        }
        const operations = Array.from({ length: 256 }, () => {
            const next = request();
            return { ...valid.operations[0], request: next, requestId: next.requestId,
                fingerprint: createHash('sha256').update(JSON.stringify(next)).digest('hex') };
        });
        await writeFile(journal, JSON.stringify({ ...valid, operations }));
        const full = new RestartController(f.directory, f.driver); await full.initialize();
        await full.boot({ bootId: 'boot-2', ready: true, settings: { registrationMode: 'open' } });
        await expect(full.submit(request())).rejects.toMatchObject({ code: 'receipt_capacity' });
        expect((await full.submit(operations[0].request)).requestId).toBe(operations[0].requestId);
        expect(JSON.parse(await readFile(journal, 'utf8')).operations).toHaveLength(256); full.dispose();
    });
    it.each([false, true])('survives an actual controller process kill (stop intent: %s) without repeating execution', async stopped => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-restart-crash-')); directories.push(directory);
        const { start, kill, call } = journalProcess(directory);
        const boot = (bootId: string) => call('boot', { bootId, ready: true, settings: { registrationMode: 'open', allowRestart: true } });
        const input = request();
        try {
            await start(); await boot('boot-1'); expect((await call('start', input)).code).toBe(202);
            if (stopped) {
                expect((await call('prepared', { requestId: input.requestId, originalBootId: 'boot-1', targetRevision: 'revision-1' })).code).toBe(200);
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            await kill(); await start(); await boot('boot-1');
            expect((await call('status')).body.operation.phase).toBe('needs_attention');
            expect((await call('start', request())).code).toBe(409);
            if (stopped) {
                expect((await call('reconcile', { requestId: input.requestId })).code).toBe(409);
                await boot('boot-2');
            }
            expect((await call('reconcile', { requestId: input.requestId })).body.operation.phase).toBe(stopped ? 'succeeded' : 'cancelled');
            const executions = await readFile(join(directory, 'executions.jsonl'), 'utf8').catch(() => '');
            expect(executions.trim().split('\n').filter(Boolean)).toHaveLength(stopped ? 1 : 0);
        } finally { await kill(); }
    });
    it('keeps the controller and committed data available after a replacement child fails startup', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-restart-startup-')); directories.push(directory);
        const proof = 'Committed data survives a failed replacement';
        await writeFile(join(directory, 'proof'), proof);
        const { start, kill, call } = journalProcess(directory, 'startup-failure');
        const input = request();
        try {
            await start();
            await call('boot', { bootId: 'boot-1', ready: true, settings: { registrationMode: 'open', allowRestart: true } });
            expect((await call('start', input)).code).toBe(202);
            await call('prepared', { requestId: input.requestId, originalBootId: 'boot-1', targetRevision: 'revision-1' });
            await expect.poll(async () => (await call('status')).body.operation, { timeout: 2000 }).toMatchObject({ phase: 'needs_attention', reasonCode: 'startup_failed' });
            expect((await call('start', input)).body.operation.phase).toBe('needs_attention');
            expect((await call('start', request())).code).toBe(409);
            expect((await call('reconcile', { requestId: input.requestId })).code).toBe(409);
            expect(await readFile(join(directory, 'proof'), 'utf8')).toBe(proof);
            const executions = (await readFile(join(directory, 'executions.jsonl'), 'utf8')).trim().split('\n');
            expect(executions).toHaveLength(1);
            expect(JSON.parse(executions[0]!)).toMatchObject({ exitCode: 42 });
            if (process.env.OR3_RESTART_E2E_OUTPUT) await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT, 'failed-startup.json'), JSON.stringify({
                phase: 'needs_attention', reasonCode: 'startup_failed', childExitCode: 42, executions: 1,
                operation: (await call('status')).body.operation,
                proofChecksum: createHash('sha256').update(proof).digest('hex'), controllerStillAvailable: true,
            }, null, 2));
        } finally { await kill(); }
    });
    it('reloads changed and deleted env keys while retaining equal-valued shell overrides', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'or3-env-relaunch-')); directories.push(directory);
        await writeFile(join(directory, '.env'), 'EDIT=old\nDELETE=gone\nOVERRIDE=same\nBASE=hello\nEXPANDED=${BASE}-world\n');
        const load = createDevelopmentEnvironment(directory, [], { OVERRIDE: 'same' });
        expect(await load()).toMatchObject({ EDIT: 'old', DELETE: 'gone', OVERRIDE: 'same', EXPANDED: 'hello-world' });
        await writeFile(join(directory, '.env'), 'EDIT=new\nOVERRIDE=changed\n');
        const next = await load();
        expect(next.EDIT).toBe('new'); expect(next.DELETE).toBeUndefined(); expect(next.OVERRIDE).toBe('same');
    });
    it('persists acceptance and replays one identity without stopping before preparation', async () => {
        const f = await fixture(); const input = request();
        const operation = await f.controller.submit(input);
        expect(JSON.parse(await readFile(join(f.directory, 'restarts.json'), 'utf8')).operations[0].requestId).toBe(input.requestId);
        expect(await f.controller.submit(input)).toEqual(operation);
        expect(f.replacements()).toBe(0);
        await expect(f.controller.submit({ ...input, target: { kind: 'saved', savedRevision: 'revision-1' } })).rejects.toMatchObject({ code: 'request_conflict' });
        await f.controller.cancel(input.requestId);
        f.controller.dispose();
    });

    it('admits one racing request and refuses another until cancellation', async () => {
        const f = await fixture();
        const results = await Promise.allSettled([f.controller.submit(request()), f.controller.submit(request())]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
        await f.controller.cancel((results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value.requestId);
        f.controller.dispose();
    });

    it('requires a new ready boot and never repeats an acknowledged prepared receipt', async () => {
        const f = await fixture(); const input = request(); await f.controller.submit(input);
        await f.controller.prepared({ requestId: input.requestId, originalBootId: 'boot-1', targetRevision: 'revision-1' });
        await f.controller.prepared({ requestId: input.requestId, originalBootId: 'boot-1', targetRevision: 'revision-1' });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(f.replacements()).toBe(1);
        expect((await f.controller.status(input.requestId)).operation?.phase).not.toBe('succeeded');
        await f.controller.boot({ bootId: 'boot-2', ready: true, settings: { registrationMode: 'open' } });
        await new Promise(resolve => setTimeout(resolve, 300));
        expect((await f.controller.status(input.requestId)).operation?.phase).toBe('succeeded');
        f.controller.dispose();
    });
    it.each(['old-boot', 'wrong-settings'])('retains a single execution and a typed failure for %s verification', async fault => {
        const f = await fixture();
        Object.assign(f.driver, { verificationTimeoutMs: fault === 'old-boot' ? 80 : 5000 });
        const input = request(); await f.controller.submit(input);
        await f.controller.prepared({ requestId: input.requestId, originalBootId: 'boot-1', targetRevision: 'revision-1' });
        if (fault === 'wrong-settings') await f.controller.boot({ bootId: 'boot-2', ready: true, settings: { registrationMode: 'disabled' } });
        await expect.poll(async () => (await f.controller.status()).operation, { timeout: 7500 }).toMatchObject({
            phase: 'needs_attention', reasonCode: fault === 'old-boot' ? 'verification_timeout' : 'configuration_mismatch',
        });
        expect(f.replacements()).toBe(1);
        expect((await f.controller.submit(input)).phase).toBe('needs_attention');
        expect(f.replacements()).toBe(1);
        if (process.env.OR3_RESTART_E2E_OUTPUT) await writeFile(join(process.env.OR3_RESTART_E2E_OUTPUT, `${fault}.json`), JSON.stringify({ operation: (await f.controller.status()).operation }));
        f.controller.dispose();
    });

    it('reopens an interrupted operation as needs-attention without replacement', async () => {
        const f = await fixture(); const input = request(); await f.controller.submit(input); f.controller.dispose();
        const reopened = new RestartController(f.directory, f.driver); await reopened.initialize();
        expect((await reopened.status(input.requestId)).operation?.phase).toBe('needs_attention');
        expect(f.replacements()).toBe(0);
        await expect(reopened.submit(request())).rejects.toMatchObject({ code: 'operation_unresolved' });
        reopened.dispose();
    });

    it('never lets a delayed old worker replace the observed new boot', async () => {
        const f = await fixture();
        await f.controller.boot({ bootId: 'boot-2', ready: true, settings: { registrationMode: 'open' } });
        await f.controller.boot({ bootId: 'boot-1', ready: true, settings: { registrationMode: 'open' } });
        expect((await f.controller.status()).bootId).toBe('boot-2');
        f.controller.dispose();
    });

    it('reconciles a crash before stop as cancelled and a crash after stop only with a verified new boot', async () => {
        for (const stopped of [false, true]) {
            const f = await fixture(); const input = request(); await f.controller.submit(input);
            if (stopped) {
                await f.controller.prepared({ requestId: input.requestId, originalBootId: 'boot-1', targetRevision: 'revision-1' });
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            f.controller.dispose();
            const reopened = new RestartController(f.directory, f.driver); await reopened.initialize();
            await reopened.boot({ bootId: 'boot-1', ready: true, settings: { registrationMode: 'open' } });
            if (stopped) {
                await expect(reopened.reconcile(input.requestId)).rejects.toMatchObject({ code: 'recovery_unverified' });
                await reopened.boot({ bootId: 'boot-2', ready: true, settings: { registrationMode: 'open' } });
            }
            expect((await reopened.reconcile(input.requestId)).phase).toBe(stopped ? 'succeeded' : 'cancelled');
            expect(f.replacements()).toBe(stopped ? 1 : 0);
            reopened.dispose();
        }
    });
});
