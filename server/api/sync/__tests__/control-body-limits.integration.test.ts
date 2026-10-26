import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, createRouter, toNodeListener } from 'h3';
import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';

// Feature/origin gates and identity are synthetic. Real H3 and Node HTTP consume
// declared-length/chunked bytes before these unauthenticated requests resolve.
const session = vi.hoisted(() => vi.fn(async () => ({ authenticated: false })));
vi.mock('../../../auth/session', () => ({ resolveSessionContext: session }));
vi.mock('../../../utils/auth/is-ssr-auth-enabled', () => ({ isSsrAuthEnabled: () => true }));
vi.mock('../../../utils/sync/is-sync-enabled', () => ({ isSyncEnabled: () => true }));
vi.mock('../../../utils/security/cloud-mutation', () => ({ requireCloudMutation: () => {} }));
vi.mock('../../../sync/gateway/registry', () => ({ getActiveSyncGatewayAdapter: () => undefined }));

import snapshot from '../snapshot.post';
import cursor from '../update-cursor.post';
import changeLogGc from '../gc-change-log.post';
import tombstoneGc from '../gc-tombstones.post';

const routes = [
    { path: '/snapshot', handler: snapshot, body: { scope: { workspaceId: 'ws-1' }, pageSize: 1 } },
    { path: '/cursor', handler: cursor, body: { scope: { workspaceId: 'ws-1' }, deviceId: 'device-1', version: 1 } },
    { path: '/gc-change-log', handler: changeLogGc, body: { scope: { workspaceId: 'ws-1' }, retentionSeconds: 604800 } },
    { path: '/gc-tombstones', handler: tombstoneGc, body: { scope: { workspaceId: 'ws-1' }, retentionSeconds: 604800 } },
];

describe('sync control bodies at the HTTP byte boundary', () => {
    let server: Server;
    let port: number;

    beforeEach(async () => {
        session.mockClear();
        const app = createApp();
        const router = createRouter();
        for (const route of routes) router.post(route.path, route.handler);
        app.use(router);
        server = createServer(toNodeListener(app));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        port = (server.address() as { port: number }).port;
    });

    afterEach(async () => {
        if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    async function send(path: string, body: Buffer, framing: 'declared' | 'chunked'): Promise<number> {
        return new Promise((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: {
                'content-type': 'application/json',
                ...(framing === 'declared' ? { 'content-length': body.byteLength } : { 'transfer-encoding': 'chunked' }),
            } }, res => {
                res.resume();
                res.once('end', () => resolve(res.statusCode!));
            });
            req.once('error', reject);
            // A split multibyte sequence must still count as bytes, not chars.
            req.write(body.subarray(0, 4097));
            req.end(body.subarray(4097));
        });
    }

    // Failure: valid unknown fields bypass schema rejection while H3 buffers
    // an oversized unauthenticated body. Cover both framing modes on each route.
    it.each(routes)('caps $path before authentication for declared and chunked bytes', async route => {
        const body = Buffer.from(JSON.stringify({ ...route.body, padding: 'é'.repeat(4200) }));
        expect(body.byteLength).toBeGreaterThan(8192);
        for (const framing of ['declared', 'chunked'] as const) {
            expect(await send(route.path, body, framing)).toBe(413);
            expect(session).not.toHaveBeenCalled();
        }
    });

    it.each(routes)('parses bounded $path bodies and rejects malformed JSON before authentication', async route => {
        expect(await send(route.path, Buffer.from('{"scope":'), 'chunked')).toBe(400);
        expect(session).not.toHaveBeenCalled();
        expect(await send(route.path, Buffer.from(JSON.stringify(route.body)), 'chunked')).toBe(401);
        expect(session).toHaveBeenCalledOnce();
    });
});
