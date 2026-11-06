export interface BillingStatus {
    userId: string;
    state: 'trial' | 'active' | 'expired' | 'payment_required' | 'review';
    allowed: boolean;
    trialEndsAt: number;
    paidUntil: number;
    accessExpiresAt?: number;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
    storageUsedBytes?: number;
    storageLimitBytes: number;
    paidStorageLimitBytes: number;
}

export interface BillingSettings {
    trialStorageGb: number;
    paidStorageGb: number;
    revision: number;
}
