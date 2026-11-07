/** Shared labels for the customer directory and account inspector. GB is decimal. */
export function formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unknown';
    const units = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['KB', 1e3]] as const;
    for (const [unit, size] of units) {
        if (bytes >= size) return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / size)} ${unit}`;
    }
    return `${bytes} B`;
}

export function formatTime(ms: number | null | undefined): string {
    if (!ms) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

export const blockerLabels: Record<string, string> = {
    review_required: 'Payment review hold',
    account_paused: 'Hosted access paused by support',
    entitlement_expired: 'No active plan, trial or grant',
    cloud_not_started: 'Cloud not started',
};

export const sourceLabels: Record<string, string> = {
    paid: 'Paid plan',
    renewal_grace: 'Renewal grace period',
    trial: 'Trial',
    support_trial: 'Extended trial (support)',
    grant: 'Complimentary access (support)',
    none: 'No entitlement',
};

export const reviewLabels: Record<string, string> = {
    refund: 'Refund issued',
    dispute: 'Payment dispute opened',
    fraud_warning: 'Early fraud warning',
    conflicting_subscriptions: 'Conflicting subscriptions',
    legacy: 'Legacy review — reason unavailable',
};

export const actionLabels: Record<string, string> = {
    refresh: 'Refreshed from Stripe',
    resolve_review: 'Review resolved',
    grant: 'Complimentary access granted',
    revoke_grant: 'Complimentary access revoked',
    extend_trial: 'Trial extended',
    storage_bonus: 'Additional storage set',
    pause_account: 'Hosted access paused',
    resume_account: 'Hosted access resumed',
};

/** A fresh client operation ID; retained across retries of the same intended command. */
export function newOperationId(): string {
    return crypto.randomUUID();
}
