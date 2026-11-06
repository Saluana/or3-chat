import Stripe from 'stripe';
import { createHash, randomUUID } from 'node:crypto';
import { BillingStore } from './store';
import type { BillingConfig } from './config';

function id(value: string | { id: string } | null | undefined): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
}

export class BillingService {
    constructor(readonly store: BillingStore, readonly stripe: Stripe, readonly config: BillingConfig, private usedBytes?: (userId: string) => number) {}

    status(userId: string) {
        return { ...this.store.status(userId), storageUsedBytes: this.usedBytes?.(userId) ?? 0 };
    }

    async validatePrice() {
        const price = await this.stripe.prices.retrieve(this.config.priceId);
        if (!price.active || price.currency !== 'usd' || price.unit_amount !== 4000 ||
            price.type !== 'recurring' || price.recurring?.interval !== 'year' ||
            price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' || price.billing_scheme !== 'per_unit') {
            throw new Error('The configured Stripe price must be an active, fixed USD $40/year recurring price.');
        }
    }

    private async reconcileLocked(userId: string, token: string) {
        const account = this.store.account(userId);
        if (!account.customer_id) return;
        // Retrieve current state, not event payloads: delayed/out-of-order webhooks cannot restore old access.
        const subscriptions = await this.stripe.subscriptions.list({ customer: account.customer_id, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
        if (subscriptions.has_more) throw new Error('Billing subscription history requires operator review.');
        const matching = subscriptions.data.filter(sub => sub.items.data.some(item => item.price.id === this.config.priceId));
        const live = matching.filter(sub => !['canceled', 'incomplete_expired'].includes(sub.status));
        if (live.length > 1) {
            this.store.update(userId, token, { review_required: 1 });
            return;
        }
        const subscription = live[0] ?? matching.sort((a, b) => b.created - a.created)[0];
        if (!subscription) {
            // Do not restart a consumed trial when a subscription disappears or changes product.
            if (account.subscription_id) this.store.update(userId, token, { subscription_status: 'canceled', paid_until: 0, renewal_grace_until: 0 });
            return;
        }
        const item = subscription.items.data.find(entry => entry.price.id === this.config.priceId)!;
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
                    parent.proration === false && line.quantity === 1 && line.currency === 'usd' &&
                    line.pricing?.price_details?.price === this.config.priceId &&
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
            subscription_status: subscription.status,
            paid_until: paid ? currentEnd : Math.min(previousEnd, currentEnd),
            cancel_at_period_end: subscription.cancel_at_period_end || subscription.cancel_at !== null ? 1 : 0,
        });
    }

    async refresh(userId: string) {
        await this.store.exclusive(userId, token => this.reconcileLocked(userId, token));
        return this.status(userId);
    }

    async checkout(userId: string): Promise<string> {
        return this.store.exclusive(userId, async token => {
            if (this.store.account(userId).review_required) throw new Error('Billing requires operator review.');
            await this.validatePrice();
            let account = this.store.account(userId);
            if (!account.customer_id) {
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
            if (account.checkout_session_id) {
                const previous = await this.stripe.checkout.sessions.retrieve(account.checkout_session_id);
                if (previous.status === 'open' && previous.url) return previous.url;
                if (previous.status === 'complete' && !['canceled', 'incomplete_expired'].includes(account.subscription_status)) {
                    // An asynchronous payment may still be pending. Never create a second subscription.
                    return this.portal(userId);
                }
                this.store.update(userId, token, { checkout_attempt: null, checkout_session_id: null });
                account = this.store.account(userId);
            }
            const attempt = account.checkout_attempt || randomUUID();
            this.store.update(userId, token, { checkout_attempt: attempt });
            const session = await this.stripe.checkout.sessions.create({
                mode: 'subscription', customer: account.customer_id!,
                line_items: [{ price: this.config.priceId, quantity: 1 }],
                success_url: `${this.config.baseUrl}/billing?checkout=success`,
                cancel_url: `${this.config.baseUrl}/billing`,
                // The free trial lives in OR3. Choosing Subscribe charges the annual price now.
                integration_identifier: `or3_hosted_${createHash('sha256').update(attempt).digest('hex').slice(0, 8).replace(/[0-9]/g, c => String.fromCharCode(97 + Number(c)))}`,
            }, { idempotencyKey: `or3-checkout-${attempt}` });
            this.store.update(userId, token, { checkout_session_id: session.id });
            if (!session.url) throw new Error('Stripe did not return a Checkout URL.');
            return session.url;
        });
    }

    async portal(userId: string): Promise<string> {
        const customer = this.store.account(userId).customer_id;
        if (!customer) throw new Error('No billing customer exists yet.');
        const session = await this.stripe.billingPortal.sessions.create({ customer, return_url: `${this.config.baseUrl}/billing` });
        return session.url;
    }

    verifyWebhook(body: Buffer, signature: string): Stripe.Event {
        return this.stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret);
    }

    async webhook(event: Stripe.Event) {
        if (this.store.processed(event.id)) return;
        let customer: string | null = null;
        let review = false;
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
                review = true;
                break;
            case 'charge.dispute.created':
            case 'radar.early_fraud_warning.created': {
                const chargeId = id(event.data.object.charge);
                if (chargeId) customer = id((await this.stripe.charges.retrieve(chargeId)).customer);
                review = true;
                break;
            }
            default: return;
        }
        // Customers are created exclusively by this module and mapped to canonical OR3 user IDs.
        const account = customer ? this.store.byCustomer(customer) : undefined;
        if (!account) return;
        await this.store.exclusive(account.user_id, async token => {
            if (this.store.processed(event.id)) return;
            if (review) this.store.update(account.user_id, token, { review_required: 1 });
            await this.reconcileLocked(account.user_id, token);
            this.store.markProcessed(event.id);
        });
    }
}
