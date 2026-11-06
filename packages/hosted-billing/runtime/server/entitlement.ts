import type { AccessBlock, AccessExplanation, AccessSource, BillingSettings, BillingState } from '../types';

/** Payment facts recorded by Stripe reconciliation. */
export interface PaymentFacts {
    trial_ends_at: number;
    subscription_id: string | null;
    subscription_status: string;
    paid_until: number;
    renewal_grace_until: number;
    review_required: number;
}

export interface SupportPause {
    startedAt: number;
    /** null means indefinite, not disabled. Inactive pauses are represented by a null pause. */
    expiresAt: number | null;
    actionId: string;
}

/** Operator exceptions. They never rewrite payment or original trial facts. */
export interface SupportState {
    revision: number;
    grantUntil: number;
    grantStorageBytes: number;
    trialExtensionUntil: number;
    bonusBytes: number;
    bonusUntil: number | null;
    hostedPause: SupportPause | null;
    uploadPause: SupportPause | null;
    jobPause: SupportPause | null;
}

const GB = 1_000_000_000;
const TRIAL_STATUSES = ['', 'incomplete', 'incomplete_expired', 'canceled'];

export function pauseActive(pause: SupportPause | null | undefined, now: number): boolean {
    return Boolean(pause && (pause.expiresAt === null || pause.expiresAt > now));
}

export interface Evaluation {
    state: BillingState;
    access: AccessExplanation;
}

/**
 * The single entitlement calculation used by enforcement (status, cloud access,
 * quota admission) and by the read-only admin inspector. Pure: no I/O.
 */
export function evaluateAccess(account: PaymentFacts | null, settings: BillingSettings, now: number, support: SupportState | null = null): Evaluation {
    if (!account) {
        return {
            state: 'expired',
            access: { allowed: false, source: 'none', expiresAt: null, blockers: ['cloud_not_started'], storageLimitBytes: 0, nominalStorageLimitBytes: 0, bonusBytes: 0 },
        };
    }
    const paidEnd = Math.max(account.paid_until, account.subscription_status === 'active' ? account.renewal_grace_until : 0);
    const paid = paidEnd > now && ['active', 'past_due'].includes(account.subscription_status);
    const trialEligible = TRIAL_STATUSES.includes(account.subscription_status);
    let source: AccessSource = 'none';
    let expiresAt: number | null = null;
    let nominal = 0;
    if (paid) {
        source = account.paid_until > now ? 'paid' : 'renewal_grace';
        expiresAt = paidEnd;
        nominal = settings.paidStorageGb * GB;
    } else if (account.trial_ends_at > now && account.paid_until === 0 && trialEligible) {
        source = 'trial';
        expiresAt = account.trial_ends_at;
        nominal = settings.trialStorageGb * GB;
    } else if (support && support.trialExtensionUntil > now && trialEligible) {
        source = 'support_trial';
        expiresAt = support.trialExtensionUntil;
        nominal = settings.trialStorageGb * GB;
    } else if (support && support.grantUntil > now) {
        source = 'grant';
        expiresAt = support.grantUntil;
        nominal = support.grantStorageBytes;
    }
    const blockers: AccessBlock[] = [];
    if (account.review_required) blockers.push('review_required');
    if (pauseActive(support?.hostedPause, now)) blockers.push('account_paused');
    if (source === 'none') blockers.push('entitlement_expired');
    const bonusBytes = support && support.bonusBytes > 0 && (support.bonusUntil === null || support.bonusUntil > now) ? support.bonusBytes : 0;
    // A bonus raises an entitlement's allowance; on its own it never grants access.
    const total = source === 'none' ? 0 : nominal + bonusBytes;
    const allowed = source !== 'none' && blockers.length === 0;
    const state: BillingState = account.review_required ? 'review'
        : blockers.includes('account_paused') ? 'paused'
        : source === 'paid' || source === 'renewal_grace' ? 'active'
        : source === 'trial' || source === 'support_trial' ? 'trial'
        : source === 'grant' ? 'grant'
        : account.subscription_id ? 'payment_required' : 'expired';
    return {
        state,
        access: { allowed, source, expiresAt, blockers, storageLimitBytes: allowed ? total : 0, nominalStorageLimitBytes: total, bonusBytes },
    };
}
