import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { BillingStatus, BillingSettings } from '../types';

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
export interface BillingAccount {
    user_id: string;
    trial_ends_at: number;
    customer_id: string | null;
    subscription_id: string | null;
    subscription_status: string;
    paid_until: number;
    renewal_grace_until: number;
    cancel_at_period_end: number;
    review_required: number;
    checkout_attempt: string | null;
    checkout_session_id: string | null;
}

/** Billing facts only. Identity and workspace authority remain in AuthWorkspaceStore. */
export class BillingStore {
    readonly db: Database.Database;
    constructor(path: string) {
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS billing_accounts (
                user_id TEXT PRIMARY KEY, trial_ends_at INTEGER NOT NULL,
                customer_id TEXT UNIQUE, subscription_id TEXT,
                subscription_status TEXT NOT NULL DEFAULT '', paid_until INTEGER NOT NULL DEFAULT 0,
                cancel_at_period_end INTEGER NOT NULL DEFAULT 0, review_required INTEGER NOT NULL DEFAULT 0,
                checkout_attempt TEXT, checkout_session_id TEXT,
                lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS billing_events (event_id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS billing_settings (
                id INTEGER PRIMARY KEY CHECK(id = 1), trial_storage_gb INTEGER NOT NULL,
                paid_storage_gb INTEGER NOT NULL, revision INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO billing_settings VALUES (1, 1, 50, 1);
        `);
        this.db.transaction(() => {
            const columns = this.db.pragma('table_info(billing_accounts)') as Array<{ name: string }>;
            if (!columns.some(column => column.name === 'renewal_grace_until')) {
                this.db.exec('ALTER TABLE billing_accounts ADD COLUMN renewal_grace_until INTEGER NOT NULL DEFAULT 0');
            }
        }).immediate();
    }

    account(userId: string, now = Date.now()): BillingAccount {
        const existing = this.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId) as BillingAccount | undefined;
        if (existing) return existing;
        this.db.prepare('INSERT OR IGNORE INTO billing_accounts (user_id, trial_ends_at) VALUES (?, ?)').run(userId, now + TRIAL_MS);
        return this.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId) as BillingAccount;
    }

    byCustomer(customerId: string): BillingAccount | undefined {
        return this.db.prepare('SELECT * FROM billing_accounts WHERE customer_id = ?').get(customerId) as BillingAccount | undefined;
    }

    status(userId: string, now = Date.now()): BillingStatus {
        const account = this.account(userId, now);
        const accessEnd = Math.max(account.paid_until, account.subscription_status === 'active' ? account.renewal_grace_until : 0);
        const active = accessEnd > now && ['active', 'past_due'].includes(account.subscription_status);
        const trial = account.trial_ends_at > now && account.paid_until === 0 &&
            ['', 'incomplete', 'incomplete_expired', 'canceled'].includes(account.subscription_status);
        const state = account.review_required ? 'review' : active ? 'active' : trial ? 'trial'
            : account.subscription_id ? 'payment_required' : 'expired';
        return {
            userId, state, allowed: state === 'active' || state === 'trial',
            trialEndsAt: account.trial_ends_at, paidUntil: account.paid_until,
            accessExpiresAt: state === 'active' ? accessEnd : account.trial_ends_at,
            cancelAtPeriodEnd: Boolean(account.cancel_at_period_end), hasCustomer: Boolean(account.customer_id),
            storageLimitBytes: (state === 'active' ? this.settings().paidStorageGb : state === 'trial' ? this.settings().trialStorageGb : 0) * 1_000_000_000,
            paidStorageLimitBytes: this.settings().paidStorageGb * 1_000_000_000,
        };
    }

    settings(): BillingSettings {
        return this.db.prepare('SELECT trial_storage_gb AS trialStorageGb, paid_storage_gb AS paidStorageGb, revision FROM billing_settings WHERE id = 1').get() as BillingSettings;
    }
    saveSettings(settings: BillingSettings): boolean {
        if (![settings.trialStorageGb, settings.paidStorageGb].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000)) throw new Error('Invalid storage limit.');
        return Boolean(this.db.prepare('UPDATE billing_settings SET trial_storage_gb = ?, paid_storage_gb = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
            .run(settings.trialStorageGb, settings.paidStorageGb, settings.revision).changes);
    }

    async exclusive<T>(userId: string, operation: (token: string) => Promise<T>): Promise<T> {
        this.account(userId);
        const token = randomUUID();
        const now = Date.now();
        const acquired = this.db.prepare('UPDATE billing_accounts SET lock_token = ?, lock_until = ? WHERE user_id = ? AND lock_until <= ?')
            .run(token, now + 120_000, userId, now);
        if (!acquired.changes) throw new BillingBusyError();
        try { return await operation(token); }
        finally { this.db.prepare('UPDATE billing_accounts SET lock_token = NULL, lock_until = 0 WHERE user_id = ? AND lock_token = ?').run(userId, token); }
    }

    update(userId: string, token: string, values: Partial<Omit<BillingAccount, 'user_id' | 'trial_ends_at'>>) {
        // Field names come exclusively from this fixed server-side list.
        const fields = ['customer_id', 'subscription_id', 'subscription_status', 'paid_until', 'renewal_grace_until', 'cancel_at_period_end', 'review_required', 'checkout_attempt', 'checkout_session_id'] as const;
        const entries = fields.filter(key => values[key] !== undefined).map(key => [key, values[key]] as const);
        if (!entries.length) return;
        const result = this.db.prepare(`UPDATE billing_accounts SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE user_id = ? AND lock_token = ? AND lock_until > ?`)
            .run(...entries.map(([, value]) => value), userId, token, Date.now());
        if (!result.changes) throw new BillingBusyError();
    }

    processed(eventId: string): boolean {
        return Boolean(this.db.prepare('SELECT 1 FROM billing_events WHERE event_id = ?').get(eventId));
    }
    markProcessed(eventId: string) {
        this.db.transaction(() => {
            this.db.prepare('INSERT OR IGNORE INTO billing_events VALUES (?, ?)').run(eventId, Date.now());
            this.db.prepare('DELETE FROM billing_events WHERE processed_at < ?').run(Date.now() - 30 * 86_400_000);
        })();
    }
    close() { this.db.close(); }
}

export class BillingBusyError extends Error {
    constructor() { super('Billing is updating. Please try again shortly.'); }
}
