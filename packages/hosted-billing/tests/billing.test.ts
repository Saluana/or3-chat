import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Stripe from 'stripe';
import { BillingStore } from '../runtime/server/store';
import { BillingService } from '../runtime/server/service';
import { requiresHostedAccess } from '../runtime/server/access';
import { readBillingConfig } from '../runtime/server/config';

describe('optional hosted billing', () => {
    let root: string;
    let store: BillingStore;
    let service: BillingService;
    let stripe: Stripe;
    const config = {
        secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture', priceId: 'price_year',
        baseUrl: 'https://or3.example', databasePath: '', syncDatabasePath: '',
    };
    const future = () => Math.floor(Date.now() / 1000) + 365 * 86400;
    const subscription = (status = 'active', paid = true) => {
        const start = Math.floor(Date.now() / 1000), end = future();
        return {
            id: 'sub_1', customer: 'cus_1', created: 1, status, cancel_at_period_end: false, cancel_at: null,
            items: { data: [{ id: 'si_1', price: { id: 'price_year' }, quantity: 1, current_period_start: start, current_period_end: end }] },
            latest_invoice: { id: 'in_1', customer: 'cus_1', status: paid ? 'paid' : 'open',
                parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } },
                lines: { has_more: false, data: [{ id: 'il_1', quantity: 1, currency: 'usd',
                    period: { start, end }, pricing: { type: 'price_details', price_details: { price: 'price_year' } },
                    parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_1', subscription_item: 'si_1', proration: false } },
                }] },
            },
        };
    };
    async function customer() {
        await store.exclusive('alice', async token => store.update('alice', token, { customer_id: 'cus_1' }));
    }
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'or3-billing-'));
        store = new BillingStore(join(root, 'billing.sqlite'));
        store.claimTrial('alice', 'alice@example.test', '192.0.2.1');
        store.claimTrial('bob', 'bob@example.test', '192.0.2.2');
        stripe = new Stripe(config.secretKey);
        service = new BillingService(store, stripe, config);
    });
    afterEach(() => { vi.restoreAllMocks(); store.close(); rmSync(root, { recursive: true, force: true }); });

    it('warns when the configured bootstrap price differs from the saved current offer', () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        new BillingService(store, stripe, { ...config, priceId: 'price_different' });
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('OR3_BILLING_STRIPE_PRICE_ID'));
        expect(store.currentOffer()?.priceId).toBe('price_year');
    });

    // Offer failure inventory: retiring a price must not erase paid access;
    // unknown/multi-item prices hold for review; a new current offer cannot
    // rewrite old trial promises; stale/replayed/audit-failed changes are atomic.
    async function nextOffer(operationId = 'offer-next', expectedRevision = store.offers().revision) {
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ id: 'price_next', active: true, currency: 'usd', unit_amount: 6000,
            type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } } as never);
        return service.changeOffer({ operationId, actor: 'admin', reason: 'New annual offer', expectedRevision,
            command: { kind: 'create_current', priceId: 'price_next', amountCents: 6000, paidStorageGb: 75, trialStorageGb: 2, trialDays: 14 } });
    }

    it('recognizes historical invoices and preserves old trials after changing the checkout offer', async () => {
        await customer();
        const oldTrial = store.account('bob').trial_ends_at;
        const original = subscription();
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [original], has_more: false } as never);
        await service.refresh('alice');
        await nextOffer();
        expect((await service.refresh('alice'))).toMatchObject({ allowed: true, paidUntil: original.items.data[0]!.current_period_end * 1000, storageLimitBytes: 50_000_000_000, paidStorageLimitBytes: 50_000_000_000, offer: { amountCents: 4000, paidStorageGb: 50 } });
        expect(store.status('bob')).toMatchObject({ trialEndsAt: oldTrial, storageLimitBytes: 1_000_000_000 });
        const now = Date.now();
        store.claimTrial('new-trial', 'new@example.test', '192.0.2.10', now);
        expect(store.status('new-trial', now)).toMatchObject({ trialEndsAt: now + 14 * 86400000, storageLimitBytes: 2_000_000_000 });
        expect(store.offers().items.filter(offer => offer.status === 'current')).toHaveLength(1);
        const oldOffer = store.offers().items.find(offer => offer.priceId === 'price_year')!;
        await service.changeOffer({ operationId: 'retire-old', actor: 'admin', reason: 'Retired from sale', expectedRevision: store.offers().revision,
            command: { kind: 'retire', offerId: oldOffer.id } });
        expect((await service.refresh('alice')).allowed).toBe(true);
    });

    it('freezes the allowance promised by a support trial for a never-trialed account', async () => {
        const account = store.account('denied-with-extension');
        await service.supportCommand(account.user_id, { operationId: 'trial-support', actor: 'admin', reason: 'Restore denied trial access', expectedRevision: account.admin_revision,
            command: { kind: 'extend_trial', expiresAt: Date.now() + 7 * 86_400_000 } });
        expect(store.status(account.user_id).storageLimitBytes).toBe(1_000_000_000);
        await nextOffer();
        expect(store.status(account.user_id)).toMatchObject({ state: 'trial', source: 'support_trial', storageLimitBytes: 1_000_000_000, trialEndsAt: 0 });
    });

    it.each(['unknown', 'multiple'])('holds %s price matches without erasing confirmed payment facts', async kind => {
        await customer();
        const current = subscription();
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [current], has_more: false } as never);
        const paid = await service.refresh('alice');
        if (kind === 'unknown') current.items.data[0]!.price.id = 'price_unrecognized';
        else current.items.data.push({ ...current.items.data[0]!, id: 'si_second' });
        const result = await service.refresh('alice');
        expect(result).toMatchObject({ allowed: false, state: 'review', paidUntil: paid.paidUntil });
        expect(store.openReviewIds('alice')).toHaveLength(1);
    });

    it('allows an unknown-price review to be resolved after the subscription is canceled', async () => {
        await customer();
        const current = subscription();
        current.items.data[0]!.price.id = 'price_unrecognized';
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [current], has_more: false } as never);
        await service.refresh('alice');
        current.status = 'canceled';
        await service.refresh('alice');
        const account = store.account('alice');
        await expect(service.resolveReviews('alice', { operationId: 'resolve-canceled', actor: 'admin', reason: 'Canceled invalid subscription', expectedRevision: account.admin_revision, reviewIds: store.openReviewIds('alice') })).resolves.toMatchObject({ outcome: 'resolved' });
    });

    it('replaces an expired checkout when its historical price is archived', async () => {
        await customer();
        const old = store.currentOffer()!;
        await nextOffer();
        await store.exclusive('alice', async token => store.update('alice', token, { checkout_attempt: 'old-attempt', checkout_session_id: 'cs_old', checkout_offer_id: old.id }));
        vi.spyOn(stripe.prices, 'retrieve').mockImplementation(async id => ({ active: id !== old.priceId, currency: 'usd', unit_amount: 6000, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }) as never);
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [], has_more: false } as never);
        vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({ id: 'cs_old', status: 'expired' } as never);
        vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.com/new' } as never);
        await expect(service.checkout('alice')).resolves.toBe('https://checkout.stripe.com/new');
    });

    // Saved attempt without a recorded session (the create response was lost):
    // - Stripe may already hold a session under its key, so the exact request is replayed first, even after an offer change;
    // - only a refused replay (for example an archived price) proves no session exists and starts a current-offer attempt;
    // - a transient or idempotency failure keeps the attempt, so a later retry still replays the same key.
    describe('checkout attempt without a recorded session', () => {
        const priceFor = (archived: string) => vi.spyOn(stripe.prices, 'retrieve').mockImplementation(async id => ({ active: id !== archived, currency: 'usd', unit_amount: id === 'price_year' ? 4000 : 6000,
            type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }) as never);
        async function lostAttempt() {
            await customer();
            const old = store.currentOffer()!;
            await nextOffer();
            await store.exclusive('alice', async token => store.update('alice', token, { checkout_attempt: 'lost-attempt', checkout_offer_id: old.id }));
            vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [], has_more: false } as never);
            return old;
        }
        const refused = () => new Stripe.errors.StripeInvalidRequestError({ message: 'The price specified is inactive.', type: 'invalid_request_error' });

        it('replays a session Stripe already created instead of creating another', async () => {
            const old = await lostAttempt();
            priceFor(old.priceId);
            const create = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ id: 'cs_lost', url: 'https://checkout.stripe.com/lost' } as never);
            vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({ id: 'cs_lost', status: 'open', url: 'https://checkout.stripe.com/lost' } as never);
            await expect(service.checkout('alice')).resolves.toBe('https://checkout.stripe.com/lost');
            expect(create).toHaveBeenCalledOnce();
            expect(create.mock.calls[0]?.[0]?.line_items).toEqual([{ price: old.priceId, quantity: 1 }]);
            expect(create.mock.calls[0]?.[1]?.idempotencyKey).toBe('or3-checkout-lost-attempt');
            expect(store.account('alice')).toMatchObject({ checkout_attempt: 'lost-attempt', checkout_session_id: 'cs_lost', checkout_offer_id: old.id });
        });

        // A v1 idempotent replay contains the original creation response, not
        // the current session state. Expiry must replace it in this request.
        it('replaces an expired replay with the current offer without redirecting to the cached URL', async () => {
            const old = await lostAttempt();
            priceFor(old.priceId);
            const create = vi.spyOn(stripe.checkout.sessions, 'create')
                .mockResolvedValueOnce({ id: 'cs_lost', status: 'open', url: 'https://checkout.stripe.com/expired' } as never)
                .mockResolvedValue({ id: 'cs_new', status: 'open', url: 'https://checkout.stripe.com/new' } as never);
            vi.spyOn(stripe.checkout.sessions, 'retrieve').mockImplementation(async id => (id === 'cs_lost'
                ? { id, status: 'expired', url: null }
                : { id, status: 'open', url: 'https://checkout.stripe.com/new' }) as never);

            await expect(service.checkout('alice')).resolves.toBe('https://checkout.stripe.com/new');
            expect(create).toHaveBeenCalledTimes(2);
            expect(create.mock.calls[1]?.[0]?.line_items).toEqual([{ price: 'price_next', quantity: 1 }]);
            expect(create.mock.calls[1]?.[1]?.idempotencyKey).not.toBe('or3-checkout-lost-attempt');
            expect(store.account('alice')).toMatchObject({ checkout_session_id: 'cs_new', checkout_offer_id: store.currentOffer()!.id });
        });

        it('starts a current-offer attempt when Stripe refuses the archived price', async () => {
            const old = await lostAttempt();
            priceFor(old.priceId);
            const create = vi.spyOn(stripe.checkout.sessions, 'create').mockRejectedValueOnce(refused())
                .mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.com/new' } as never);
            await expect(service.checkout('alice')).resolves.toBe('https://checkout.stripe.com/new');
            expect(create).toHaveBeenCalledTimes(2);
            expect(create.mock.calls[1]?.[0]?.line_items).toEqual([{ price: 'price_next', quantity: 1 }]);
            expect(create.mock.calls[1]?.[1]?.idempotencyKey).not.toBe('or3-checkout-lost-attempt');
            expect(store.account('alice')).toMatchObject({ checkout_session_id: 'cs_new', checkout_offer_id: store.currentOffer()!.id });
        });

        it('keeps the attempt after a transient or idempotency failure', async () => {
            const old = await lostAttempt();
            priceFor(old.priceId);
            const create = vi.spyOn(stripe.checkout.sessions, 'create')
                .mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({ message: 'socket hang up' }))
                .mockRejectedValueOnce(new Stripe.errors.StripeIdempotencyError({ message: 'Keys for idempotent requests can only be used with the same parameters.', type: 'idempotency_error' }));
            await expect(service.checkout('alice')).rejects.toThrow('socket hang up');
            await expect(service.checkout('alice')).rejects.toThrow('same parameters');
            expect(create.mock.calls.map(call => call[1]?.idempotencyKey)).toEqual(['or3-checkout-lost-attempt', 'or3-checkout-lost-attempt']);
            expect(store.account('alice')).toMatchObject({ checkout_attempt: 'lost-attempt', checkout_session_id: null, checkout_offer_id: old.id });
        });
    });

    it('changes offers once and rejects stale writes and audit failures atomically', async () => {
        const revision = store.offers().revision;
        await nextOffer('unique-offer', revision);
        const current = store.offers();
        await nextOffer('unique-offer', revision);
        expect(store.offers()).toEqual(current);
        await expect(service.changeOffer({ operationId: 'stale', actor: 'admin', reason: 'Retire', expectedRevision: revision,
            command: { kind: 'retire', offerId: current.items.find(offer => offer.status !== 'current')!.id } })).rejects.toMatchObject({ code: 'stale_revision' });
        store.db.exec("CREATE TRIGGER fail_offer_audit BEFORE INSERT ON billing_admin_actions BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
        await expect(service.changeOffer({ operationId: 'audit-failed', actor: 'admin', reason: 'Retire', expectedRevision: current.revision,
            command: { kind: 'retire', offerId: current.items.find(offer => offer.status !== 'current')!.id } })).rejects.toThrow('audit unavailable');
        expect(store.offers()).toEqual(current);
    });

    it('audits allowance changes atomically and refuses stale or reused commands', () => {
        const initial = store.settings();
        const input = { operationId: 'allowance-change', actor: 'admin', reason: 'Measured capacity increase', settings: { ...initial, paidStorageGb: 75 } };
        service.changeAllowances(input);
        expect(store.action(input.operationId)).toMatchObject({ kind: 'allowance_change', reason: input.reason, after: { paidStorageGb: 75 } });
        expect(service.changeAllowances(input)).toEqual(store.settings());
        expect(() => service.changeAllowances({ ...input, settings: { ...input.settings, paidStorageGb: 76 } })).toThrow(/operation ID/);
        expect(() => service.changeAllowances({ ...input, operationId: 'stale-allowance' })).toThrow(/changed/);
        const before = store.offers();
        store.db.exec("CREATE TRIGGER fail_allowance_audit BEFORE INSERT ON billing_admin_actions BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
        expect(() => service.changeAllowances({ ...input, operationId: 'allowance-audit-failure', settings: { ...store.settings(), paidStorageGb: 80 } })).toThrow('audit unavailable');
        expect(store.offers()).toEqual(before);
        expect(store.settings().paidStorageGb).toBe(75);
    });

    it('starts one durable seven-day trial per canonical account, independent of workspace and restart', () => {
        const start = 1_800_000_000_000;
        store.claimTrial('charlie', 'charlie@example.test', '192.0.2.3', start);
        const trial = store.status('charlie', start);
        expect(trial.trialEndsAt).toBe(start + 7 * 86400000);
        expect(trial.storageLimitBytes).toBe(1_000_000_000);
        store.close();
        store = new BillingStore(join(root, 'billing.sqlite'));
        expect(store.status('charlie', start + 7 * 86400000)).toMatchObject({ allowed: false, state: 'expired', trialEndsAt: trial.trialEndsAt });
        store.claimTrial('dave', 'dave@example.test', '192.0.2.4', start + 7 * 86400000);
        expect(store.status('dave', start + 7 * 86400000)).toMatchObject({ allowed: true, state: 'trial' });
    });

    it('changes storage limits immediately, persists settings, and refuses stale admin writes', () => {
        const settings = store.settings();
        expect(store.saveSettings({ ...settings, trialStorageGb: 2, paidStorageGb: 75 })).toBe(true);
        expect(store.saveSettings({ ...settings, paidStorageGb: 10 })).toBe(false);
        expect(store.status('alice').storageLimitBytes).toBe(2_000_000_000);
        store.close();
        store = new BillingStore(join(root, 'billing.sqlite'));
        expect(store.settings()).toMatchObject({ trialStorageGb: 2, paidStorageGb: 75 });
    });

    it('uses current Stripe state for delayed events, rejects unpaid activation, and revokes immediate cancellation', async () => {
        await customer();
        let current = subscription('active', false);
        vi.spyOn(stripe.subscriptions, 'list').mockImplementation(() => Promise.resolve({ data: [current], has_more: false }) as unknown as ReturnType<typeof stripe.subscriptions.list>);
        expect(await service.refresh('alice')).toMatchObject({ allowed: false, state: 'payment_required' });
        current = subscription();
        expect(await service.refresh('alice')).toMatchObject({ allowed: true, state: 'active', storageLimitBytes: 50_000_000_000 });
        const event = { id: 'evt_old', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1', status: 'canceled' } } } as Stripe.Event;
        await service.webhook(event);
        await service.webhook(event);
        expect(store.status('alice').state).toBe('active');
        current = subscription('canceled');
        await service.webhook({ ...event, id: 'evt_new', type: 'customer.subscription.updated' } as Stripe.Event);
        expect(store.status('alice').allowed).toBe(false);
    });

    it('retains paid access to the end of a canceled renewal and never extends it for failed payments', async () => {
        await customer();
        let current = { ...subscription(), cancel_at_period_end: true };
        vi.spyOn(stripe.subscriptions, 'list').mockImplementation(() => Promise.resolve({ data: [current], has_more: false }) as unknown as ReturnType<typeof stripe.subscriptions.list>);
        const paid = await service.refresh('alice');
        expect(paid).toMatchObject({ allowed: true, cancelAtPeriodEnd: true });
        current = { ...subscription('past_due', false), cancel_at_period_end: false };
        current.items.data[0]!.current_period_end += 365 * 86400;
        expect((await service.refresh('alice')).paidUntil).toBe(paid.paidUntil);
        expect(store.status('alice', paid.paidUntil).allowed).toBe(false);
    });

    it('keeps a bounded renewal grace through draft/open invoices and ends it on failed collection', async () => {
        await customer();
        const end = Math.floor(Date.now() / 1000) + 10;
        let current: any = subscription();
        current.items.data[0].current_period_end = end;
        current.latest_invoice.lines.data[0].period.end = end;
        vi.spyOn(stripe.subscriptions, 'list').mockImplementation(() => Promise.resolve({ data: [current], has_more: false }) as never);
        await service.refresh('alice');
        current = subscription();
        current.items.data[0].current_period_start = end;
        current.latest_invoice.lines.data[0].period.start = end;
        Object.assign(current.latest_invoice, { id: 'in_renew', status: 'draft', billing_reason: 'subscription_cycle', auto_advance: true, attempt_count: 0 });
        await service.refresh('alice');
        expect(store.status('alice', end * 1000 + 1000).allowed).toBe(true);
        expect(store.status('alice', end * 1000 + 25 * 3600000).allowed).toBe(false);
        current.latest_invoice.status = 'open';
        await service.refresh('alice');
        expect(store.status('alice', end * 1000 + 1000).allowed).toBe(true);
        current.status = 'past_due'; current.latest_invoice.attempt_count = 1;
        await service.refresh('alice');
        expect(store.status('alice', end * 1000 + 1000).allowed).toBe(false);
        current.status = 'active'; current.latest_invoice.status = 'paid';
        expect((await service.refresh('alice')).paidUntil).toBe(current.items.data[0].current_period_end * 1000);
    });

    it.each(['old_period', 'wrong_item', 'wrong_subscription', 'wrong_customer', 'wrong_price', 'wrong_quantity', 'wrong_currency', 'proration', 'missing_lines'])(
        'does not grant a year from an unrelated paid invoice: %s', async reason => {
            await customer();
            const current = subscription();
            const line = current.latest_invoice.lines.data[0]!;
            if (reason === 'old_period') { line.period.start -= 365 * 86400; line.period.end -= 365 * 86400; }
            if (reason === 'wrong_item') line.parent.subscription_item_details.subscription_item = 'si_other';
            if (reason === 'wrong_subscription') current.latest_invoice.parent.subscription_details.subscription = 'sub_other';
            if (reason === 'wrong_customer') current.latest_invoice.customer = 'cus_other';
            if (reason === 'wrong_price') line.pricing.price_details.price = 'price_other';
            if (reason === 'wrong_quantity') line.quantity = 2;
            if (reason === 'wrong_currency') line.currency = 'cad';
            if (reason === 'proration') line.parent.subscription_item_details.proration = true;
            if (reason === 'missing_lines') current.latest_invoice.lines.data = [];
            vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [current], has_more: false } as never);
            expect(await service.refresh('alice')).toMatchObject({ allowed: false, paidUntil: 0 });
        });

    it('verifies exact webhook bytes and leaves refunded accounts held despite later paid events', async () => {
        const payload = JSON.stringify({ id: 'evt_refund', type: 'charge.refunded', data: { object: { customer: 'cus_1' } } });
        const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret });
        expect(() => service.verifyWebhook(Buffer.from(payload + ' '), signature)).toThrow();
        expect(() => service.verifyWebhook(Buffer.from(payload), 'bad')).toThrow();
        await customer();
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [subscription()], has_more: false } as never);
        await service.webhook(service.verifyWebhook(Buffer.from(payload), signature));
        await service.refresh('alice');
        expect(store.status('alice')).toMatchObject({ allowed: false, state: 'review' });
    });

    it('reuses open checkout, prevents concurrent duplicates, and never grants access on checkout creation', async () => {
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ active: true, currency: 'usd', unit_amount: 4000, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } } as never);
        vi.spyOn(stripe.customers, 'create').mockResolvedValue({ id: 'cus_1' } as never);
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [], has_more: false } as never);
        const create = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/test' } as never);
        vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({ id: 'cs_1', status: 'open', url: 'https://checkout.stripe.com/c/pay/test' } as never);
        const attempts = await Promise.allSettled([service.checkout('alice'), service.checkout('alice')]);
        expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
        expect(await service.checkout('alice')).toBe('https://checkout.stripe.com/c/pay/test');
        expect(create).toHaveBeenCalledTimes(1);
        expect(store.status('alice').state).toBe('trial');
        expect(store.account('bob').customer_id).toBeNull();
    });

    it('rejects a wrong Stripe price before creating a checkout', async () => {
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ active: true, currency: 'usd', unit_amount: 400, type: 'recurring' } as never);
        await expect(service.checkout('alice')).rejects.toThrow('$40/year');
        expect(store.account('alice').customer_id).toBeNull();
    });

    // Audit failure inventory: a valid unit_amount can still bill zero when
    // quantity is transformed; payment may complete after the subscription
    // snapshot; successful ordinary reconciliations must clear stale failures.
    it.each(['checkout', 'offer'] as const)('rejects quantity-transformed prices before %s changes billing state', async action => {
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ id: 'price_transformed', active: true, currency: 'usd', unit_amount: 4000,
            type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' },
            transform_quantity: { divide_by: 5, round: 'down' } } as never);
        const createCustomer = vi.spyOn(stripe.customers, 'create').mockResolvedValue({ id: 'cus_1' } as never);
        const createCheckout = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/test' } as never);
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [], has_more: false } as never);
        const before = store.offers();
        const result = action === 'checkout' ? service.checkout('alice') : service.changeOffer({
            operationId: 'transformed-price', actor: 'admin', reason: 'New annual offer', expectedRevision: before.revision,
            command: { kind: 'create_current', priceId: 'price_transformed', amountCents: 4000, paidStorageGb: 50, trialStorageGb: 1, trialDays: 7 },
        });
        await expect(result).rejects.toMatchObject({ code: 'invalid_price' });
        expect(createCustomer).not.toHaveBeenCalled();
        expect(createCheckout).not.toHaveBeenCalled();
        expect(store.account('alice').customer_id).toBeNull();
        expect(store.offers()).toEqual(before);
    });

    it.each(['active', 'canceled'] as const)('checks the completed Checkout subscription when it is %s after an earlier canceled snapshot', async status => {
        await customer();
        await store.exclusive('alice', async token => store.update('alice', token, {
            subscription_id: 'sub_old', subscription_status: 'canceled', checkout_attempt: 'pending-attempt',
            checkout_session_id: 'cs_pending', checkout_offer_id: store.currentOffer()!.id,
        }));
        const old = { ...subscription('canceled'), id: 'sub_old' };
        const completed = subscription(status);
        let subscriptions = [old];
        vi.spyOn(stripe.subscriptions, 'list').mockImplementation(() => Promise.resolve({ data: subscriptions, has_more: false }) as unknown as ReturnType<typeof stripe.subscriptions.list>);
        vi.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValue(completed as never);
        vi.spyOn(stripe.checkout.sessions, 'retrieve').mockImplementation(async () => {
            // Stripe completes the outstanding purchase after the list response.
            subscriptions = [old, completed];
            return { id: 'cs_pending', customer: 'cus_1', status: 'complete', subscription: completed.id, url: null } as never;
        });
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ active: true, currency: 'usd', unit_amount: 4000, type: 'recurring',
            billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } } as never);
        const create = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.com/new' } as never);
        vi.spyOn(stripe.billingPortal.sessions, 'create').mockResolvedValue({ url: 'https://billing.stripe.com/manage' } as never);

        await expect(service.checkout('alice')).resolves.toBe(status === 'active' ? 'https://billing.stripe.com/manage' : 'https://checkout.stripe.com/new');
        expect(create).toHaveBeenCalledTimes(status === 'active' ? 0 : 1);
        expect(store.account('alice').checkout_session_id).toBe(status === 'active' ? 'cs_pending' : 'cs_new');
    });

    it.each(['refresh', 'checkout', 'webhook'] as const)('records %s reconciliation failure and subsequent recovery in account health', async action => {
        await customer();
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        vi.spyOn(stripe.subscriptions, 'list').mockRejectedValueOnce(new Error('provider unavailable'))
            .mockResolvedValue({ data: [subscription()], has_more: false } as never);
        vi.spyOn(stripe.billingPortal.sessions, 'create').mockResolvedValue({ url: 'https://billing.stripe.com/manage' } as never);
        const event = { id: 'evt_health', type: 'invoice.paid', data: { object: { customer: 'cus_1' } } } as Stripe.Event;
        const reconcile = () => action === 'webhook' ? service.webhook(event) : service[action]('alice');

        await expect(reconcile()).rejects.toThrow('provider unavailable');
        expect(store.findAccount('alice')).toMatchObject({ last_reconciled_at: now, last_reconcile_outcome: 'failed' });
        now += 1000;
        await reconcile();
        expect(store.findAccount('alice')).toMatchObject({ last_reconciled_at: now, last_reconcile_outcome: 'ok' });
        expect(service.inspectAccount('alice').account).toMatchObject({ lastReconciledAt: now, lastReconcileOutcome: 'ok' });
    });

    it('leaves reconciliation health unset when the account has no Stripe customer', async () => {
        const list = vi.spyOn(stripe.subscriptions, 'list').mockRejectedValue(new Error('Unexpected Stripe request'));
        await service.refresh('alice');
        expect(list).not.toHaveBeenCalled();
        expect(store.findAccount('alice')).toMatchObject({ last_reconciled_at: 0, last_reconcile_outcome: null });
    });

    it.each(['canceled', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'trialing'])(
        'does not turn a paid invoice into hosted access for subscription status %s', async status => {
            await customer();
            store.db.prepare('UPDATE billing_accounts SET trial_ends_at = 0 WHERE user_id = ?').run('alice');
            vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [subscription(status)], has_more: false } as never);
            expect(await service.refresh('alice')).toMatchObject({ allowed: false, paidUntil: 0 });
        });

    it('holds duplicate live subscriptions and refuses a third checkout', async () => {
        await customer();
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ active: true, currency: 'usd', unit_amount: 4000, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } } as never);
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [subscription(), { ...subscription(), id: 'sub_duplicate' }], has_more: false } as never);
        expect(await service.refresh('alice')).toMatchObject({ state: 'review', allowed: false });
        await expect(service.checkout('alice')).rejects.toThrow('operator review');
    });

    it('fetches full invoice lines and refuses incomplete subscription or invoice proof', async () => {
        await customer();
        const current = subscription();
        const lines = current.latest_invoice.lines;
        current.latest_invoice.lines = { data: [], has_more: true };
        const list = vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [current], has_more: false } as never);
        const fullLines = vi.spyOn(stripe.invoices, 'listLineItems').mockResolvedValue(lines as never);
        expect(await service.refresh('alice')).toMatchObject({ state: 'active' });
        const paidUntil = store.status('alice').paidUntil;
        fullLines.mockResolvedValue({ ...lines, has_more: true } as never);
        await expect(service.refresh('alice')).rejects.toThrow('operator review');
        expect(store.status('alice').paidUntil).toBe(paidUntil);
        list.mockResolvedValue({ data: [current], has_more: true } as never);
        await expect(service.refresh('alice')).rejects.toThrow('operator review');
    });

    it('retries a failed event without acknowledging it or extending paid access', async () => {
        await customer();
        const list = vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [subscription()], has_more: false } as never);
        const paid = await service.refresh('alice');
        const event = { id: 'evt_retry', type: 'invoice.paid', data: { object: { customer: 'cus_1' } } } as Stripe.Event;
        list.mockRejectedValueOnce(new Error('provider unavailable'));
        await expect(service.webhook(event)).rejects.toThrow('provider unavailable');
        expect(store.processed(event.id)).toBe(false);
        expect(store.status('alice').paidUntil).toBe(paid.paidUntil);
        await service.webhook(event);
        expect(store.processed(event.id)).toBe(true);
        const calls = list.mock.calls.length;
        await service.webhook(event);
        expect(list).toHaveBeenCalledTimes(calls);
    });

    it.each(['charge.dispute.created', 'radar.early_fraud_warning.created'] as const)(
        'resolves %s through the charge customer, never metadata or a claimed user ID', async type => {
            await customer();
            await store.exclusive('bob', async token => store.update('bob', token, { customer_id: 'cus_bob' }));
            vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [subscription()], has_more: false } as never);
            vi.spyOn(stripe.charges, 'retrieve').mockResolvedValue({ id: 'ch_1', customer: 'cus_1' } as never);
            await service.webhook({ id: `evt_${type}`, type, data: { object: { charge: 'ch_1', customer: 'cus_bob', metadata: { user_id: 'bob' } } } } as unknown as Stripe.Event);
            expect(store.status('alice')).toMatchObject({ state: 'review', allowed: false });
            expect(store.status('bob')).toMatchObject({ state: 'trial', paidUntil: 0 });
            await service.refresh('alice');
            expect(store.status('alice').state).toBe('review');
        });

    it('ignores unknown customers and scopes portal sessions to the caller account', async () => {
        await customer();
        const reconcile = vi.spyOn(stripe.subscriptions, 'list');
        await service.webhook({ id: 'evt_foreign', type: 'checkout.session.completed', data: { object: { customer: 'cus_other', client_reference_id: 'alice', metadata: { user_id: 'alice' } } } } as unknown as Stripe.Event);
        expect(reconcile).not.toHaveBeenCalled();
        expect(store.status('alice').paidUntil).toBe(0);
        const portal = vi.spyOn(stripe.billingPortal.sessions, 'create').mockResolvedValue({ url: 'https://billing.stripe.com/p/test' } as never);
        await expect(service.portal('bob')).rejects.toThrow('No billing customer');
        await service.portal('alice');
        expect(portal).toHaveBeenCalledExactlyOnceWith({ customer: 'cus_1', return_url: 'https://or3.example/billing' });
    });

    it('preserves the checkout idempotency key after a lost response and replaces it only after expiry', async () => {
        await customer();
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ active: true, currency: 'usd', unit_amount: 4000, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } } as never);
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [], has_more: false } as never);
        const create = vi.spyOn(stripe.checkout.sessions, 'create').mockRejectedValueOnce(new Error('response lost'))
            .mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/test' } as never);
        const retrieve = vi.spyOn(stripe.checkout.sessions, 'retrieve').mockResolvedValue({ id: 'cs_1', status: 'open', url: 'https://checkout.stripe.com/c/test' } as never);
        await expect(service.checkout('alice')).rejects.toThrow('response lost');
        await service.checkout('alice');
        expect(create.mock.calls[1]?.[1]?.idempotencyKey).toBe(create.mock.calls[0]?.[1]?.idempotencyKey);
        retrieve.mockResolvedValue({ id: 'cs_1', status: 'expired' } as never);
        await service.checkout('alice');
        expect(create.mock.calls[2]?.[1]?.idempotencyKey).not.toBe(create.mock.calls[1]?.[1]?.idempotencyKey);
    });

    it('routes an incomplete subscription to its portal instead of creating another checkout', async () => {
        await customer();
        vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({ active: true, currency: 'usd', unit_amount: 4000, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } } as never);
        vi.spyOn(stripe.subscriptions, 'list').mockResolvedValue({ data: [subscription('incomplete', false)], has_more: false } as never);
        const create = vi.spyOn(stripe.checkout.sessions, 'create');
        vi.spyOn(stripe.billingPortal.sessions, 'create').mockResolvedValue({ url: 'https://billing.stripe.com/p/test' } as never);
        expect(await service.checkout('alice')).toBe('https://billing.stripe.com/p/test');
        expect(create).not.toHaveBeenCalled();
        expect(store.status('alice').paidUntil).toBe(0);
    });

    it('gates new hosted operations while preserving data retrieval, account recovery and job cancellation', () => {
        for (const path of ['/api/sync/pull', '/api/sync/snapshot', '/api/sync/push', '/api/storage/presign-upload', '/api/workspaces', '/api/plugins/new-feature']) {
            expect(requiresHostedAccess('POST', path)).toBe(true);
        }
        for (const path of ['/api/openrouter/stream', '/api/openrouter/title', '/api/openrouter/classify-memory', '/api/storage/presign-download', '/api/storage/commit', '/api/plugins/isolation/activation', '/api/plugins/isolation/capability', '/api/plugins/example/setup-values', '/api/billing/checkout', '/api/basic-auth/change-password', '/api/workspaces/active', '/api/jobs/job-1/abort']) {
            expect(requiresHostedAccess('POST', path)).toBe(false);
        }
        expect(requiresHostedAccess('GET', '/api/workspaces/backup')).toBe(false);
        expect(requiresHostedAccess('PUT', '/api/storage/fs/upload')).toBe(false);
        expect(requiresHostedAccess('DELETE', '/api/workspaces/ws-1')).toBe(false);
    });

    it('refuses insecure production redirects and ephemeral storage configuration', () => {
        const env = { OR3_BILLING_STRIPE_SECRET_KEY: 'sk_test_fixture', OR3_BILLING_STRIPE_WEBHOOK_SECRET: 'whsec_fixture', OR3_BILLING_STRIPE_PRICE_ID: 'price_year', OR3_BILLING_BASE_URL: 'https://or3.example', OR3_BILLING_SQLITE_PATH: '/data/billing.sqlite', OR3_SQLITE_DB_PATH: '/data/sync.sqlite' };
        expect(readBillingConfig(env).baseUrl).toBe('https://or3.example');
        expect(() => readBillingConfig({ ...env, OR3_BILLING_BASE_URL: 'http://public.example' })).toThrow();
        expect(() => readBillingConfig({ ...env, OR3_SQLITE_DB_PATH: ':memory:' })).toThrow();
    });
});
