import Stripe from 'stripe';
import { createHash, randomUUID } from 'node:crypto';
import { BillingAccountMissingError, BillingBusyError, BillingCommandError, BillingStore, type BillingAccount, type BillingOffer, type OfferCommand, type SupportCommand } from './store';
import type { BillingSettings } from '../types';
import type { BillingConfig } from './config';
import { evaluateAccess } from './entitlement';
import { isPaused } from '../../../../server/admin/pauses';

export { BillingCommandError };

const REASON_MAX = 500;
function requireReason(reason: unknown): string {
    const value = typeof reason === 'string' ? reason.trim() : '';
    if (!value || value.length > REASON_MAX) throw new BillingCommandError(400, 'invalid_reason', `Enter a reason between 1 and ${REASON_MAX} characters.`);
    return value;
}

const MAX_BYTES = 1_000_000_000_000_000;
const YEAR_MS = 366 * 86_400_000;
function validateSupportCommand(command: SupportCommand, now: number) {
    const invalid = (message: string) => new BillingCommandError(400, 'invalid_command', message);
    const future = (value: unknown, max = YEAR_MS) => Number.isSafeInteger(value) && (value as number) > now && (value as number) <= now + max;
    switch (command.kind) {
        case 'grant':
            if (!future(command.expiresAt)) throw invalid('Choose an expiry within the next year.');
            if (!Number.isSafeInteger(command.storageBytes) || command.storageBytes < 1 || command.storageBytes > MAX_BYTES) throw invalid('Choose an explicit storage allowance.');
            return;
        case 'extend_trial':
            if (!future(command.expiresAt, 90 * 86_400_000)) throw invalid('Choose a trial end within the next 90 days.');
            return;
        case 'storage_bonus':
            if (!Number.isSafeInteger(command.bytes) || command.bytes < 0 || command.bytes > MAX_BYTES) throw invalid('Enter a non-negative number of bytes.');
            if (command.expiresAt !== null && !future(command.expiresAt)) throw invalid('Choose a future expiry or no expiry.');
            return;
        case 'pause_account': case 'pause_uploads': case 'pause_jobs':
            if (command.expiresAt !== null && !future(command.expiresAt)) throw invalid('Choose a future expiry or no expiry.');
            return;
        case 'revoke_grant': case 'resume_account': case 'resume_uploads': case 'resume_jobs':
            return;
        default:
            throw invalid('Unknown support command.');
    }
}

/** Support-safe account fields. No lease tokens, checkout attempts or payment payloads. */
function accountView(account: BillingAccount) {
    return {
        customerId: account.customer_id, subscriptionId: account.subscription_id, subscriptionStatus: account.subscription_status,
        paidUntil: account.paid_until, renewalGraceUntil: account.renewal_grace_until, cancelAtPeriodEnd: Boolean(account.cancel_at_period_end),
        trialEndsAt: account.trial_ends_at, reviewRequired: Boolean(account.review_required),
        lastReconciledAt: account.last_reconciled_at || null, lastReconcileOutcome: account.last_reconcile_outcome,
    };
}

function id(value: string | { id: string } | null | undefined): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
}

export class BillingService {
    constructor(readonly store: BillingStore, readonly stripe: Stripe, readonly config: BillingConfig, private usedBytes?: (userId: string) => number) {
        this.store.ensureOffer(config.priceId);
        if (this.store.currentOffer()?.priceId !== config.priceId) {
            console.warn('[hosted-billing] OR3_BILLING_STRIPE_PRICE_ID is a bootstrap value and differs from the saved current offer. Manage offers in the admin panel.');
        }
    }

    /** Charged account bytes, or null when accounting cannot be read (never reported as zero). */
    storageUsedBytes(userId: string): number | null {
        if (!this.usedBytes) return null;
        try { return this.usedBytes(userId); } catch { return null; }
    }

    /** Compact, read-only access summary for directory rows. */
    summarize(userId: string, now = Date.now()) {
        const account = this.store.findAccount(userId);
        const { state, access } = evaluateAccess(account, this.store.accountSettings(account), now, account ? this.store.support(userId) : null);
        return {
            userId, state: account ? state : 'cloud_not_started' as const, access,
            paidUntil: account?.paid_until ?? 0, trialEndsAt: account?.trial_ends_at ?? 0,
            subscriptionStatus: account?.subscription_status ?? '', reviewRequired: Boolean(account?.review_required),
            storageUsedBytes: account ? this.storageUsedBytes(userId) : 0,
        };
    }

    status(userId: string) {
        return { ...this.store.status(userId), storageUsedBytes: this.usedBytes?.(userId) ?? 0 };
    }

    async validatePrice(offer: Pick<BillingOffer, 'priceId' | 'amountCents' | 'currency' | 'interval'> = this.store.currentOffer()!) {
        const price = await this.stripe.prices.retrieve(offer.priceId);
        if (!price.active || price.currency !== offer.currency || price.unit_amount !== offer.amountCents ||
            price.type !== 'recurring' || price.recurring?.interval !== offer.interval ||
            price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' || price.billing_scheme !== 'per_unit' ||
            price.transform_quantity != null) {
            throw new BillingCommandError(400, 'invalid_price', `The Stripe price must match the active fixed USD $${offer.amountCents / 100}/year offer.`);
        }
    }

    /** Explicitly accept a new checkout offer; existing subscribers and trials stay in their cohorts. */
    async changeOffer(input: { operationId: string; actor: string; reason: string; expectedRevision: number; command: OfferCommand }) {
        const reason = requireReason(input.reason);
        const commandHash = createHash('sha256').update(JSON.stringify(input.command)).digest('hex');
        const previous = this.idempotent(input.operationId, '__deployment__', 'offer_change');
        if (previous) {
            if (previous.after?.commandHash !== commandHash) throw new BillingCommandError(409, 'operation_reused', 'This operation ID belongs to another offer change.');
            return this.store.offers();
        }
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new BillingCommandError(400, 'invalid_command', 'Invalid offer revision.');
        const command = input.command;
        if (command.kind === 'create_current') {
            if (!/^price_[A-Za-z0-9_]{1,190}$/.test(command.priceId) ||
                !Number.isSafeInteger(command.amountCents) || command.amountCents < 1 || command.amountCents > 100_000_000 ||
                ![command.paidStorageGb, command.trialStorageGb].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000) ||
                !Number.isSafeInteger(command.trialDays) || command.trialDays < 1 || command.trialDays > 90) {
                throw new BillingCommandError(400, 'invalid_command', 'Enter a valid annual price, storage allowances and trial duration.');
            }
            await this.validatePrice({ ...command, currency: 'usd', interval: 'year' });
        }
        return this.store.commitOffer({ ...input, reason, commandHash });
    }

    /** Current-cohort allowance save and audit share one SQLite transaction. */
    changeAllowances(input: { operationId: string; actor: string; reason: string; settings: BillingSettings }) {
        const reason = requireReason(input.reason);
        const commandHash = createHash('sha256').update(JSON.stringify(input.settings)).digest('hex');
        const previous = this.idempotent(input.operationId, '__deployment__', 'allowance_change');
        if (previous) {
            if (previous.after?.commandHash !== commandHash) throw new BillingCommandError(409, 'operation_reused', 'This operation ID belongs to another allowance change.');
            return this.store.settings();
        }
        return this.store.commitSettings(input.settings, { ...input, reason, commandHash });
    }

    /** Returns whether more than one live subscription matches the offer. */
    private async reconcileLocked(userId: string, token: string): Promise<{ conflict: boolean }> {
        const account = this.store.account(userId);
        if (!account.customer_id) return { conflict: false };
        try {
            const result = await this.reconcileCustomerLocked(account, token);
            this.store.recordReconcile(userId, token, 'ok');
            return result;
        } catch (error) {
            if (!(error instanceof BillingBusyError)) this.store.recordReconcile(userId, token, 'failed');
            throw error;
        }
    }

    private async reconcileCustomerLocked(account: BillingAccount, token: string): Promise<{ conflict: boolean }> {
        const userId = account.user_id;
        // Retrieve current state, not event payloads: delayed/out-of-order webhooks cannot restore old access.
        const subscriptions = await this.stripe.subscriptions.list({ customer: account.customer_id!, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
        if (subscriptions.has_more) throw new Error('Billing subscription history requires operator review.');
        const offers = this.store.offers().items;
        const live = subscriptions.data.filter(sub => !['canceled', 'incomplete_expired'].includes(sub.status));
        const review = (kind: 'conflicting_subscriptions' | 'ambiguous_offer' | 'unknown_offer') => {
            this.store.openReview(userId, token, kind, `${kind}:${subscriptions.data.map(sub => sub.id + ':' + sub.items.data.map(item => item.price.id).sort().join(',')).sort().join(';')}`);
            return { conflict: true };
        };
        if (live.length > 1) return review('conflicting_subscriptions');
        if (!live.length && subscriptions.data.length) {
            this.store.update(userId, token, { subscription_status: 'canceled', renewal_grace_until: 0 });
            return { conflict: false };
        }
        const subscription = live[0] ?? subscriptions.data.sort((a, b) => b.created - a.created)[0];
        if (!subscription) {
            if (account.subscription_id) this.store.update(userId, token, { subscription_status: 'canceled', paid_until: 0, renewal_grace_until: 0 });
            return { conflict: false };
        }
        if (subscription.items.has_more || subscription.items.data.length !== 1) return review('ambiguous_offer');
        const item = subscription.items.data[0]!;
        const offer = offers.find(offer => offer.priceId === item.price.id);
        if (!offer) return review('unknown_offer');
        let invoice = subscription.latest_invoice;
        if (typeof invoice === 'string') invoice = await this.stripe.invoices.retrieve(invoice);
        const currentEnd = item.current_period_end * 1000;
        // A paid invoice is evidence only for its own service period. The latest
        // invoice can be unrelated to the newly advanced item period.
        let lines = invoice?.lines;
        if (invoice && lines?.has_more) lines = await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 });
        if (lines?.has_more) throw new Error('Billing invoice requires operator review.');
        const coversPeriod = Boolean(invoice && id(invoice.customer) === account.customer_id &&
            id(invoice.parent?.subscription_details?.subscription) === subscription.id &&
            lines?.data.some(line => {
                const parent = line.parent?.subscription_item_details;
                return parent?.subscription === subscription.id && parent.subscription_item === item.id &&
                    parent.proration === false && line.quantity === 1 && line.currency === offer.currency &&
                    line.pricing?.price_details?.price === offer.priceId &&
                    Number.isSafeInteger(line.period.start) && Number.isSafeInteger(line.period.end) &&
                    line.period.end > line.period.start &&
                    line.period.start === item.current_period_start && line.period.end === item.current_period_end;
            }));
        const paid = subscription.status === 'active' && invoice?.status === 'paid' && item.quantity === 1 && coversPeriod;
        const previousEnd = account.subscription_id === subscription.id ? account.paid_until : 0;
        // Renewal invoices are drafted before collection. Keep a bounded grace
        // anchored to the LAST PAID period, never to the time of this request.
        const renewing = !paid && coversPeriod && previousEnd > 0 && subscription.status === 'active' &&
            !subscription.pause_collection && !subscription.cancel_at_period_end && subscription.cancel_at == null &&
            item.quantity === 1 && item.current_period_start * 1000 === previousEnd &&
            invoice?.billing_reason === 'subscription_cycle' && invoice.auto_advance &&
            (invoice.status === 'draft' || invoice.status === 'open') && invoice.attempt_count === 0;
        this.store.update(userId, token, {
            renewal_grace_until: renewing ? Math.min(currentEnd, previousEnd + 24 * 3600_000) : 0,
            subscription_id: subscription.id,
            matched_offer_id: offer.id,
            subscription_status: subscription.status,
            paid_until: paid ? currentEnd : Math.min(previousEnd, currentEnd),
            cancel_at_period_end: subscription.cancel_at_period_end || subscription.cancel_at !== null ? 1 : 0,
        });
        return { conflict: false };
    }

    async refresh(userId: string) {
        await this.store.exclusive(userId, token => this.reconcileLocked(userId, token));
        return this.status(userId);
    }

    async checkout(userId: string): Promise<string> {
        return this.store.exclusive(userId, async token => {
            // An operator purchase pause stops creating or handing out Checkout sessions.
            // Sessions already opened can still complete at Stripe; their webhooks are processed normally.
            if (await isPaused('purchases')) throw new BillingCommandError(503, 'service_paused', 'New purchases are paused. Existing subscriptions and billing management are unaffected.');
            if (this.store.account(userId).review_required) throw new Error('Billing requires operator review.');
            let account = this.store.account(userId);
            let offer = account.checkout_attempt && account.checkout_offer_id
                ? this.store.offers().items.find(offer => offer.id === account.checkout_offer_id)!
                : this.store.currentOffer()!;
            if (!account.customer_id) {
                await this.validatePrice(offer);
                const customer = await this.stripe.customers.create({}, {
                    idempotencyKey: `or3-customer-${createHash('sha256').update(userId).digest('hex')}`,
                });
                this.store.update(userId, token, { customer_id: customer.id });
            }
            await this.reconcileLocked(userId, token);
            account = this.store.account(userId);
            if (account.review_required) throw new Error('Billing requires operator review.');
            if (account.subscription_id && !['canceled', 'incomplete_expired'].includes(account.subscription_status)) {
                return this.portal(userId);
            }
            if (account.checkout_attempt && !account.checkout_session_id) {
                // The create response was lost, so Stripe may already hold a session under this
                // key. Recover its ID, then retrieve current state rather than redirecting to
                // the cached creation response, which may now describe an expired session.
                try { await this.createCheckoutSession(userId, token, account.customer_id!, offer, account.checkout_attempt); }
                catch (error) {
                    // A refused request (for example an archived price) created no session under this key.
                    // Transient and idempotency failures keep the attempt for the next retry.
                    if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) throw error;
                    this.store.update(userId, token, { checkout_attempt: null, checkout_offer_id: null });
                    offer = this.store.currentOffer()!;
                }
                account = this.store.account(userId);
            }
            if (account.checkout_session_id) {
                const previous = await this.stripe.checkout.sessions.retrieve(account.checkout_session_id);
                if (previous.status === 'open') {
                    if (!previous.url) throw new Error('Stripe did not return a Checkout URL.');
                    return previous.url;
                }
                if (previous.status === 'complete') {
                    // Stripe can complete Checkout after the earlier subscription snapshot.
                    // Only a terminal subscription belonging to THIS session permits a retry.
                    const subscriptionId = id(previous.subscription);
                    if (!subscriptionId) return this.portal(userId);
                    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
                    if (!['canceled', 'incomplete_expired'].includes(subscription.status)) return this.portal(userId);
                } else if (previous.status !== 'expired') {
                    throw new Error('Checkout is still updating. Try again shortly.');
                }
                this.store.update(userId, token, { checkout_attempt: null, checkout_session_id: null, checkout_offer_id: null });
                account = this.store.account(userId);
                offer = this.store.currentOffer()!;
            }
            await this.validatePrice(offer);
            // No await between choosing the current revision and persisting the attempt.
            if (offer.id !== this.store.currentOffer()!.id) throw new BillingCommandError(409, 'offer_changed', 'The offer changed. Try again.');
            const attempt = randomUUID();
            this.store.update(userId, token, { checkout_attempt: attempt, checkout_offer_id: offer.id });
            const session = await this.createCheckoutSession(userId, token, account.customer_id!, offer, attempt);
            if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
            return session.url;
        });
    }

    /** Creates, or with a reused attempt key replays, one Checkout session and records it. */
    private async createCheckoutSession(userId: string, token: string, customer: string, offer: BillingOffer, attempt: string): Promise<Stripe.Checkout.Session> {
        const session = await this.stripe.checkout.sessions.create({
            mode: 'subscription', customer,
            line_items: [{ price: offer.priceId, quantity: 1 }],
            success_url: `${this.config.baseUrl}/billing?checkout=success`,
            cancel_url: `${this.config.baseUrl}/billing`,
            // The free trial lives in OR3. Choosing Subscribe charges the annual price now.
            integration_identifier: `or3_hosted_${createHash('sha256').update(attempt).digest('hex').slice(0, 8).replace(/[0-9]/g, c => String.fromCharCode(97 + Number(c)))}`,
        }, { idempotencyKey: `or3-checkout-${attempt}` });
        this.store.update(userId, token, { checkout_session_id: session.id });
        return session;
    }

    async portal(userId: string): Promise<string> {
        const customer = this.store.account(userId).customer_id;
        if (!customer) throw new Error('No billing customer exists yet.');
        const session = await this.stripe.billingPortal.sessions.create({ customer, return_url: `${this.config.baseUrl}/billing` });
        return session.url;
    }

    /** Read-only support projection. Never provisions, claims a trial, leases or calls Stripe. */
    inspectAccount(userId: string, now = Date.now()) {
        const account = this.store.findAccount(userId);
        const support = account ? this.store.support(userId) : null;
        const { state, access } = evaluateAccess(account, this.store.accountSettings(account), now, support);
        const decision = this.store.db.prepare('SELECT granted FROM billing_trial_decisions WHERE user_id = ?').get(userId) as { granted: number } | undefined;
        const openIds = account ? this.store.openReviewIds(userId) : [];
        const reviews = account ? this.store.reviews(userId) : [];
        return {
            userId, state, access, revision: account?.admin_revision ?? 0,
            account: account ? accountView(account) : null,
            trial: { decision: decision ? (decision.granted ? 'granted' as const : 'denied' as const) : 'none' as const, endsAt: account?.trial_ends_at || null },
            support,
            reviews: openIds[0] === 'legacy-unrecorded'
                ? [{ id: openIds[0], kind: 'legacy' as const, openedAt: 0, resolvedAt: null, resolvedBy: null, resolutionReason: null }, ...reviews]
                : reviews,
            openReviewIds: openIds,
            actions: account ? this.store.actions(userId) : [],
            settings: this.store.accountSettings(account),
            matchedOffer: account ? this.store.offers().items.find(offer => offer.id === account.matched_offer_id) ?? null : null,
        };
    }

    private idempotent(operationId: string, userId: string, kind: string) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(operationId)) throw new BillingCommandError(400, 'invalid_operation', 'Invalid operation ID.');
        const previous = this.store.action(operationId);
        if (!previous) return null;
        if (previous.userId !== userId || previous.kind !== kind) throw new BillingCommandError(409, 'operation_reused', 'This operation ID belongs to another command.');
        return previous;
    }

    /** Targeted reconciliation through the existing service, lease and timeout handling. */
    async adminRefresh(userId: string, input: { operationId: string; actor: string }) {
        const previous = this.idempotent(input.operationId, userId, 'refresh');
        if (previous) return previous.after as { outcome: string; revision: number };
        if (!this.store.findAccount(userId)) return { outcome: 'cloud_not_started', revision: 0 };
        const result = await this.store.exclusive(userId, async token => {
            const before = this.store.findAccount(userId)!;
            if (!before.customer_id) return { outcome: 'no_customer', code: null };
            try {
                await this.reconcileLocked(userId, token);
                return { outcome: 'refreshed', code: null };
            } catch (error) {
                if (error instanceof BillingBusyError) throw error;
                return { outcome: 'failed', code: 'stripe_unavailable' };
            }
        }, { existingOnly: true });
        const revision = this.store.findAccount(userId)!.admin_revision;
        const after = { outcome: result.outcome, revision };
        this.store.recordOutcome({ id: input.operationId, kind: 'admin_refresh', userId, result: result.outcome === 'refreshed' ? 'succeeded' : result.outcome === 'failed' ? 'failed' : 'skipped', code: result.code });
        this.store.recordAction({ operationId: input.operationId, userId, actor: input.actor, kind: 'refresh', reason: null, outcome: result.outcome, code: result.code, before: null, after });
        return after;
    }

    /**
     * Refresh current Stripe facts, then resolve exactly the reviewed open set.
     * A new review, changed facts or live conflicting subscriptions refuse the stale decision.
     */
    async resolveReviews(userId: string, input: { operationId: string; actor: string; reason: string; expectedRevision: number; reviewIds: string[] }) {
        const reason = requireReason(input.reason);
        const previous = this.idempotent(input.operationId, userId, 'resolve_review');
        if (previous) {
            if (previous.outcome !== 'resolved') throw new BillingCommandError(409, 'operation_failed', 'This decision already failed. Review the account and start again.');
            return { outcome: 'resolved' as const, revision: Number(previous.after?.revision) };
        }
        if (!Number.isSafeInteger(input.expectedRevision) || !Array.isArray(input.reviewIds)) throw new BillingCommandError(400, 'invalid_command', 'Invalid review decision.');
        try {
            return await this.store.exclusive(userId, async token => {
                const stale = () => new BillingCommandError(409, 'stale_revision', 'This account changed. Review the current state before deciding.');
                if (this.store.findAccount(userId)!.admin_revision !== input.expectedRevision) throw stale();
                let conflict: boolean;
                try {
                    ({ conflict } = await this.reconcileLocked(userId, token));
                } catch (error) {
                    if (error instanceof BillingBusyError) throw error;
                    this.store.recordAction({ operationId: input.operationId, userId, actor: input.actor, kind: 'resolve_review', reason, outcome: 'failed', code: 'refresh_failed', before: null, after: null });
                    throw new BillingCommandError(503, 'refresh_failed', 'Stripe could not be refreshed. The hold remains in place.');
                }
                if (conflict) throw new BillingCommandError(409, 'conflicting_subscriptions', 'Subscription prices are unknown or ambiguous. Resolve the Stripe subscription before clearing this hold.');
                const revision = this.store.commitReviewResolution(userId, token, { ...input, reason });
                return { outcome: 'resolved' as const, revision };
            }, { existingOnly: true });
        } catch (error) {
            if (error instanceof BillingAccountMissingError) throw new BillingCommandError(404, 'cloud_not_started', error.message);
            throw error;
        }
    }

    /** Explicit, revisioned and audited support exception. Never calls Stripe. */
    async supportCommand(userId: string, input: { operationId: string; actor: string; reason: string; expectedRevision: number; command: SupportCommand }) {
        const reason = requireReason(input.reason);
        const commandHash = createHash('sha256').update(JSON.stringify(input.command)).digest('hex');
        const previous = this.idempotent(input.operationId, userId, input.command.kind);
        if (previous) {
            if (previous.after?.commandHash !== commandHash) throw new BillingCommandError(409, 'operation_reused', 'This operation ID belongs to another support command.');
            return { outcome: 'applied' as const, revision: Number(previous.after.revision) };
        }
        validateSupportCommand(input.command, Date.now());
        if (!Number.isSafeInteger(input.expectedRevision)) throw new BillingCommandError(400, 'invalid_command', 'Invalid support command.');
        const revision = await this.store.exclusive(userId, async token => this.store.commitSupport(userId, token, { ...input, reason, commandHash }));
        return { outcome: 'applied' as const, revision };
    }

    verifyWebhook(body: Buffer, signature: string): Stripe.Event {
        return this.stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret);
    }

    async webhook(event: Stripe.Event) {
        if (this.store.processed(event.id)) return;
        let customer: string | null = null;
        let review: { kind: 'refund' | 'dispute' | 'fraud_warning'; source: string } | null = null;
        switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
            case 'customer.subscription.paused':
            case 'customer.subscription.resumed':
            case 'invoice.paid':
            case 'invoice.payment_failed':
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded':
            case 'checkout.session.async_payment_failed':
                customer = id(event.data.object.customer);
                break;
            case 'charge.refunded':
                customer = id(event.data.object.customer);
                // The refunded total identifies this evidence: redeliveries match, a further refund does not.
                review = { kind: 'refund', source: `refund:${event.data.object.id}:${event.data.object.amount_refunded}` };
                break;
            case 'charge.dispute.created':
            case 'radar.early_fraud_warning.created': {
                const chargeId = id(event.data.object.charge);
                if (chargeId) customer = id((await this.stripe.charges.retrieve(chargeId)).customer);
                review = event.type === 'charge.dispute.created'
                    ? { kind: 'dispute', source: `dispute:${event.data.object.id}` }
                    : { kind: 'fraud_warning', source: `fraud_warning:${event.data.object.id}` };
                break;
            }
            default: return;
        }
        // Customers are created exclusively by this module and mapped to canonical OR3 user IDs.
        const account = customer ? this.store.byCustomer(customer) : undefined;
        if (!account) {
            this.store.recordOutcome({ id: event.id, kind: event.type, userId: null, result: 'unmatched', code: customer ? 'unknown_customer' : 'no_customer' });
            return;
        }
        try {
            await this.store.exclusive(account.user_id, async token => {
                if (this.store.processed(event.id)) return;
                if (review) this.store.openReview(account.user_id, token, review.kind, review.source);
                await this.reconcileLocked(account.user_id, token);
                this.store.markProcessed(event.id);
                this.store.recordOutcome({ id: event.id, kind: event.type, userId: account.user_id, result: 'succeeded', code: null });
            });
        } catch (error) {
            // No dedup marker was written: Stripe's retry and targeted refresh remain the recovery paths.
            this.store.recordOutcome({ id: event.id, kind: event.type, userId: account.user_id, result: 'failed', code: error instanceof BillingBusyError ? 'account_busy' : 'processing_error' });
            throw error;
        }
    }
}
