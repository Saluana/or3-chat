import { describe, expect, it } from 'vitest';
import { evaluateReviewedPluginGrant, type PluginGrantReviewSnapshot } from '../grant-review';

function review(
    overrides: Partial<PluginGrantReviewSnapshot> = {}
): PluginGrantReviewSnapshot {
    return {
        requestedGrants: ['documents.read', 'documents.write'],
        approvedGrants: ['documents.read'],
        revision: 'sha256-review',
        status: 'current',
        ...overrides,
    };
}

describe('reviewed plugin grant mediation', () => {
    it('allows only a currently reviewed and approved grant', () => {
        expect(evaluateReviewedPluginGrant(review(), 'documents.read')).toEqual({
            allowed: true,
            grant: 'documents.read',
        });
    });

    it.each(['unreviewed', 'stale'] as const)('denies %s review state', (status) => {
        expect(
            evaluateReviewedPluginGrant(review({ status }), 'documents.read')
        ).toEqual({
            allowed: false,
            grant: 'documents.read',
            reason: 'grant-review-required',
        });
    });

    it('distinguishes an unrequested grant from a denied requested grant', () => {
        expect(evaluateReviewedPluginGrant(review(), 'storage.delete')).toMatchObject({
            allowed: false,
            reason: 'grant-not-requested',
        });
        expect(evaluateReviewedPluginGrant(review(), 'documents.write')).toMatchObject({
            allowed: false,
            reason: 'grant-not-approved',
        });
    });
});
