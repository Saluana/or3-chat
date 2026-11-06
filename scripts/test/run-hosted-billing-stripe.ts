#!/usr/bin/env node
/** Explicit, test-mode-only Stripe API qualification. Never reads or writes host customer databases. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Stripe from '../../packages/hosted-billing/node_modules/stripe/esm/stripe.esm.node.js';
import { BillingStore } from '../../packages/hosted-billing/runtime/server/store';
import { BillingService } from '../../packages/hosted-billing/runtime/server/service';

const envPath = process.argv[process.argv.indexOf('--env') + 1];
if (!process.argv.includes('--env') || !envPath) throw new Error('Pass --env <private test-mode environment file>.');
const env = parseEnv(await readFile(resolve(envPath), 'utf8'));
const key = env.OR3_BILLING_STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(key)) throw new Error('This harness refuses live or missing Stripe keys.');
const stripe = new Stripe(key, { timeout: 15_000, maxNetworkRetries: 1 });
const price = await stripe.prices.retrieve(env.OR3_BILLING_STRIPE_PRICE_ID ?? '');
assert.equal(price.livemode, false);
const root = await mkdtemp(join(tmpdir(), 'or3-stripe-qualification-'));
const store = new BillingStore(join(root, 'billing.sqlite'));
const service = new BillingService(store, stripe, { secretKey: key, webhookSecret: 'whsec_local_signature_fixture',
    priceId: price.id, baseUrl: 'http://127.0.0.1:3000', databasePath: join(root, 'billing.sqlite'), syncDatabasePath: '' });
const report: Record<string, unknown> = { mode: 'test', startedAt: new Date().toISOString(), checks: [] };
const checks = report.checks as string[];
const output = resolve('output/hosted-billing/stripe-sandbox.json');
let clock: Stripe.TestHelpers.TestClock | undefined;
const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function advance(time: number) {
    await stripe.testHelpers.testClocks.advance(clock!.id, { frozen_time: time });
    for (let attempt = 0; attempt < 60; attempt++) {
        const state = await stripe.testHelpers.testClocks.retrieve(clock!.id);
        if (state.status === 'ready') return;
        if (state.status === 'internal_failure') throw new Error('Stripe test clock failed.');
        await delay(1000);
    }
    throw new Error('Stripe test clock did not become ready within 60 seconds.');
}
try {
    await service.validatePrice(); pass('configured annual price');
    clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: 'OR3 disposable billing qualification' });
    const customer = await stripe.customers.create({ test_clock: clock.id, payment_method: 'pm_card_visa',
        invoice_settings: { default_payment_method: 'pm_card_visa' }, metadata: { purpose: 'or3_disposable_qualification' } });
    await store.exclusive('fixture', async token => store.update('fixture', token, { customer_id: customer.id }));
    const checkout = await service.checkout('fixture');
    assert.match(checkout, /^https:\/\/checkout\.stripe\.com\//);
    assert.equal(store.status('fixture').state, 'trial'); pass('real Checkout creation grants no paid access');
    assert.equal(await service.checkout('fixture'), checkout); pass('open Checkout is reused');
    const parallel = await Promise.allSettled([service.checkout('fixture'), service.checkout('fixture')]);
    assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(store.account('fixture').checkout_session_id, (await stripe.checkout.sessions.list({ customer: customer.id, limit: 10 })).data[0]!.id);
    pass('parallel Checkout requests cannot create duplicates');
    const pending = store.account('fixture').checkout_session_id;
    if (pending) await stripe.checkout.sessions.expire(pending);
    assert.notEqual(await service.checkout('fixture'), checkout);
    await stripe.checkout.sessions.expire(store.account('fixture').checkout_session_id!);
    pass('expired Checkout can be replaced');
    // API-created test payment exercises real invoice schemas; it is not a Checkout UI purchase.
    let sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }], payment_behavior: 'error_if_incomplete' });
    let status = await service.refresh('fixture');
    assert.equal(status.state, 'active'); assert.equal(status.paidUntil, sub.items.data[0]!.current_period_end * 1000);
    const firstEnd = status.paidUntil; pass('real paid invoice grants its matching period');
    assert.match(await service.checkout('fixture'), /^https:\/\/billing\.stripe\.com\//);
    assert.equal((await stripe.subscriptions.list({ customer: customer.id, status: 'all' })).data.length, 1);
    pass('subscribed account is sent to portal without a duplicate subscription');
    assert.match(await service.portal('fixture'), /^https:\/\/billing\.stripe\.com\//); pass('customer portal session');
    await advance(sub.items.data[0]!.current_period_end + 5);
    status = await service.refresh('fixture');
    assert.equal(status.paidUntil, firstEnd);
    assert.equal(store.status('fixture', firstEnd + 1000).allowed, true); pass('real draft renewal keeps bounded grace');
    await advance(sub.items.data[0]!.current_period_end + 3700);
    status = await service.refresh('fixture'); assert.ok(status.paidUntil > firstEnd); pass('real paid renewal extends access');
    sub = await stripe.subscriptions.retrieve(sub.id);
    const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: customer.id });
    await stripe.subscriptions.update(sub.id, { default_payment_method: failing.id });
    const renewalEnd = status.paidUntil;
    await advance(sub.items.data[0]!.current_period_end + 3700);
    // Test clocks can create draft invoices before scheduling finalization; advance a second hour.
    sub = await stripe.subscriptions.retrieve(sub.id);
    await advance(Math.floor(renewalEnd / 1000) + 7400);
    status = await service.refresh('fixture');
    assert.equal(status.paidUntil, renewalEnd);
    assert.equal(store.status('fixture', renewalEnd + 7_400_000).allowed, false); pass('failed renewal does not grant another year');
    const healthy = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
    await stripe.subscriptions.update(sub.id, { default_payment_method: healthy.id });
    sub = await stripe.subscriptions.retrieve(sub.id);
    const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice!.id;
    await stripe.invoices.pay(invoiceId, { payment_method: healthy.id });
    status = await service.refresh('fixture'); assert.ok(status.paidUntil > renewalEnd); pass('paid retry restores the correct period');
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    status = await service.refresh('fixture'); assert.equal(status.cancelAtPeriodEnd, true); assert.equal(status.allowed, true); pass('scheduled cancellation retains paid access');
    await stripe.subscriptions.cancel(sub.id);
    assert.equal((await service.refresh('fixture')).allowed, false); pass('immediate cancellation revokes access');
    const charges = await stripe.charges.list({ customer: customer.id, limit: 10 });
    const charge = charges.data.find(charge => charge.paid && !charge.refunded && charge.amount >= 100);
    assert.ok(charge, 'Expected a disposable paid test charge');
    await stripe.refunds.create({ charge: charge.id, amount: 100 });
    let refundEvent: Stripe.Event | undefined;
    for (let attempt = 0; attempt < 15 && !refundEvent; attempt++) {
        const events = await stripe.events.list({ type: 'charge.refunded', limit: 25 });
        refundEvent = events.data.find(event => event.type === 'charge.refunded' && event.data.object.id === charge.id);
        if (!refundEvent) await delay(1000);
    }
    assert.ok(refundEvent, 'Stripe did not publish the refund event');
    await service.webhook(refundEvent);
    assert.equal(store.status('fixture').state, 'review');
    await service.webhook(refundEvent);
    await service.refresh('fixture');
    assert.equal(store.status('fixture').state, 'review'); pass('real partial refund event is idempotent and holds account for review');
    assert.equal(store.status('unrelated').state, 'trial'); pass('refund leaves another account unaffected');

    for (const method of ['pm_card_chargeCustomerFail', 'pm_card_authenticationRequired']) {
        const user = `initial-${method}`;
        const failedCustomer = await stripe.customers.create({ test_clock: clock.id });
        const paymentMethod = await stripe.paymentMethods.attach(method, { customer: failedCustomer.id });
        await store.exclusive(user, async token => store.update(user, token, { customer_id: failedCustomer.id }));
        store.db.prepare('UPDATE billing_accounts SET trial_ends_at = 0 WHERE user_id = ?').run(user);
        const incomplete = await stripe.subscriptions.create({ customer: failedCustomer.id, items: [{ price: price.id }],
            default_payment_method: paymentMethod.id, payment_behavior: 'default_incomplete' });
        assert.equal(incomplete.status, 'incomplete');
        assert.equal((await service.refresh(user)).allowed, false);
        assert.equal(store.status(user).paidUntil, 0);
        pass(`${method === 'pm_card_authenticationRequired' ? 'authentication-required' : 'declined'} initial payment grants no paid access`);
        await stripe.subscriptions.cancel(incomplete.id);
    }
    report.success = true;
} catch (error) {
    report.success = false;
    report.error = error instanceof assert.AssertionError ? error.message : (error as { code?: string }).code || (error as Error).name;
    console.error('Stripe qualification failed:', report.error);
    process.exitCode = 1;
} finally {
    store.close();
    try { if (clock) { await stripe.testHelpers.testClocks.del(clock.id); report.fixturesRemoved = true; } }
    catch { report.success = false; report.fixturesRemoved = false; report.cleanupClockId = clock?.id; process.exitCode = 1; }
    await rm(root, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    await mkdir(resolve('output/hosted-billing'), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
