import { describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createApp, eventHandler, setResponseHeaders, toWebHandler, type H3Event } from 'h3';

vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (plugin: unknown) => plugin }));
import plugin from '../html-compression';

const html = `<!doctype html><html><body>${'Composer – 日本語 🌤️ '.repeat(1000)}</body></html>`;
type RenderResponse = { body: string | Uint8Array; headers: Record<string, string> };
type RenderHook = (response: RenderResponse, context: { event: H3Event }) => Promise<void>;

async function render(requestHeaders: Record<string, string>, responseHeaders: Record<string, string> = {}, body = html, eventHeaders: Record<string, string> = {}) {
    let renderHook!: RenderHook;
    (plugin as unknown as (app: { hooks: { hook(name: string, callback: RenderHook): void } }) => void)({
        hooks: { hook(name, callback) { if (name === 'render:response') renderHook = callback; } },
    });
    const app = createApp();
    app.use(eventHandler(async event => {
        setResponseHeaders(event, eventHeaders);
        const response: RenderResponse = { body, headers: {
            'content-type': 'text/html; charset=utf-8', vary: 'Cookie',
            'set-cookie': 'test-preference=light; Path=/', ...responseHeaders,
        } };
        await renderHook(response, { event });
        setResponseHeaders(event, response.headers);
        return response.body;
    }));
    return toWebHandler(app)(new Request('http://localhost/chat', { headers: requestHeaders }));
}

describe('rendered HTML compression', () => {
    it('preserves exact UTF-8 content and cookies while sending a smaller negotiated representation', async () => {
        const response = await render({ 'accept-encoding': 'gzip, deflate, br' }, {
            'content-length': String(Buffer.byteLength(html)), etag: '"page"',
        }, html, { vary: 'Origin, Cookie' });
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(gunzipSync(bytes).toString('utf8')).toBe(html);
        expect(bytes.byteLength).toBeLessThan(Buffer.byteLength(html));
        expect(response.headers.get('content-encoding')).toBe('gzip');
        expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
        expect(response.headers.get('vary')).toBe('Cookie, Origin, Accept-Encoding');
        expect(response.headers.get('etag')).toBe('W/"page"');
        expect(response.headers.get('set-cookie')).toBe('test-preference=light; Path=/');
    });

    it.each(['', 'identity', 'br', 'gzip;q=0, *;q=1', 'gzip;q=invalid', 'gzip;q=2'])(
        'keeps the identity representation when gzip is not accepted: %s', async encoding => {
            const response = await render({ 'accept-encoding': encoding });
            expect(response.headers.get('content-encoding')).toBeNull();
            expect(await response.text()).toBe(html);
            expect(response.headers.get('vary')).toBe('Cookie, Accept-Encoding');
        });

    it.each(['gzip;q=0.5', '*;q=1', 'GZIP'])(
        'honors an accepted encoding preference: %s', async encoding => {
            const response = await render({ 'accept-encoding': encoding });
            expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(html);
        });

    it.each([
        { request: { range: 'bytes=0-100' }, headers: {} },
        { request: {}, headers: { 'cache-control': 'private, no-transform' } },
        { request: {}, headers: { 'content-type': 'text/event-stream' } },
        { request: {}, headers: { 'content-encoding': 'br' } },
    ] as Array<{ request: Record<string, string>; headers: Record<string, string> }>)(
        'leaves protected or already encoded responses alone: %j', async ({ request, headers }) => {
            const response = await render({ 'accept-encoding': 'gzip', ...request }, headers);
            expect(await response.text()).toBe(html);
            expect(response.headers.get('content-encoding')).toBe(headers['content-encoding'] ?? null);
        });
});
