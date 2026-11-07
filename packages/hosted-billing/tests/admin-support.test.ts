import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { BillingBusyError, BillingStore } from '../runtime/server/store';
import { BillingCommandError, BillingService } from '../runtime/server/service';

/*
 * Failure inventory written before the review/audit implementation (task 1.3):
 * - an admin read of a never-started account must not insert a billing row or trial decision;
 * - a legacy boolean hold must migrate to a visible, still-blocking review exactly once;
 * - an identical risk event redelivered after dedup retention must not reopen a resolved review;
 * - resolution needs a reason, the current revision and the exact open review set;
 * - a conflict discovered by the mandatory refresh must refuse the stale resolution;
 * - Stripe failure must keep the hold and record a failed outcome, never success;
 * - a repeated operation ID returns the original outcome; reuse for another command is refused;
 * - a busy account lease refuses the command without changing state;
 * - an audit write failure must roll back the review decision;
 * - resolving a hold never changes recorded payment dates.
 */

const PRICE = 'price_test';
const DAY = 86_400_000;
let dir: string;
let store: BillingStore;

function paidSubscription(id = 'sub_1', created = 1) {
    const start = Math.floor((Date.now() - DAY) / 1000);
    const end = start + 365 * 86_400;
    return {
        id, created, status: 'active', cancel_at_period_end: false, cancel_at: null, pause_collection: null,
        items: { data: [{ id: `si_${id}`, quantity: 1, price: { id: PRICE }, current_period_start: start, current_period_end: end }] },
        latest_invoice: {
            id: `in_${id}`, status: 'paid', customer: 'cus_1', parent: { subscription_details: { subscription: id } },
            lines: { has_more: false, data: [{
                quantity: 1, currency: 'usd', pricing: { price_details: { price: PRICE } }, period: { start, end },
                parent: { subscription_item_details: { subscription: id, subscription_item: `si_${id}`, proration: false } },
            }] },
        },
    };
}

function fakeStripe(state: { subscriptions: unknown[]; fail?: boolean; calls: number }) {
    return {
        subscriptions: { list: async () => {
            state.calls++;
            if (state.fail) throw new Error('stripe unavailable');
            return { data: state.subscriptions, has_more: false };
        } },
        charges: { retrieve: async () => ({ customer: 'cus_1' }) },
    } as unknown as Stripe;
}

function service(state: { subscriptions: unknown[]; fail?: boolean; calls: number }) {
    return new BillingService(store, fakeStripe(state), {
        secretKey: 'sk_test_x', webhookSecret: 'whsec_x', priceId: PRICE, baseUrl: 'http://localhost', databasePath: '', syncDatabasePath: '',
    });
}

function seedCustomer(userId = 'user-1', values: Record<string, unknown> = {}) {
    store.db.prepare('INSERT INTO billing_accounts (user_id, trial_ends_at, customer_id) VALUES (?, 0, ?)').run(userId, 'cus_1');
    const keys = Object.keys(values);
    if (keys.length) store.db.prepare(`UPDATE billing_accounts SET ${keys.map(key => `${key} = @${key}`).join(', ')} WHERE user_id = @user`).run({ ...values, user: userId });
}

function refundEvent(id: string, amount = 4000) {
    return { id, type: 'charge.refunded', data: { object: { id: 'ch_1', customer: 'cus_1', amount_refunded: amount } } } as unknown as Stripe.Event;
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'or3-billing-admin-'));
    store = new BillingStore(join(dir, 'billing.sqlite'));
});
afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
});

describe('admin inspection', () => {
    it('reads a never-started account without writing', () => {
        const svc = service({ subscriptions: [], calls: 0 });
        const inspection = svc.inspectAccount('never-started');
        expect(inspection.account).toBeNull();
        expect(inspection.access).toMatchObject({ allowed: false, source: 'none', blockers: ['cloud_not_started'] });
        expect(store.db.prepare('SELECT COUNT(*) AS n FROM billing_accounts').get()).toEqual({ n: 0 });
        expect(store.db.prepare('SELECT COUNT(*) AS n FROM billing_trial_decisions').get()).toEqual({ n: 0 });
    });

    it('migrates a legacy boolean hold to a visible blocking review once', () => {
        const path = join(dir, 'legacy.sqlite');
        const legacy = new Database(path);
        legacy.exec(`CREATE TABLE billing_accounts (
            user_id TEXT PRIMARY KEY, trial_ends_at INTEGER NOT NULL, customer_id TEXT UNIQUE, subscription_id TEXT,
            subscription_status TEXT NOT NULL DEFAULT '', paid_until INTEGER NOT NULL DEFAULT 0,
            cancel_at_period_end INTEGER NOT NULL DEFAULT 0, review_required INTEGER NOT NULL DEFAULT 0,
            checkout_attempt TEXT, checkout_session_id TEXT, lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0)`);
        legacy.prepare("INSERT INTO billing_accounts (user_id, trial_ends_at, review_required, paid_until, subscription_status) VALUES ('held', 0, 1, ?, 'active')").run(Date.now() + DAY);
        legacy.close();
        for (let i = 0; i < 2; i++) {
            const reopened = new BillingStore(path);
            const reviews = reopened.reviews('held');
            expect(reviews).toHaveLength(1);
            expect(reviews[0]).toMatchObject({ kind: 'legacy', resolvedAt: null });
            expect(reopened.status('held')).toMatchObject({ state: 'review', allowed: false });
            reopened.close();
        }
    });
});

describe('reviews and audited commands', () => {
    it('does not reopen a resolved review for an identical delayed risk event', async () => {
        seedCustomer('user-1', { subscription_id: 'sub_1', subscription_status: 'active' });
        const state = { subscriptions: [paidSubscription()], calls: 0 };
        const svc = service(state);
        await svc.webhook(refundEvent('evt_1'));
        const open = store.reviews('user-1').filter(review => !review.resolvedAt);
        expect(open).toHaveLength(1);
        const { revision } = svc.inspectAccount('user-1');
        await svc.resolveReviews('user-1', { operationId: 'op-resolve-1', actor: 'admin', reason: 'Refund was a duplicate charge', expectedRevision: revision, reviewIds: [open[0]!.id] });
        expect(store.status('user-1').state).toBe('active');
        store.db.prepare('DELETE FROM billing_events').run(); // dedup retention expired
        await svc.webhook(refundEvent('evt_1'));
        expect(store.status('user-1').state).toBe('active');
        // A different refund amount is new evidence and reopens a hold.
        await svc.webhook(refundEvent('evt_2', 2000));
        expect(store.status('user-1').state).toBe('review');
    });

    it('requires reason, current revision and the exact open review set', async () => {
        seedCustomer('user-1', { review_required: 1 });
        store.migrateLegacyReviews();
        const svc = service({ subscriptions: [], calls: 0 });
        const { revision } = svc.inspectAccount('user-1');
        const [review] = store.reviews('user-1');
        const base = { actor: 'admin', reason: 'Checked with customer', expectedRevision: revision, reviewIds: [review!.id] };
        await expect(svc.resolveReviews('user-1', { ...base, operationId: 'a', reason: ' ' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(svc.resolveReviews('user-1', { ...base, operationId: 'b', expectedRevision: revision - 1 })).rejects.toMatchObject({ statusCode: 409 });
        await expect(svc.resolveReviews('user-1', { ...base, operationId: 'c', reviewIds: [] })).rejects.toMatchObject({ statusCode: 409 });
        expect(store.status('user-1').state).toBe('review');
        const result = await svc.resolveReviews('user-1', { ...base, operationId: 'd' });
        expect(result.outcome).toBe('resolved');
        // A second administrator holding the old revision is refused.
        await expect(svc.resolveReviews('user-1', { ...base, operationId: 'e' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('refuses a stale resolution when the refresh discovers conflicting subscriptions', async () => {
        seedCustomer('user-1', { subscription_id: 'sub_1', subscription_status: 'active', review_required: 1 });
        store.migrateLegacyReviews();
        const state = { subscriptions: [paidSubscription('sub_1', 1), paidSubscription('sub_2', 2)], calls: 0 };
        const svc = service(state);
        const { revision } = svc.inspectAccount('user-1');
        const reviewIds = store.reviews('user-1').map(review => review.id);
        await expect(svc.resolveReviews('user-1', { operationId: 'x', actor: 'admin', reason: 'ok', expectedRevision: revision, reviewIds }))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(store.reviews('user-1').filter(review => !review.resolvedAt).map(review => review.kind).sort()).toEqual(['conflicting_subscriptions', 'legacy']);
        expect(store.status('user-1').state).toBe('review');
    });

    it('keeps the hold and records failure when Stripe refresh fails', async () => {
        const paidUntil = Date.now() + 30 * DAY;
        seedCustomer('user-1', { subscription_id: 'sub_1', subscription_status: 'active', paid_until: paidUntil, review_required: 1 });
        store.migrateLegacyReviews();
        const svc = service({ subscriptions: [], fail: true, calls: 0 });
        const { revision } = svc.inspectAccount('user-1');
        const reviewIds = store.reviews('user-1').map(review => review.id);
        await expect(svc.resolveReviews('user-1', { operationId: 'f', actor: 'admin', reason: 'ok', expectedRevision: revision, reviewIds }))
            .rejects.toMatchObject({ statusCode: 503 });
        expect(store.status('user-1')).toMatchObject({ state: 'review', paidUntil });
        expect(store.action('f')).toMatchObject({ outcome: 'failed' });
        const refresh = await svc.adminRefresh('user-1', { operationId: 'g', actor: 'admin' });
        expect(refresh.outcome).toBe('failed');
        expect(store.findAccount('user-1')).toMatchObject({ last_reconcile_outcome: 'failed', paid_until: paidUntil });
    });

    it('returns the original outcome for a repeated operation and refuses reuse', async () => {
        seedCustomer('user-1', { review_required: 1 });
        store.migrateLegacyReviews();
        const state = { subscriptions: [], calls: 0 };
        const svc = service(state);
        const { revision } = svc.inspectAccount('user-1');
        const reviewIds = store.reviews('user-1').map(review => review.id);
        const command = { operationId: 'same', actor: 'admin', reason: 'ok', expectedRevision: revision, reviewIds };
        const first = await svc.resolveReviews('user-1', command);
        const calls = state.calls;
        expect(await svc.resolveReviews('user-1', command)).toEqual(first);
        expect(state.calls).toBe(calls);
        await expect(svc.adminRefresh('user-1', { operationId: 'same', actor: 'admin' })).rejects.toMatchObject({ statusCode: 409 });
        expect(store.actions('user-1')).toHaveLength(1);
    });

    it('refuses a command while another holder owns the account lease', async () => {
        seedCustomer('user-1', { review_required: 1 });
        store.migrateLegacyReviews();
        store.db.prepare("UPDATE billing_accounts SET lock_token = 'other', lock_until = ? WHERE user_id = 'user-1'").run(Date.now() + 60_000);
        const svc = service({ subscriptions: [], calls: 0 });
        const { revision } = svc.inspectAccount('user-1');
        const reviewIds = store.reviews('user-1').map(review => review.id);
        await expect(svc.resolveReviews('user-1', { operationId: 'h', actor: 'admin', reason: 'ok', expectedRevision: revision, reviewIds }))
            .rejects.toBeInstanceOf(BillingBusyError);
        expect(store.status('user-1').state).toBe('review');
    });

    it('rolls back the decision when the audit record cannot be written', async () => {
        seedCustomer('user-1', { review_required: 1 });
        store.migrateLegacyReviews();
        store.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON billing_admin_actions WHEN NEW.outcome = 'resolved' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
        const svc = service({ subscriptions: [], calls: 0 });
        const { revision } = svc.inspectAccount('user-1');
        const reviewIds = store.reviews('user-1').map(review => review.id);
        await expect(svc.resolveReviews('user-1', { operationId: 'i', actor: 'admin', reason: 'ok', expectedRevision: revision, reviewIds })).rejects.toThrow();
        expect(store.status('user-1').state).toBe('review');
        expect(store.reviews('user-1').every(review => !review.resolvedAt)).toBe(true);
    });

    it('resolving a hold keeps confirmed payment dates', async () => {
        seedCustomer('user-1', { subscription_id: 'sub_1', subscription_status: 'active' });
        const svc = service({ subscriptions: [paidSubscription()], calls: 0 });
        await svc.webhook(refundEvent('evt_9'));
        const paidUntil = store.findAccount('user-1')!.paid_until;
        expect(paidUntil).toBeGreaterThan(Date.now());
        const { revision } = svc.inspectAccount('user-1');
        const reviewIds = store.reviews('user-1').filter(review => !review.resolvedAt).map(review => review.id);
        await svc.resolveReviews('user-1', { operationId: 'j', actor: 'admin', reason: 'ok', expectedRevision: revision, reviewIds });
        expect(store.findAccount('user-1')!.paid_until).toBe(paidUntil);
        expect(store.actions('user-1').map(action => action.kind)).toContain('resolve_review');
    });
});

it('exports a typed command error', () => {
    expect(new BillingCommandError(409, 'stale', 'x').statusCode).toBe(409);
});

/*
 * Stage B support-exception failure inventory (task 6.1), written before the support commands:
 * - a grant needs a future expiry and explicit storage, and never rewrites Stripe or trial facts;
 * - a grant is never presented as a paid state, and expires without a scheduler;
 * - review holds and hosted pauses always win over a grant or extension;
 * - a trial extension overrides a legitimate denial without changing the original decision or deadline,
 *   and is refused for an account with a live paid subscription;
 * - a storage bonus alone never grants access, and expires;
 * - an indefinite pause is distinct from no pause, and resume clears it;
 * - stale revisions are refused; repeated operation IDs are idempotent; every change is audited with its reason.
 */
describe('support exceptions', () => {
    const later = (days: number) => Date.now() + days * DAY;
    const command = (svc: BillingService, userId: string, operationId: string, body: Parameters<BillingService['supportCommand']>[1]['command'], reason = 'Support ticket 42') =>
        svc.supportCommand(userId, { operationId, actor: 'admin', reason, expectedRevision: svc.inspectAccount(userId).revision, command: body });

    it('grants revocable complimentary access without inventing payment', async () => {
        const svc = service({ subscriptions: [], calls: 0 });
        await expect(command(svc, 'never', 'g0', { kind: 'grant', expiresAt: Date.now() - 1, storageBytes: 1 })).rejects.toMatchObject({ statusCode: 400 });
        await expect(command(svc, 'never', 'g1', { kind: 'grant', expiresAt: later(10), storageBytes: 0 })).rejects.toMatchObject({ statusCode: 400 });
        await command(svc, 'never', 'g2', { kind: 'grant', expiresAt: later(10), storageBytes: 5_000_000_000 });
        expect(store.status('never')).toMatchObject({ state: 'grant', source: 'grant', allowed: true, storageLimitBytes: 5_000_000_000, paidUntil: 0, trialEndsAt: 0 });
        expect(store.db.prepare('SELECT COUNT(*) AS n FROM billing_trial_decisions').get()).toEqual({ n: 0 });
        expect(store.status('never', later(11))).toMatchObject({ allowed: false, state: 'expired' });
        await command(svc, 'never', 'g3', { kind: 'revoke_grant' });
        expect(store.status('never').allowed).toBe(false);
        expect(store.actions('never').map(action => [action.kind, action.reason])).toEqual(expect.arrayContaining([['grant', 'Support ticket 42'], ['revoke_grant', 'Support ticket 42']]));
    });

    it('lets review holds and pauses win over a grant', async () => {
        seedCustomer('user-1', { review_required: 1 });
        const svc = service({ subscriptions: [], calls: 0 });
        await command(svc, 'user-1', 'p1', { kind: 'grant', expiresAt: later(10), storageBytes: 1_000_000_000 });
        expect(svc.inspectAccount('user-1').access).toMatchObject({ allowed: false, source: 'grant', blockers: ['review_required'] });
        store.db.prepare('UPDATE billing_accounts SET review_required = 0').run();
        await command(svc, 'user-1', 'p2', { kind: 'pause_account', expiresAt: null });
        expect(svc.inspectAccount('user-1').support?.hostedPause).toMatchObject({ expiresAt: null });
        expect(store.status('user-1')).toMatchObject({ allowed: false, state: 'paused' });
        await command(svc, 'user-1', 'p3', { kind: 'resume_account' });
        expect(svc.inspectAccount('user-1').support?.hostedPause).toBeNull();
        expect(store.status('user-1').allowed).toBe(true);
    });

    it('extends a denied trial separately and refuses paid subscribers', async () => {
        store.claimTrial('first', 'a@example.test', '192.0.2.1');
        store.claimTrial('denied', 'b@example.test', '192.0.2.1');
        const decision = () => store.db.prepare("SELECT granted FROM billing_trial_decisions WHERE user_id = 'denied'").get();
        expect(decision()).toEqual({ granted: 0 });
        const svc = service({ subscriptions: [], calls: 0 });
        await command(svc, 'denied', 'e1', { kind: 'extend_trial', expiresAt: later(7) });
        expect(store.status('denied')).toMatchObject({ state: 'trial', source: 'support_trial', allowed: true, trialEndsAt: 0, storageLimitBytes: 1_000_000_000 });
        expect(decision()).toEqual({ granted: 0 });
        seedCustomer('payer', { subscription_status: 'active', subscription_id: 'sub_9', paid_until: later(100) });
        await expect(command(svc, 'payer', 'e2', { kind: 'extend_trial', expiresAt: later(7) })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('adds storage without granting access and expires the bonus', async () => {
        const svc = service({ subscriptions: [], calls: 0 });
        seedCustomer('user-1');
        await command(svc, 'user-1', 'b1', { kind: 'storage_bonus', bytes: 2_000_000_000, expiresAt: later(3) });
        expect(store.status('user-1')).toMatchObject({ allowed: false, storageLimitBytes: 0 });
        store.db.prepare("UPDATE billing_accounts SET trial_ends_at = ? WHERE user_id = 'user-1'").run(later(5));
        expect(store.status('user-1').storageLimitBytes).toBe(3_000_000_000);
        expect(store.status('user-1', later(4)).storageLimitBytes).toBe(1_000_000_000);
        await expect(command(svc, 'user-1', 'b2', { kind: 'storage_bonus', bytes: -1, expiresAt: null })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses stale revisions and replays repeated operations', async () => {
        const svc = service({ subscriptions: [], calls: 0 });
        seedCustomer('user-1');
        const revision = svc.inspectAccount('user-1').revision;
        const envelope = { operationId: 'r1', actor: 'admin', reason: 'ok', expectedRevision: revision, command: { kind: 'pause_account' as const, expiresAt: later(1) } };
        const first = await svc.supportCommand('user-1', envelope);
        expect(await svc.supportCommand('user-1', envelope)).toEqual(first);
        await expect(svc.supportCommand('user-1', { ...envelope, command: { ...envelope.command, expiresAt: envelope.command.expiresAt + 1000 } })).rejects.toMatchObject({ statusCode: 409 });
        await expect(svc.supportCommand('user-1', { ...envelope, operationId: 'r2' })).rejects.toMatchObject({ statusCode: 409 });
        expect(store.actions('user-1')).toHaveLength(1);
    });
});

/*
 * Stage C processing-outcome failure inventory (task 8.1), written before outcome persistence:
 * - a handler failure records a classified failure, increments attempts, and writes no dedup marker
 *   (Stripe can retry), and a later success on retry replaces it;
 * - a payment failure event that is processed correctly is a successful outcome of kind invoice.payment_failed,
 *   distinct from a processing failure;
 * - an event for an unknown customer is recorded as unmatched, never invents an account;
 * - a duplicate delivery after success does not add attempts;
 * - outcomes past the 30-day diagnostic window are pruned in bounded batches;
 * - records never include payloads or raw error text.
 */
describe('billing processing outcomes', () => {
    const event = (id: string, type: string, customer = 'cus_1') => ({ id, type, data: { object: { id: `obj_${id}`, customer } } }) as unknown as Stripe.Event;

    it('records failure without a dedup marker and replaces it on a successful retry', async () => {
        seedCustomer('user-1', { subscription_id: 'sub_1', subscription_status: 'active' });
        const state = { subscriptions: [paidSubscription()], fail: true, calls: 0 };
        const svc = service(state);
        await expect(svc.webhook(event('evt_f', 'customer.subscription.updated'))).rejects.toThrow();
        expect(store.processed('evt_f')).toBe(false);
        expect(store.outcomes({ limit: 10 })[0]).toMatchObject({ id: 'evt_f', kind: 'customer.subscription.updated', userId: 'user-1', result: 'failed', code: 'processing_error', attempts: 1 });
        state.fail = false;
        await svc.webhook(event('evt_f', 'customer.subscription.updated'));
        expect(store.outcomes({ limit: 10 })[0]).toMatchObject({ id: 'evt_f', result: 'succeeded', attempts: 2, code: null });
        await svc.webhook(event('evt_f', 'customer.subscription.updated'));
        expect(store.outcomes({ limit: 10 })[0]).toMatchObject({ attempts: 2 });
        expect(JSON.stringify(store.outcomes({ limit: 10 }))).not.toContain('stripe unavailable');
    });

    it('distinguishes payment failures, unmatched customers and admin refreshes', async () => {
        seedCustomer('user-1', { subscription_id: 'sub_1', subscription_status: 'active' });
        const svc = service({ subscriptions: [paidSubscription()], calls: 0 });
        await svc.webhook(event('evt_p', 'invoice.payment_failed'));
        await svc.webhook(event('evt_u', 'invoice.paid', 'cus_unknown'));
        await svc.adminRefresh('user-1', { operationId: 'refresh-outcome', actor: 'admin' });
        const byId = Object.fromEntries(store.outcomes({ limit: 10 }).map(outcome => [outcome.id, outcome]));
        expect(byId.evt_p).toMatchObject({ kind: 'invoice.payment_failed', result: 'succeeded' });
        expect(byId.evt_u).toMatchObject({ result: 'unmatched', userId: null });
        expect(byId['refresh-outcome']).toMatchObject({ kind: 'admin_refresh', result: 'succeeded', userId: 'user-1' });
        expect(store.db.prepare('SELECT COUNT(*) AS n FROM billing_accounts').get()).toEqual({ n: 1 });
    });

    it('prunes expired diagnostics in bounded batches', () => {
        const old = Date.now() - 31 * DAY;
        const insert = store.db.prepare("INSERT INTO billing_processing_outcomes VALUES (?, 'invoice.paid', NULL, 1, ?, ?, 'succeeded', NULL)");
        for (let i = 0; i < 150; i++) insert.run(`old_${i}`, old, old);
        store.recordOutcome({ id: 'new', kind: 'invoice.paid', userId: null, result: 'succeeded', code: null });
        expect((store.db.prepare('SELECT COUNT(*) AS n FROM billing_processing_outcomes').get() as { n: number }).n).toBe(51);
        store.recordOutcome({ id: 'new2', kind: 'invoice.paid', userId: null, result: 'succeeded', code: null });
        expect((store.db.prepare('SELECT COUNT(*) AS n FROM billing_processing_outcomes').get() as { n: number }).n).toBe(2);
    });
});
