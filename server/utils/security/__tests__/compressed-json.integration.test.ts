import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, eventHandler, toNodeListener } from 'h3';
import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { readLimitedJsonBody } from '../limited-json-body';
import { prepareJsonBody } from '../../../../app/utils/compress-json';

// Exercise the real HTTP reader: compressed and expanded bodies can each
// exceed the limit; malformed streams and unsupported encodings must fail
// before the handler accepts the request, regardless of HTTP framing.
describe('compressed JSON at the HTTP boundary', () => {
    let server: Server;
    let port: number;
    beforeAll(async () => {
        const app = createApp();
        app.use(eventHandler(async event => readLimitedJsonBody(event, event.path === '/large' ? 128 * 1024 : 4096, { allowGzip: true })));
        server = createServer(toNodeListener(app));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        port = (server.address() as { port: number }).port;
    });
    afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

    function send(body: Buffer, encoding?: string, chunked = false, path = '/'): Promise<{ status: number; body: string }> {
        return new Promise((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: {
                'content-type': 'application/json',
                ...(encoding ? { 'content-encoding': encoding } : {}),
                ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': body.length }),
            } }, res => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(Buffer.from(chunk)));
                res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }

    it.each([false, true])('accepts plain and gzip JSON with chunked=%s', async chunked => {
        const value = { text: 'hello '.repeat(300) };
        const input = Buffer.from(JSON.stringify(value));
        for (const [body, encoding] of [[input, undefined], [gzipSync(input), 'gzip']] as const) {
            const result = await send(body, encoding, chunked);
            expect(result.status).toBe(200);
            expect(JSON.parse(result.body)).toEqual(value);
        }
    });
    it('rejects expanded oversized, malformed and unsupported bodies', async () => {
        expect((await send(gzipSync(Buffer.from(JSON.stringify({ text: 'x'.repeat(5000) }))), 'gzip')).status).toBe(413);
        expect((await send(Buffer.from('not gzip'), 'gzip')).status).toBe(400);
        expect((await send(Buffer.from('{}'), 'br')).status).toBe(415);
        expect((await send(Buffer.alloc(4097), 'gzip', true)).status).toBe(413);
    });
    it('sends compressed bytes only when supported and keeps the JSON intact', async () => {
        const value = { text: 'abc'.repeat(20_000) };
        const oldServer = await prepareJsonBody(value, false);
        expect(oldServer.compressed).toBe(false);
        expect(oldServer.body).toBe(JSON.stringify(value));
        const prepared = await prepareJsonBody(value, true);
        expect(prepared.compressed).toBe(true);
        const bytes = Buffer.from(await (prepared.body as Blob).arrayBuffer());
        expect(bytes.length).toBeLessThan(JSON.stringify(value).length / 2);
        const result = await send(bytes, 'gzip', true, '/large');
        expect(result.status).toBe(200);
        expect(JSON.parse(result.body)).toEqual(value);
        const small = await prepareJsonBody({ text: 'small' }, true);
        expect(small.compressed).toBe(false);
        const controller = new AbortController();
        controller.abort();
        await expect(prepareJsonBody(value, true, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
});
