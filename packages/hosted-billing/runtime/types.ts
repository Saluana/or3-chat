export type BillingState = 'trial' | 'active' | 'grant' | 'expired' | 'payment_required' | 'review' | 'paused';
export type AccessSource = 'paid' | 'renewal_grace' | 'trial' | 'support_trial' | 'grant' | 'none';
export type AccessBlock = 'review_required' | 'account_paused' | 'entitlement_expired' | 'cloud_not_started';

/** Why an account can or cannot use hosted services. Grants never imply payment. */
export interface AccessExplanation {
    allowed: boolean;
    source: AccessSource;
    expiresAt: number | null;
    /** Every applicable blocker, not just the first. */
    blockers: AccessBlock[];
    /** Current admission allowance; 0 while access is blocked. */
    storageLimitBytes: number;
    /** Allowance the entitlement would provide if no blocker applied. */
    nominalStorageLimitBytes: number;
    bonusBytes: number;
}

export interface BillingStatus {
    userId: string;
    state: BillingState;
    source?: AccessSource;
    allowed: boolean;
    trialEndsAt: number;
    paidUntil: number;
    accessExpiresAt?: number;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
    storageUsedBytes?: number;
    storageLimitBytes: number;
    paidStorageLimitBytes: number;
    offer?: { amountCents: number; currency: string; interval: string; trialDays: number; paidStorageGb: number };
}

export interface BillingSettings {
    trialStorageGb: number;
    paidStorageGb: number;
    revision: number;
}
