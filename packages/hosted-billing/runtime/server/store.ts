import Database from 'better-sqlite3';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { BillingStatus, BillingSettings } from '../types';
import { evaluateAccess, type SupportPause, type SupportState } from './entitlement';


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
    /** Incremented whenever payment, review or support facts relevant to admin decisions change. */
    admin_revision: number;
    last_reconciled_at: number;
    last_reconcile_outcome: string | null;
    matched_offer_id: string | null;
    trial_offer_id: string | null;
    checkout_offer_id: string | null;
}

export type ReviewKind = 'refund' | 'dispute' | 'fraud_warning' | 'conflicting_subscriptions' | 'unknown_offer' | 'ambiguous_offer' | 'legacy';
export interface ReviewRecord {
    id: string;
    kind: ReviewKind;
    openedAt: number;
    resolvedAt: number | null;
    resolvedBy: string | null;
    resolutionReason: string | null;
}

export interface AdminActionRecord {
    operationId: string;
    userId: string;
    actor: string;
    kind: string;
    reason: string | null;
    createdAt: number;
    outcome: string;
    code: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
}

/** Fields whose change alters an administrator's decision context. */
const REVISIONED_FIELDS = ['subscription_id', 'subscription_status', 'paid_until', 'renewal_grace_until', 'cancel_at_period_end', 'review_required', 'matched_offer_id'] as const;
const SCHEMA_VERSION = 4;
export const UNRECORDED_LEGACY_REVIEW = 'legacy-unrecorded';

/** Concrete support commands. There is no arbitrary field patching. */
export type SupportCommand =
    | { kind: 'grant'; expiresAt: number; storageBytes: number }
    | { kind: 'revoke_grant' }
    | { kind: 'extend_trial'; expiresAt: number }
    | { kind: 'storage_bonus'; bytes: number; expiresAt: number | null }
    | { kind: 'pause_account' | 'pause_uploads' | 'pause_jobs'; expiresAt: number | null }
    | { kind: 'resume_account' | 'resume_uploads' | 'resume_jobs' };

export interface BillingOffer {
    id: string; version: number; priceId: string; amountCents: number; currency: 'usd'; interval: 'year';
    paidStorageGb: number; trialStorageGb: number; trialDays: number; status: 'current' | 'grandfathered' | 'retired';
    createdAt: number;
}
export type OfferCommand =
    | { kind: 'create_current'; priceId: string; amountCents: number; paidStorageGb: number; trialStorageGb: number; trialDays: number }
    | { kind: 'retire'; offerId: string };

export type OutcomeResult = 'succeeded' | 'failed' | 'unmatched' | 'skipped';
export interface ProcessingOutcome { id: string; kind: string; userId: string | null; attempts: number; firstAttemptAt: number; lastAttemptAt: number; result: OutcomeResult; code: string | null }
const OUTCOME_RETENTION_MS = 30 * 86_400_000;

export type AccountFilter = 'paid' | 'trial' | 'attention';
// Mirrors evaluateAccess() source selection; the evaluator remains authoritative for each row.
const FILTERS: Record<AccountFilter, string> = {
    paid: `account.subscription_status IN ('active', 'past_due') AND (account.paid_until > @now OR (account.subscription_status = 'active' AND account.renewal_grace_until > @now))`,
    trial: `NOT (account.subscription_status IN ('active', 'past_due') AND (account.paid_until > @now OR (account.subscription_status = 'active' AND account.renewal_grace_until > @now)))
        AND account.subscription_status IN ('', 'incomplete', 'incomplete_expired', 'canceled')
        AND ((account.trial_ends_at > @now AND account.paid_until = 0) OR COALESCE(support.trial_extension_until, 0) > @now)`,
    attention: `account.review_required = 1 OR account.last_reconcile_outcome = 'failed'
        OR (COALESCE(support.hosted_paused, 0) = 1 AND (support.hosted_pause_until IS NULL OR support.hosted_pause_until > @now))`,
};

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
            CREATE TABLE IF NOT EXISTS billing_private_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS billing_trial_decisions (
                user_id TEXT PRIMARY KEY, granted INTEGER NOT NULL,
                email_hash TEXT UNIQUE, network_hash TEXT UNIQUE
            );
        `);
        this.db.transaction(() => {
            this.db.prepare("INSERT OR IGNORE INTO billing_private_settings VALUES ('trial_hash_key', ?)").run(randomBytes(32).toString('hex'));
            const columns = this.db.pragma('table_info(billing_accounts)') as Array<{ name: string }>;
            if (!columns.some(column => column.name === 'renewal_grace_until')) {
                this.db.exec('ALTER TABLE billing_accounts ADD COLUMN renewal_grace_until INTEGER NOT NULL DEFAULT 0');
            }
        }).immediate();
        this.migrate();
    }

    /** Additive, versioned and idempotent. Payment, trial and eligibility facts are never rewritten. */
    private migrate() {
        this.db.transaction(() => {
            const version = this.db.pragma('user_version', { simple: true }) as number;
            if (version > SCHEMA_VERSION) throw new Error('The billing database was written by a newer OR3 version.');
            if (version < 1) {
                const columns = new Set((this.db.pragma('table_info(billing_accounts)') as Array<{ name: string }>).map(column => column.name));
                for (const [name, definition] of [['admin_revision', 'INTEGER NOT NULL DEFAULT 0'], ['last_reconciled_at', 'INTEGER NOT NULL DEFAULT 0'], ['last_reconcile_outcome', 'TEXT']] as const) {
                    if (!columns.has(name)) this.db.exec(`ALTER TABLE billing_accounts ADD COLUMN ${name} ${definition}`);
                }
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS billing_reviews (
                        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL UNIQUE,
                        opened_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by_action TEXT
                    );
                    CREATE INDEX IF NOT EXISTS billing_reviews_user ON billing_reviews (user_id, opened_at);
                    CREATE INDEX IF NOT EXISTS billing_reviews_open ON billing_reviews (resolved_at, opened_at);
                    CREATE TABLE IF NOT EXISTS billing_admin_actions (
                        operation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL,
                        reason TEXT, created_at INTEGER NOT NULL, outcome TEXT NOT NULL, code TEXT,
                        before_json TEXT, after_json TEXT
                    );
                    CREATE INDEX IF NOT EXISTS billing_admin_actions_user ON billing_admin_actions (user_id, created_at);
                    CREATE INDEX IF NOT EXISTS billing_admin_actions_time ON billing_admin_actions (created_at);
                `);
            }
            if (version < 2) {
                // One concrete row per account. Reasons and actors live in the linked audit records.
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS billing_support (
                        user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
                        grant_until INTEGER NOT NULL DEFAULT 0, grant_storage_bytes INTEGER NOT NULL DEFAULT 0, grant_action TEXT,
                        trial_extension_until INTEGER NOT NULL DEFAULT 0, trial_extension_action TEXT,
                        bonus_bytes INTEGER NOT NULL DEFAULT 0, bonus_until INTEGER, bonus_action TEXT,
                        hosted_paused INTEGER NOT NULL DEFAULT 0, hosted_pause_started INTEGER, hosted_pause_until INTEGER, hosted_pause_action TEXT,
                        upload_paused INTEGER NOT NULL DEFAULT 0, upload_pause_started INTEGER, upload_pause_until INTEGER, upload_pause_action TEXT,
                        job_paused INTEGER NOT NULL DEFAULT 0, job_pause_started INTEGER, job_pause_until INTEGER, job_pause_action TEXT
                    );
                `);
            }
            if (version < 3) {
                // Diagnostics only; successful-event dedup remains billing_events.
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS billing_processing_outcomes (
                        id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, attempts INTEGER NOT NULL,
                        first_attempt_at INTEGER NOT NULL, last_attempt_at INTEGER NOT NULL, result TEXT NOT NULL, code TEXT
                    );
                    CREATE INDEX IF NOT EXISTS billing_outcomes_time ON billing_processing_outcomes (last_attempt_at);
                    CREATE INDEX IF NOT EXISTS billing_outcomes_result ON billing_processing_outcomes (result, last_attempt_at);
                    CREATE TABLE IF NOT EXISTS billing_health (name TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, result TEXT NOT NULL, code TEXT);
                `);
            }
            if (version < 4) {
                this.db.exec(`
                    ALTER TABLE billing_accounts ADD COLUMN matched_offer_id TEXT;
                    ALTER TABLE billing_accounts ADD COLUMN trial_offer_id TEXT;
                    ALTER TABLE billing_accounts ADD COLUMN checkout_offer_id TEXT;
                    CREATE TABLE billing_offers (
                        id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, price_id TEXT NOT NULL UNIQUE,
                        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL CHECK(currency = 'usd'),
                        interval TEXT NOT NULL CHECK(interval = 'year'), paid_storage_gb INTEGER NOT NULL,
                        trial_storage_gb INTEGER NOT NULL, trial_days INTEGER NOT NULL,
                        status TEXT NOT NULL CHECK(status IN ('current', 'grandfathered', 'retired')), created_at INTEGER NOT NULL
                    );
                    CREATE UNIQUE INDEX billing_offer_current ON billing_offers(status) WHERE status = 'current';
                    CREATE TABLE billing_offer_revision (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
                    INSERT INTO billing_offer_revision VALUES (1, 1);
                    CREATE INDEX billing_accounts_offer ON billing_accounts(matched_offer_id);
                    CREATE INDEX billing_accounts_trial_offer ON billing_accounts(trial_offer_id);
                `);
            }
            this.migrateLegacyReviews();
            this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
        }).immediate();
    }

    /** A hold without a recorded reason becomes a visible, still-blocking legacy review. */
    migrateLegacyReviews(now = Date.now()) {
        const orphaned = this.db.prepare(`SELECT user_id FROM billing_accounts AS account WHERE review_required = 1
            AND NOT EXISTS (SELECT 1 FROM billing_reviews WHERE user_id = account.user_id AND resolved_at IS NULL)`).all() as Array<{ user_id: string }>;
        const insert = this.db.prepare("INSERT INTO billing_reviews (id, user_id, kind, source, opened_at) VALUES (?, ?, 'legacy', ?, ?)");
        for (const { user_id } of orphaned) insert.run(randomUUID(), user_id, `legacy:${user_id}:${randomUUID()}`, now);
    }

    /** SELECT only. Never provisions an account, trial or lease. */
    findAccount(userId: string): BillingAccount | null {
        return (this.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId) as BillingAccount | undefined) ?? null;
    }

    support(userId: string): SupportState | null {
        const row = this.db.prepare('SELECT * FROM billing_support WHERE user_id = ?').get(userId) as Record<string, number | string | null> | undefined;
        if (!row) return null;
        const pause = (prefix: 'hosted' | 'upload' | 'job'): SupportPause | null => row[`${prefix}_paused`]
            ? { startedAt: Number(row[`${prefix}_pause_started`] ?? 0), expiresAt: row[`${prefix}_pause_until`] === null ? null : Number(row[`${prefix}_pause_until`]), actionId: String(row[`${prefix}_pause_action`] ?? '') }
            : null;
        return {
            revision: Number(row.revision), grantUntil: Number(row.grant_until), grantStorageBytes: Number(row.grant_storage_bytes),
            trialExtensionUntil: Number(row.trial_extension_until), bonusBytes: Number(row.bonus_bytes),
            bonusUntil: row.bonus_until === null ? null : Number(row.bonus_until),
            hostedPause: pause('hosted'), uploadPause: pause('upload'), jobPause: pause('job'),
        };
    }

    reviews(userId: string, limit = 50): ReviewRecord[] {
        return this.db.prepare(`SELECT review.id, review.kind, review.opened_at AS openedAt, review.resolved_at AS resolvedAt,
                action.actor AS resolvedBy, action.reason AS resolutionReason
            FROM billing_reviews AS review LEFT JOIN billing_admin_actions AS action ON action.operation_id = review.resolved_by_action
            WHERE review.user_id = ? ORDER BY review.opened_at DESC, review.id LIMIT ?`).all(userId, limit) as ReviewRecord[];
    }

    /** Open review IDs. A hold set outside this module since startup reads as one unrecorded legacy review. */
    openReviewIds(userId: string): string[] {
        const ids = (this.db.prepare('SELECT id FROM billing_reviews WHERE user_id = ? AND resolved_at IS NULL ORDER BY id').all(userId) as Array<{ id: string }>).map(row => row.id);
        return ids.length || !this.findAccount(userId)?.review_required ? ids : [UNRECORDED_LEGACY_REVIEW];
    }

    /**
     * Atomically resolves exactly the reviewed open set and records the decision.
     * Lease, revision and review set are rechecked inside the transaction.
     */
    commitReviewResolution(userId: string, token: string, input: { operationId: string; actor: string; reason: string; expectedRevision: number; reviewIds: string[] }, now = Date.now()) {
        return this.db.transaction(() => {
            this.assertLease(userId, token);
            const account = this.findAccount(userId)!;
            if (account.admin_revision !== input.expectedRevision) throw new BillingCommandError(409, 'stale_revision', 'This account changed. Review the current state before deciding.');
            const open = this.openReviewIds(userId);
            if (!open.length || open.join('\0') !== [...input.reviewIds].sort().join('\0')) {
                throw new BillingCommandError(409, 'review_set_changed', 'The open reviews changed. Review the current state before deciding.');
            }
            if (open[0] === UNRECORDED_LEGACY_REVIEW) {
                open[0] = randomUUID();
                this.db.prepare("INSERT INTO billing_reviews (id, user_id, kind, source, opened_at) VALUES (?, ?, 'legacy', ?, ?)").run(open[0], userId, `legacy:${userId}:${open[0]}`, now);
            }
            const before = { reviewRequired: account.review_required, openReviews: open.length, revision: account.admin_revision };
            const resolve = this.db.prepare('UPDATE billing_reviews SET resolved_at = ?, resolved_by_action = ? WHERE id = ? AND resolved_at IS NULL');
            for (const id of open) resolve.run(now, input.operationId, id);
            this.db.prepare('UPDATE billing_accounts SET review_required = 0, admin_revision = admin_revision + 1 WHERE user_id = ?').run(userId);
            const after = { reviewRequired: 0, openReviews: 0, revision: account.admin_revision + 1 };
            this.recordAction({ operationId: input.operationId, userId, actor: input.actor, kind: 'resolve_review', reason: input.reason, createdAt: now, outcome: 'resolved', code: null, before, after });
            return after.revision;
        }).immediate();
    }

    /** Records a risk source once. A redelivered identical source never reopens a resolved review. */
    openReview(userId: string, token: string, kind: ReviewKind, source: string, now = Date.now()): boolean {
        return this.db.transaction(() => {
            this.assertLease(userId, token);
            const inserted = this.db.prepare('INSERT OR IGNORE INTO billing_reviews (id, user_id, kind, source, opened_at) VALUES (?, ?, ?, ?, ?)')
                .run(randomUUID(), userId, kind, source, now).changes > 0;
            if (inserted) this.db.prepare('UPDATE billing_accounts SET review_required = 1, admin_revision = admin_revision + 1 WHERE user_id = ?').run(userId);
            return inserted;
        }).immediate();
    }

    /**
     * Server-side population filters over billing records, keyset-paged by user ID.
     * Counts cover billing records only; canonical users without one are "Cloud not started".
     */
    filterAccounts(filter: AccountFilter, input: { cursor: string | null; limit: number }, now = Date.now()): { userIds: string[]; nextCursor: string | null } {
        const rows = this.db.prepare(`SELECT account.user_id FROM billing_accounts AS account LEFT JOIN billing_support AS support ON support.user_id = account.user_id
            WHERE (${FILTERS[filter]}) AND account.user_id > @cursor ORDER BY account.user_id LIMIT @limit`)
            .all({ now, cursor: input.cursor ?? '', limit: input.limit + 1 }) as Array<{ user_id: string }>;
        const page = rows.slice(0, input.limit).map(row => row.user_id);
        return { userIds: page, nextCursor: rows.length > input.limit ? page.at(-1)! : null };
    }

    filterCounts(now = Date.now()): Record<AccountFilter | 'accounts', number> {
        const select = (filter: AccountFilter) => `(SELECT COUNT(*) FROM billing_accounts AS account LEFT JOIN billing_support AS support ON support.user_id = account.user_id WHERE ${FILTERS[filter]})`;
        return this.db.prepare(`SELECT ${select('paid')} AS paid, ${select('trial')} AS trial, ${select('attention')} AS attention, (SELECT COUNT(*) FROM billing_accounts) AS accounts`)
            .get({ now }) as Record<AccountFilter | 'accounts', number>;
    }

    /**
     * Applies one concrete support change with its audit record in the same
     * transaction. Payment, trial and eligibility facts are never touched.
     */
    commitSupport(userId: string, token: string, input: { operationId: string; actor: string; reason: string; expectedRevision: number; command: SupportCommand; commandHash: string }, now = Date.now()) {
        return this.db.transaction(() => {
            this.assertLease(userId, token);
            const account = this.findAccount(userId)!;
            if (account.admin_revision !== input.expectedRevision) throw new BillingCommandError(409, 'stale_revision', 'This account changed. Review the current state before deciding.');
            const command = input.command;
            if (command.kind === 'extend_trial' && ['active', 'past_due', 'trialing', 'unpaid', 'paused'].includes(account.subscription_status)) {
                throw new BillingCommandError(409, 'paid_subscription', 'This account has a subscription. Use complimentary access or a storage bonus instead.');
            }
            this.db.prepare('INSERT OR IGNORE INTO billing_support (user_id) VALUES (?)').run(userId);
            const before = this.db.prepare('SELECT * FROM billing_support WHERE user_id = ?').get(userId) as Record<string, number | string | null>;
            const pause = (prefix: 'hosted' | 'upload' | 'job', active: boolean, until: number | null = null) => active
                ? { [`${prefix}_paused`]: 1, [`${prefix}_pause_started`]: now, [`${prefix}_pause_until`]: until, [`${prefix}_pause_action`]: input.operationId }
                : { [`${prefix}_paused`]: 0, [`${prefix}_pause_started`]: null, [`${prefix}_pause_until`]: null, [`${prefix}_pause_action`]: null };
            const changes: Record<string, number | string | null> = command.kind === 'grant' ? { grant_until: command.expiresAt, grant_storage_bytes: command.storageBytes, grant_action: input.operationId }
                : command.kind === 'revoke_grant' ? { grant_until: 0, grant_storage_bytes: 0, grant_action: input.operationId }
                : command.kind === 'extend_trial' ? { trial_extension_until: command.expiresAt, trial_extension_action: input.operationId }
                : command.kind === 'storage_bonus' ? { bonus_bytes: command.bytes, bonus_until: command.bytes ? command.expiresAt : null, bonus_action: input.operationId }
                : command.kind === 'pause_account' ? pause('hosted', true, command.expiresAt)
                : command.kind === 'resume_account' ? pause('hosted', false)
                : command.kind === 'pause_uploads' ? pause('upload', true, command.expiresAt)
                : command.kind === 'resume_uploads' ? pause('upload', false)
                : command.kind === 'pause_jobs' ? pause('job', true, command.expiresAt)
                : pause('job', false);
            const keys = Object.keys(changes);
            this.db.prepare(`UPDATE billing_support SET ${keys.map(key => `${key} = @${key}`).join(', ')}, revision = revision + 1 WHERE user_id = @user`).run({ ...changes, user: userId });
            if (command.kind === 'extend_trial' && !account.trial_offer_id) {
                this.db.prepare('UPDATE billing_accounts SET trial_offer_id = ? WHERE user_id = ?').run(this.currentOffer()?.id ?? null, userId);
            }
            this.db.prepare('UPDATE billing_accounts SET admin_revision = admin_revision + 1 WHERE user_id = ?').run(userId);
            const audited = (row: Record<string, unknown>) => Object.fromEntries(keys.filter(key => !key.endsWith('_action')).map(key => [key, row[key] ?? null]));
            const revision = account.admin_revision + 1;
            this.recordAction({ operationId: input.operationId, userId, actor: input.actor, kind: command.kind, reason: input.reason, createdAt: now, outcome: 'applied', code: null, before: audited(before), after: { ...audited(changes), revision, commandHash: input.commandHash } });
            return revision;
        }).immediate();
    }

    /**
     * Bounded diagnostic record of webhook/refresh processing. Separate from the
     * successful-event dedup table; stores only identity, result and a safe code.
     */
    recordOutcome(input: { id: string; kind: string; userId: string | null; result: OutcomeResult; code: string | null }, now = Date.now()) {
        this.db.transaction(() => {
            this.db.prepare(`INSERT INTO billing_processing_outcomes (id, kind, user_id, attempts, first_attempt_at, last_attempt_at, result, code)
                VALUES (@id, @kind, @userId, 1, @now, @now, @result, @code)
                ON CONFLICT(id) DO UPDATE SET attempts = attempts + 1, last_attempt_at = @now, result = @result, code = @code, user_id = COALESCE(@userId, user_id)`)
                .run({ ...input, now });
            this.db.prepare(`DELETE FROM billing_processing_outcomes WHERE id IN (
                SELECT id FROM billing_processing_outcomes WHERE last_attempt_at < ? ORDER BY last_attempt_at LIMIT 100)`).run(now - OUTCOME_RETENTION_MS);
        }).immediate();
    }

    outcomes(input: { limit: number; result?: OutcomeResult }): ProcessingOutcome[] {
        return this.db.prepare(`SELECT id, kind, user_id AS userId, attempts, first_attempt_at AS firstAttemptAt, last_attempt_at AS lastAttemptAt, result, code
            FROM billing_processing_outcomes ${input.result ? 'WHERE result = @result' : ''} ORDER BY last_attempt_at DESC, id LIMIT @limit`)
            .all({ limit: input.limit, ...(input.result ? { result: input.result } : {}) }) as ProcessingOutcome[];
    }

    action(operationId: string): AdminActionRecord | null {
        const row = this.db.prepare('SELECT * FROM billing_admin_actions WHERE operation_id = ?').get(operationId) as Record<string, string | number | null> | undefined;
        return row ? toAction(row) : null;
    }

    actions(userId: string, limit = 20): AdminActionRecord[] {
        return (this.db.prepare('SELECT * FROM billing_admin_actions WHERE user_id = ? ORDER BY created_at DESC, operation_id LIMIT ?').all(userId, limit) as Array<Record<string, string | number | null>>).map(toAction);
    }

    /** Bounded, newest-first billing decisions across accounts, keyset-paged by (time, operation ID). */
    recentActions(input: { limit: number; cursor?: { at: number; id: string } | null; actor?: string; kind?: string; userId?: string; since?: number; until?: number }): AdminActionRecord[] {
        const where = ['1 = 1'];
        const params: Record<string, string | number> = { limit: input.limit };
        if (input.cursor) { where.push('(created_at < @cursorAt OR (created_at = @cursorAt AND operation_id < @cursorId))'); params.cursorAt = input.cursor.at; params.cursorId = input.cursor.id; }
        if (input.actor) { where.push('actor = @actor'); params.actor = input.actor; }
        if (input.kind) { where.push('kind = @kind'); params.kind = input.kind; }
        if (input.userId) { where.push('user_id = @userId'); params.userId = input.userId; }
        if (input.since !== undefined) { where.push('created_at >= @since'); params.since = input.since; }
        if (input.until !== undefined) { where.push('created_at <= @until'); params.until = input.until; }
        return (this.db.prepare(`SELECT * FROM billing_admin_actions WHERE ${where.join(' AND ')} ORDER BY created_at DESC, operation_id DESC LIMIT @limit`).all(params) as Array<Record<string, string | number | null>>).map(toAction);
    }

    recordAction(record: Omit<AdminActionRecord, 'createdAt'> & { createdAt?: number }) {
        this.db.prepare(`INSERT INTO billing_admin_actions (operation_id, user_id, actor, kind, reason, created_at, outcome, code, before_json, after_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.operationId, record.userId, record.actor, record.kind, record.reason,
            record.createdAt ?? Date.now(), record.outcome, record.code, record.before ? JSON.stringify(record.before) : null, record.after ? JSON.stringify(record.after) : null);
    }

    /** Throws unless this caller still holds an unexpired account lease. */
    assertLease(userId: string, token: string) {
        if (!this.db.prepare('SELECT 1 FROM billing_accounts WHERE user_id = ? AND lock_token = ? AND lock_until > ?').get(userId, token, Date.now())) throw new BillingBusyError();
    }

    recordReconcile(userId: string, token: string, outcome: 'ok' | 'failed', now = Date.now()) {
        const result = this.db.prepare('UPDATE billing_accounts SET last_reconciled_at = ?, last_reconcile_outcome = ? WHERE user_id = ? AND lock_token = ? AND lock_until > ?')
            .run(now, outcome, userId, token, Date.now());
        if (!result.changes) throw new BillingBusyError();
    }

    account(userId: string, _now = Date.now()): BillingAccount {
        const existing = this.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId) as BillingAccount | undefined;
        if (existing) return existing;
        this.db.prepare('INSERT OR IGNORE INTO billing_accounts (user_id, trial_ends_at) VALUES (?, 0)').run(userId);
        return this.db.prepare('SELECT * FROM billing_accounts WHERE user_id = ?').get(userId) as BillingAccount;
    }

    /** A one-time, atomic decision. The caller supplies normalized, validated identities. */
    claimTrial(userId: string, email: string | null, network: string | null, now = Date.now()): void {
        if (!email || !network) return; // A later request with a usable identity can retry.
        const existingAccount = this.db.prepare('SELECT trial_ends_at, subscription_id, customer_id, paid_until FROM billing_accounts WHERE user_id = ?').get(userId) as BillingAccount | undefined;
        if (existingAccount && (existingAccount.trial_ends_at || existingAccount.subscription_id || existingAccount.customer_id || existingAccount.paid_until)) return;
        if (this.db.prepare('SELECT 1 FROM billing_trial_decisions WHERE user_id = ?').get(userId)) return;
        this.db.transaction(() => {
            const account = this.account(userId, now);
            // Preserve existing accounts and never grant a new trial to a subscriber.
            if (account.trial_ends_at || account.subscription_id || account.customer_id || account.paid_until ||
                this.db.prepare('SELECT 1 FROM billing_trial_decisions WHERE user_id = ?').get(userId)) return;
            const { value: key } = this.db.prepare("SELECT value FROM billing_private_settings WHERE name = 'trial_hash_key'").get() as { value: string };
            const fingerprint = (kind: string, identity: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(kind).update('\0').update(identity).digest('hex');
            const emailHash = fingerprint('email', email);
            const networkHash = fingerprint('network', network);
            const existing = this.db.prepare('SELECT 1 FROM billing_trial_decisions WHERE email_hash = ? OR network_hash = ?').get(emailHash, networkHash);
            if (existing) {
                this.db.prepare('INSERT INTO billing_trial_decisions (user_id, granted) VALUES (?, 0)').run(userId);
                return;
            }
            this.db.prepare('INSERT INTO billing_trial_decisions VALUES (?, 1, ?, ?)').run(userId, emailHash, networkHash);
            const offer = this.currentOffer();
            this.db.prepare('UPDATE billing_accounts SET trial_ends_at = ?, trial_offer_id = ? WHERE user_id = ?').run(now + (offer?.trialDays ?? 7) * 86_400_000, offer?.id ?? null, userId);
        }).immediate();
    }

    byCustomer(customerId: string): BillingAccount | undefined {
        return this.db.prepare('SELECT * FROM billing_accounts WHERE customer_id = ?').get(customerId) as BillingAccount | undefined;
    }

    status(userId: string, now = Date.now()): BillingStatus {
        const account = this.account(userId, now);
        return this.describe(account, now);
    }

    /** Status projection for an existing account, computed by the shared evaluator. */
    describe(account: BillingAccount, now = Date.now()): BillingStatus {
        const settings = this.settings();
        const currentOffer = this.currentOffer();
        const subscriptionOffer = account.subscription_id && !['canceled', 'incomplete_expired'].includes(account.subscription_status)
            ? this.offerRows().find(offer => offer.id === account.matched_offer_id) : undefined;
        const displayedOffer = subscriptionOffer ?? currentOffer;
        const { state, access } = evaluateAccess(account, this.accountSettings(account), now, this.support(account.user_id));
        return {
            userId: account.user_id, state, source: access.source, allowed: access.allowed,
            trialEndsAt: account.trial_ends_at, paidUntil: account.paid_until,
            accessExpiresAt: access.expiresAt ?? account.trial_ends_at,
            cancelAtPeriodEnd: Boolean(account.cancel_at_period_end), hasCustomer: Boolean(account.customer_id),
            storageLimitBytes: access.storageLimitBytes,
            paidStorageLimitBytes: (displayedOffer?.paidStorageGb ?? settings.paidStorageGb) * 1_000_000_000,
            offer: displayedOffer ? { amountCents: displayedOffer.amountCents, currency: 'USD', interval: 'year', trialDays: displayedOffer.trialDays, paidStorageGb: displayedOffer.paidStorageGb } : undefined,
        };
    }

    /** Bootstrap only. Later configuration changes cannot silently replace accepted prices. */
    ensureOffer(priceId: string): void {
        this.db.transaction(() => {
            if (this.currentOffer()) return;
            if (this.db.prepare('SELECT 1 FROM billing_offers LIMIT 1').get()) throw new Error('Current billing offer missing');
            const settings = this.settings();
            const offerId = randomUUID();
            this.db.prepare(`INSERT INTO billing_offers VALUES (?, 1, ?, 4000, 'usd', 'year', ?, ?, 7, 'current', ?)`).run(offerId, priceId, settings.paidStorageGb, settings.trialStorageGb, Date.now());
            this.db.prepare('UPDATE billing_accounts SET matched_offer_id = CASE WHEN subscription_id IS NOT NULL THEN ? ELSE NULL END, trial_offer_id = CASE WHEN trial_ends_at > 0 OR EXISTS (SELECT 1 FROM billing_support WHERE billing_support.user_id = billing_accounts.user_id AND trial_extension_until > 0) THEN ? ELSE NULL END').run(offerId, offerId);
        }).immediate();
    }

    private offerRows(): BillingOffer[] {
        return this.db.prepare(`SELECT id, version, price_id AS priceId, amount_cents AS amountCents, currency, interval,
            paid_storage_gb AS paidStorageGb, trial_storage_gb AS trialStorageGb, trial_days AS trialDays, status, created_at AS createdAt
            FROM billing_offers ORDER BY version DESC LIMIT 100`).all() as BillingOffer[];
    }
    currentOffer(): BillingOffer | undefined { return this.offerRows().find(offer => offer.status === 'current'); }
    offers() {
        const revision = (this.db.prepare('SELECT revision FROM billing_offer_revision WHERE id = 1').get() as { revision: number }).revision;
        return { revision, items: this.offerRows() };
    }
    /** Historical paid/trial cohorts retain their original defaults. Only an
     * explicit allowance change for the current cohort overrides its values. */
    accountSettings(account: BillingAccount | null, proposed?: BillingSettings): BillingSettings {
        const settings = this.settings();
        if (!account) return settings;
        const offers = this.offerRows();
        const current = offers.find(offer => offer.status === 'current');
        const paid = offers.find(offer => offer.id === account.matched_offer_id);
        const trial = offers.find(offer => offer.id === account.trial_offer_id);
        return { ...settings,
            paidStorageGb: proposed && (!paid || paid.id === current?.id) ? proposed.paidStorageGb : paid?.paidStorageGb ?? settings.paidStorageGb,
            trialStorageGb: proposed && (!trial || trial.id === current?.id) ? proposed.trialStorageGb : trial?.trialStorageGb ?? settings.trialStorageGb };
    }

    commitOffer(input: { operationId: string; actor: string; reason: string; expectedRevision: number; command: OfferCommand; commandHash: string }) {
        return this.db.transaction(() => {
            const state = this.offers();
            if (state.revision !== input.expectedRevision) throw new BillingCommandError(409, 'stale_revision', 'Offers changed. Reload and review the current offer.');
            const command = input.command;
            const previous = state.items.find(offer => offer.status === 'current')!;
            let offerId: string;
            if (command.kind === 'create_current') {
                if (state.items.length >= 100) throw new BillingCommandError(400, 'offer_limit', 'The accepted offer limit has been reached.');
                if (state.items.some(offer => offer.priceId === command.priceId)) throw new BillingCommandError(409, 'price_already_accepted', 'This price is already accepted. Historical terms cannot be overwritten.');
                offerId = randomUUID();
                this.db.prepare("UPDATE billing_offers SET status = 'grandfathered' WHERE status = 'current'").run();
                this.db.prepare("INSERT INTO billing_offers VALUES (?, ?, ?, ?, 'usd', 'year', ?, ?, ?, 'current', ?)")
                    .run(offerId, Math.max(...state.items.map(offer => offer.version), 0) + 1, command.priceId, command.amountCents, command.paidStorageGb, command.trialStorageGb, command.trialDays, Date.now());
                this.db.prepare('UPDATE billing_settings SET paid_storage_gb = ?, trial_storage_gb = ?, revision = revision + 1 WHERE id = 1').run(command.paidStorageGb, command.trialStorageGb);
                // A prior validation cannot describe the newly current offer.
                this.db.prepare("DELETE FROM billing_health WHERE name = 'price'").run();
            } else {
                offerId = command.offerId;
                const target = state.items.find(offer => offer.id === offerId);
                if (!target || target.status === 'current') throw new BillingCommandError(400, 'current_offer_required', 'Only historical offers may be retired. They remain accepted for reconciliation.');
                this.db.prepare("UPDATE billing_offers SET status = 'retired' WHERE id = ?").run(offerId);
            }
            this.db.prepare('UPDATE billing_offer_revision SET revision = revision + 1 WHERE id = 1').run();
            this.recordAction({ operationId: input.operationId, userId: '__deployment__', actor: input.actor, kind: 'offer_change', reason: input.reason, outcome: 'completed', code: null,
                before: { currentOfferId: previous.id, revision: state.revision }, after: { offerId, currentOfferId: this.currentOffer()!.id, revision: state.revision + 1, commandHash: input.commandHash } });
            return this.offers();
        }).immediate();
    }

    settings(): BillingSettings {
        return this.db.prepare('SELECT trial_storage_gb AS trialStorageGb, paid_storage_gb AS paidStorageGb, revision FROM billing_settings WHERE id = 1').get() as BillingSettings;
    }
    commitSettings(settings: BillingSettings, input: { operationId: string; actor: string; reason: string; commandHash: string }) {
        return this.db.transaction(() => {
            const before = this.settings();
            if (!this.saveSettings(settings)) throw new BillingCommandError(409, 'stale_revision', 'Settings changed. Reload and preview before saving.');
            const after = this.settings();
            this.recordAction({ operationId: input.operationId, userId: '__deployment__', actor: input.actor, kind: 'allowance_change', reason: input.reason,
                outcome: 'applied', code: null, before: { ...before }, after: { ...after, commandHash: input.commandHash } });
            return after;
        }).immediate();
    }

    saveSettings(settings: BillingSettings): boolean {
        if (![settings.trialStorageGb, settings.paidStorageGb].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000)) throw new Error('Invalid storage limit.');
        return this.db.transaction(() => {
            const changed = this.db.prepare('UPDATE billing_settings SET trial_storage_gb = ?, paid_storage_gb = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
                .run(settings.trialStorageGb, settings.paidStorageGb, settings.revision).changes;
            if (changed) {
                this.db.prepare("UPDATE billing_offers SET trial_storage_gb = ?, paid_storage_gb = ? WHERE status = 'current'").run(settings.trialStorageGb, settings.paidStorageGb);
                this.db.prepare('UPDATE billing_offer_revision SET revision = revision + 1 WHERE id = 1').run();
            }
            return Boolean(changed);
        }).immediate();
    }

    async exclusive<T>(userId: string, operation: (token: string) => Promise<T>, options: { existingOnly?: boolean } = {}): Promise<T> {
        if (options.existingOnly) { if (!this.findAccount(userId)) throw new BillingAccountMissingError(); }
        else this.account(userId);
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
        const fields = ['customer_id', 'subscription_id', 'subscription_status', 'paid_until', 'renewal_grace_until', 'cancel_at_period_end', 'review_required', 'checkout_attempt', 'checkout_session_id', 'matched_offer_id', 'checkout_offer_id'] as const;
        const entries = fields.filter(key => values[key] !== undefined).map(key => [key, values[key]] as const);
        if (!entries.length) return;
        this.db.transaction(() => {
            const current = this.findAccount(userId);
            const changed = Boolean(current && entries.some(([key, value]) => (REVISIONED_FIELDS as readonly string[]).includes(key) && current[key] !== value));
            const result = this.db.prepare(`UPDATE billing_accounts SET ${entries.map(([key]) => `${key} = ?`).join(', ')}${changed ? ', admin_revision = admin_revision + 1' : ''} WHERE user_id = ? AND lock_token = ? AND lock_until > ?`)
                .run(...entries.map(([, value]) => value), userId, token, Date.now());
            if (!result.changes) throw new BillingBusyError();
        }).immediate();
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

/** A refused administrative command with a stable code and safe message. */
export class BillingCommandError extends Error {
    constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

export class BillingAccountMissingError extends Error {
    constructor() { super('Cloud has not been started for this account.'); }
}

function parse(value: string | number | null | undefined): Record<string, unknown> | null {
    if (typeof value !== 'string') return null;
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
}

function toAction(row: Record<string, string | number | null>): AdminActionRecord {
    return {
        operationId: String(row.operation_id), userId: String(row.user_id), actor: String(row.actor), kind: String(row.kind),
        reason: row.reason === null ? null : String(row.reason), createdAt: Number(row.created_at), outcome: String(row.outcome),
        code: row.code === null ? null : String(row.code), before: parse(row.before_json), after: parse(row.after_json),
    };
}
