import { describe, expect, it, vi } from 'vitest';
import { createTrustedMediation } from '../trusted-mediation';
import { createServerSecretStore } from '../trusted-secret-store';
import { createServer } from 'node:http';
import { once } from 'node:events';

// Owns host delivery/lifetime semantics, distinct from the vault's real transport/security suite.
describe('trusted secret delivery', () => {
    it('refuses HTTP redirects before a remembered value or activation handle reaches another endpoint', async () => {
        let forwarded = 0;
        const destination = createServer((request, response) => {
            request.resume(); forwarded++;
            response.writeHead(200, { 'content-type': 'application/json' }); response.end('{}');
        });
        destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
        const port = (destination.address() as { port: number }).port;
        const origin = createServer((_request, response) => {
            response.writeHead(307, { location: `http://127.0.0.1:${port}/unexpected` }); response.end();
        });
        try {
            origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
            const url = `http://127.0.0.1:${(origin.address() as { port: number }).port}/api/plugins/secrets`;
            const store = createServerSecretStore({ pluginId: 'fixture', activationId: 'sealed', current: () => true,
                fetch: (_url, init) => globalThis.fetch(url, init) });
            const result = await createTrustedMediation({ secrets: store }).secrets.set('key', 'synthetic-redirect-secret');
            expect(forwarded).toBe(0);
            expect(result).toMatchObject({ ok: false, error: { code: 'host-unavailable' } });
        } finally {
            await Promise.all([origin, destination].map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
        }
    });
    it('awaits persistent values, uses real refs, and keeps explicit session values in activation memory', async () => {
        const requests: Record<string, unknown>[] = [];
        const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
            const body = JSON.parse(String(init.body)); requests.push(body);
            return new Response(JSON.stringify({ value: body.operation === 'get' ? 'remembered' : body.operation === 'ref' ? { id: 'opaque', revision: 7, state: 'available', persistence: 'persistent' } : undefined }), { headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        const store = createServerSecretStore({ pluginId: 'fixture', activationId: 'sealed', current: () => true, fetch: fetcher });
        const client = createTrustedMediation({ secrets: store }).secrets;
        expect(await client.get('key')).toEqual({ ok: true, value: 'remembered' });
        expect(await client.ref('key')).toMatchObject({ ok: true, value: { id: 'opaque', revision: 7 } });
        const before = requests.length;
        await client.set('key', 'session-value', { persistence: 'session' });
        expect(await client.get('key')).toEqual({ ok: true, value: 'session-value' });
        expect(requests.length).toBe(before);
        await client.set('key', 'persisted', { persistence: 'remember' });
        expect(requests.at(-1)).toMatchObject({ operation: 'set', key: 'key', value: 'persisted', activationId: 'sealed', pluginId: 'fixture' });
        expect(requests.some(body => 'ownerUserId' in body || 'workspaceId' in body || 'scope' in body)).toBe(false);
    });

    it('discards a value returned after the activation changes', async () => {
        let current = true;
        let release!: (response: Response) => void;
        const fetcher = (() => new Promise<Response>(yes => { release = yes; })) as typeof fetch;
        const store = createServerSecretStore({ pluginId: 'fixture', activationId: 'sealed', current: () => current, fetch: fetcher });
        const client = createTrustedMediation({ secrets: store, ended: () => !current }).secrets;
        const pending = client.get('key');
        current = false;
        release(new Response(JSON.stringify({ value: 'previous-account-value' })));
        expect(await pending).toMatchObject({ ok: false, error: { code: 'stale-context' } });
    });

    it('preserves a compare-and-set conflict without retries', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { code: 'conflict' } }), { status: 409 })) as typeof fetch;
        const client = createTrustedMediation({ secrets: createServerSecretStore({ pluginId: 'fixture', activationId: 'sealed', current: () => true, fetch: fetcher }) }).secrets;
        expect(await client.set('key', 'value')).toMatchObject({ ok: false, error: { code: 'conflict' } });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('never falls back on unavailable or unsupported authority and preserves grant separation', async () => {
        const store = createServerSecretStore({ pluginId: 'fixture', current: () => true, fetch: vi.fn() });
        const client = createTrustedMediation({ secrets: store }).secrets;
        expect(await client.get('key')).toMatchObject({ ok: false });
        const denied = createTrustedMediation({ secrets: store, allow: () => { throw new Error('denied'); } }).secrets;
        expect(await denied.get('key')).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect(await denied.ref('key')).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    });
});
