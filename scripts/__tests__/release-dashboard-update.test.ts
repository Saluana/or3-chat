import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDashboardUpdateSmoke } from '../release/smoke-dashboard-update.mjs';

let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
});

describe('dashboard release lifecycle smoke', () => {
    it('accepts one concurrent start, rejects the other, and waits for success', async () => {
        directory = await mkdtemp(join(tmpdir(), 'or3-dashboard-smoke-'));
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

        const result = await runDashboardUpdateSmoke(socketPath, '0.1.40', { pollMs: 5, timeoutMs: 1_000 });
        expect(result.phase).toBe('succeeded');

        claimed = false;
        job = null;
        terminalPhase = 'failed';
        await expect(runDashboardUpdateSmoke(socketPath, '0.1.40', { pollMs: 5, timeoutMs: 1_000 }))
            .rejects.toThrow('ended in failed: synthetic failure');
    });
});
