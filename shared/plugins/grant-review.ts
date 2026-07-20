export type PluginGrantReviewStatus = 'current' | 'unreviewed' | 'stale';

export interface PluginGrantReviewSnapshot {
    readonly requestedGrants: readonly string[];
    readonly approvedGrants: readonly string[];
    readonly revision: string;
    readonly status: PluginGrantReviewStatus;
}

export type PluginGrantDecisionReason =
    | 'grant-review-required'
    | 'grant-not-requested'
    | 'grant-not-approved';

export type PluginGrantDecision =
    | { readonly allowed: true; readonly grant: string }
    | {
          readonly allowed: false;
          readonly grant: string;
          readonly reason: PluginGrantDecisionReason;
      };

/** Fail-closed check used by mediated host APIs before performing an operation. */
export function evaluateReviewedPluginGrant(
    review: PluginGrantReviewSnapshot,
    grant: string
): PluginGrantDecision {
    if (review.status !== 'current') {
        return { allowed: false, grant, reason: 'grant-review-required' };
    }
    if (!review.requestedGrants.includes(grant)) {
        return { allowed: false, grant, reason: 'grant-not-requested' };
    }
    if (!review.approvedGrants.includes(grant)) {
        return { allowed: false, grant, reason: 'grant-not-approved' };
    }
    return { allowed: true, grant };
}
