import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runDashboardUpdateSmoke } from '../release/smoke-dashboard-update.mjs';
import { publishedDashboardPair } from '../release/select-dashboard-fixture.mjs';

describe('published dashboard fixture selection', () => {
    const release = (version: string, minimum = '0.1.40') => ({
        version,
        dist: { tarball: `https://registry.npmjs.org/@or3/cloud/-/cloud-${version}.tgz`, integrity: 'sha512-fixture' },
        or3Cloud: {
            dashboardUpdateProtocol: 1,
            dashboardUpdateMinimumSourceVersion: minimum,
            imageDigest: `sha256:${'a'.repeat(64)}`,
            operatorImageDigest: `sha256:${'b'.repeat(64)}`,
        },
    });

    it('uses the newest compatible published source across a missing patch', () => {
        const registry = { 'dist-tags': { latest: '0.1.72' }, versions: {
            '0.1.38': release('0.1.38'),
            '0.1.69': release('0.1.69'),
            '0.1.70': release('0.1.70'),
            '0.1.72': release('0.1.72'),
        } };
        expect(publishedDashboardPair(registry).source.version).toBe('0.1.70');
        expect(publishedDashboardPair(registry).target.version).toBe('0.1.72');
    });

    it('blocks qualification instead of using a pre-dashboard source or nonexistent target', () => {
        const registry = { 'dist-tags': { latest: '0.1.72' }, versions: {
            '0.1.38': release('0.1.38'), '0.1.72': release('0.1.72'),
        } };
        expect(() => publishedDashboardPair(registry)).toThrow('No published dashboard-compatible source');
        registry['dist-tags'].latest = '0.1.71';
        expect(() => publishedDashboardPair(registry)).toThrow('Published dashboard target');
    });

    it('honors the target bridge and excludes missing image metadata', () => {
        const incomplete = release('0.1.71');
        delete (incomplete.or3Cloud as Partial<typeof incomplete.or3Cloud>).operatorImageDigest;
        const registry = { 'dist-tags': { latest: '0.1.72' }, versions: {
            '0.1.49': release('0.1.49'), '0.1.70': release('0.1.70'),
            '0.1.71': incomplete, '0.1.72': release('0.1.72', '0.1.60'),
        } };
        expect(publishedDashboardPair(registry).source.version).toBe('0.1.70');
        registry.versions['0.1.72'].or3Cloud.dashboardUpdateMinimumSourceVersion = '0.1.71';
        expect(() => publishedDashboardPair(registry)).toThrow('No published dashboard-compatible source');
    });
});

let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
    if (server) {
        const closed = new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
        server.closeAllConnections();
        await closed;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
});

describe('dashboard release lifecycle smoke', () => {
    it('accepts one concurrent start, rejects the other, and waits for success', async () => {
        directory = await mkdtemp(join('/tmp', 'or3-dashboard-smoke-'));
        const socketPath = join(directory, 'operator.sock');
        let claimed = false;
        let job: Record<string, unknown> | null = null;
        let terminalPhase = 'succeeded';
        server = createServer((request, response) => {
            const send = (status: number, body: unknown) => {
                response.writeHead(status, { 'content-type': 'application/json' });
                response.end(JSON.stringify(body));
            };
            if (request.method === 'POST' && request.url === '/check') {
                return send(200, { latestVersion: '0.1.40', updateAvailable: true });
            }
            if (request.method === 'GET' && request.url === '/status') return send(200, { job });
            if (request.method === 'POST' && request.url === '/start') {
                const chunks: Buffer[] = [];
                request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                request.on('end', () => {
                    if (claimed) return send(409, { message: 'already running' });
                    claimed = true;
                    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    job = { id: input.requestId, targetVersion: input.targetVersion, phase: 'running' };
                    setTimeout(() => { job = { ...(job || {}), phase: terminalPhase, error: terminalPhase === 'failed' ? 'synthetic failure' : undefined }; }, 10);
                    send(202, { job });
                });
                return;
            }
            send(404, { message: 'not found' });
        });
        await new Promise<void>((resolveListen) => server!.listen(socketPath, resolveListen));

        const logs: string[] = [];
        const result = await runDashboardUpdateSmoke(socketPath, '0.1.40', {
            log: (message: string) => logs.push(message),
            pollMs: 5,
            timeoutMs: 1_000,
        });
        expect(result.phase).toBe('succeeded');
        expect(logs.some((message) => message.includes('operator job phase: running'))).toBe(true);
        expect(logs.some((message) => message.includes('update job succeeded'))).toBe(true);

        claimed = false;
        job = null;
        terminalPhase = 'failed';
        await expect(runDashboardUpdateSmoke(socketPath, '0.1.40', { pollMs: 5, timeoutMs: 1_000 }))
            .rejects.toThrow('ended in failed: synthetic failure');
    });

    it('fails early when operator status remains unavailable', async () => {
        directory = await mkdtemp(join('/tmp', 'or3-dashboard-smoke-'));
        const socketPath = join(directory, 'operator.sock');
        let claimed = false;
        server = createServer((request, response) => {
            const send = (status: number, body: unknown) => {
                response.writeHead(status, { 'content-type': 'application/json' });
                response.end(JSON.stringify(body));
            };
            if (request.method === 'POST' && request.url === '/check') {
                return send(200, { latestVersion: '0.1.40', updateAvailable: true });
            }
            if (request.method === 'POST' && request.url === '/start') {
                const chunks: Buffer[] = [];
                request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                request.on('end', () => {
                    if (claimed) return send(409, { message: 'already running' });
                    claimed = true;
                    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    send(202, { job: { id: input.requestId, phase: 'running' } });
                });
                return;
            }
            if (request.method === 'GET' && request.url === '/status') {
                return send(503, { message: 'operator restarting' });
            }
            send(404, { message: 'not found' });
        });
        await new Promise<void>((resolveListen) => server!.listen(socketPath, resolveListen));

        await expect(runDashboardUpdateSmoke(socketPath, '0.1.40', {
            log: () => undefined,
            pollMs: 5,
            statusErrorTimeoutMs: 20,
            timeoutMs: 1_000,
        })).rejects.toThrow('continuously unavailable');
    });

    it('accepts a durable terminal job while the operator hands off', async () => {
        directory = await mkdtemp(join('/tmp', 'or3-dashboard-smoke-'));
        const socketPath = join(directory, 'operator.sock');
        const statePath = join(directory, 'state.json');
        let claimed = false;
        server = createServer((request, response) => {
            const send = (status: number, body: unknown) => {
                response.writeHead(status, { 'content-type': 'application/json' });
                response.end(JSON.stringify(body));
            };
            if (request.method === 'POST' && request.url === '/check') return send(200, { latestVersion: '0.1.40', updateAvailable: true });
            if (request.method === 'POST' && request.url === '/start') {
                const chunks: Buffer[] = [];
                request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                request.on('end', () => {
                    if (claimed) return send(409, { message: 'already running' });
                    claimed = true;
                    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    void writeFile(join(directory!, 'dashboard-update.json'), JSON.stringify({ id: input.requestId, phase: 'succeeded' }));
                    send(202, { job: { id: input.requestId, phase: 'running' } });
                });
                return;
            }
            if (request.method === 'GET' && request.url === '/status') return send(503, { message: 'operator restarting' });
            send(404, { message: 'not found' });
        });
        await writeFile(statePath, JSON.stringify({ appVersion: '0.1.40' }));
        await new Promise<void>((resolveListen) => server!.listen(socketPath, resolveListen));

        const result = await runDashboardUpdateSmoke(socketPath, '0.1.40', {
            statePath,
            pollMs: 5,
            statusErrorTimeoutMs: 20,
            timeoutMs: 1_000,
        });
        expect(result.phase).toBe('succeeded');
    });
});
