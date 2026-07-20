import { describe, it, expect } from 'vitest';
import { resolveOpenRouterKeyAvailability } from '../../app/core/auth/openRouterKeyAvailability';

describe('resolveOpenRouterKeyAvailability', () => {
    it('allows user keys by default when no instance key', () => {
        const avail = resolveOpenRouterKeyAvailability({});
        expect(avail.allowUserOverride).toBe(true);
        expect(avail.hasInstanceKey).toBe(false);
        expect(avail.canAcceptUserKey).toBe(true);
        expect(avail.hasUsableKey(null)).toBe(false);
        expect(avail.hasUsableKey('sk-or-test')).toBe(true);
    });

    it('hides connect UI when an instance key is enough', () => {
        const avail = resolveOpenRouterKeyAvailability({
            hasInstanceKey: true,
            requireUserKey: false,
        });
        expect(avail.hasInstanceKey).toBe(true);
        expect(avail.canAcceptUserKey).toBe(false);
        expect(avail.hasUsableKey(null)).toBe(true);
    });

    it('forces user key when requireUserKey is set', () => {
        const avail = resolveOpenRouterKeyAvailability({
            hasInstanceKey: true,
            requireUserKey: true,
            allowUserOverride: false,
        });
        expect(avail.requireUserKey).toBe(true);
        expect(avail.allowUserOverride).toBe(true);
        expect(avail.hasInstanceKey).toBe(false);
        expect(avail.canAcceptUserKey).toBe(true);
        expect(avail.hasUsableKey(null)).toBe(false);
    });
});
