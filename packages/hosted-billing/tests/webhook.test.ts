import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, toNodeListener } from 'h3';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Stripe from 'stripe';
import { BillingStore } from '../runtime/server/store';
import { BillingService } from '../runtime/server/service';
import { installBillingService } from '../runtime/server/runtime';
// Webhooks use Stripe signatures, not browser session/mutation authorization.
vi.mock('../../../server/auth/can', () => ({ requireCan: vi.fn() }));
vi.mock('../../../server/auth/session', () => ({ resolveSessionContext: vi.fn() }));
vi.mock('../../../server/utils/security/cloud-mutation', () => ({ requireCloudMutation: vi.fn() }));
vi.mock('../../../server/utils/rate-limit/store', () => ({ getRateLimitProvider: vi.fn() }));
vi.mock('../../../server/utils/rate-limit/enforce', () => ({ enforceRateLimit: vi.fn() }));
import webhook from '../runtime/server/routes/webhook';

describe('Stripe webhook HTTP boundary', () => {
    const cleanup: Array<() => void | Promise<void>> = [];
    afterEach(async () => { for (const fn of cleanup.reverse()) await fn(); cleanup.length = 0; vi.restoreAllMocks(); });
    it('preserves signed bytes, rejects tampering and oversized bodies, and applies a signed refund once', async () => {
        const root = mkdtempSync('/tmp/or3-webhook-'); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
        const store = new BillingStore(join(root, 'billing.sqlite')); cleanup.push(() => store.close());
        const stripe = new Stripe('sk_test_fixture');
        const service = new BillingService(store, stripe, { secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture',
            priceId: 'price_year', baseUrl: 'https://or3.example', databasePath: '', syncDatabasePath: '' });
        cleanup.push(installBillingService(service));
        await store.exclusive('alice', async token => store.update('alice', token, { customer_id: 'cus_fixture' }));
        const reconcile = vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [], has_more: false } as never);
        const body = JSON.stringify({ id: 'evt_refund', type: 'charge.refunded', data: { object: { customer: 'cus_fixture' } } });
        const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_fixture' });
        const server = createServer(toNodeListener(createApp().use('/api/billing/webhook', webhook)));
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
        const port = (server.address() as { port: number }).port;
        const send = (payload: string, signed = signature, chunked = false) => fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signed },
            body: chunked ? new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } }) : payload,
            ...(chunked ? { duplex: 'half' } : {}),
        });
        expect((await send(body + ' ')).status).toBe(400);
        expect((await send(body, 'invalid')).status).toBe(400);
        expect((await send(body, stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_fixture', timestamp: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(400);
        expect((await send('{', stripe.webhooks.generateTestHeaderString({ payload: '{', secret: 'whsec_fixture' }))).status).toBe(400);
        expect((await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, { method: 'POST', body })).status).toBe(400);
        expect((await send('x'.repeat(2 ** 21))).status).toBe(413);
        expect((await send('x'.repeat(2 ** 20 + 1), signature, true)).status).toBe(413);
        expect(reconcile).not.toHaveBeenCalled();
        const response = await send(body);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(store.status('alice').state).toBe('review');
        expect((await send(body)).status).toBe(200);
        expect(reconcile).toHaveBeenCalledTimes(1);

        const retryBody = JSON.stringify({ id: 'evt_retry', type: 'invoice.paid', data: { object: { customer: 'cus_fixture' } } });
        const retrySignature = stripe.webhooks.generateTestHeaderString({ payload: retryBody, secret: 'whsec_fixture' });
        reconcile.mockRejectedValueOnce(new Error('private provider request detail'));
        const failure = await send(retryBody, retrySignature);
        expect(failure.status).toBe(503);
        expect(failure.headers.get('retry-after')).toBe('5');
        expect(await failure.text()).not.toContain('private provider request detail');
        expect(store.processed('evt_retry')).toBe(false);
        expect((await send(retryBody, retrySignature)).status).toBe(200);
        expect(store.processed('evt_retry')).toBe(true);
        expect(reconcile).toHaveBeenCalledTimes(3);
    });
});
