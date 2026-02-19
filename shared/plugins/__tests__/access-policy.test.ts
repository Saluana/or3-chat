import { describe, expect, it } from 'vitest';
import {
    evaluatePluginGate,
    mergePluginGatePolicy,
    normalizePluginGatePolicy,
    StrictPluginGatePolicySchema,
} from '../access-policy';

describe('plugin access policy', () => {
    it('normalizes defaults', () => {
        expect(normalizePluginGatePolicy({})).toEqual({
            authRequired: false,
            requiredEntitlements: [],
            requiredWorkspaceRoles: [],
            mode: 'all',
        });
    });

    it('merges plugin defaults + admin overrides with admin precedence', () => {
        const merged = mergePluginGatePolicy(
            {
                authRequired: true,
                requiredEntitlements: ['paid'],
                requiredWorkspaceRoles: ['editor'],
                mode: 'all',
            },
            {
                requiredEntitlements: ['enterprise'],
                mode: 'any',
            }
        );

        expect(merged).toEqual({
            authRequired: true,
            requiredEntitlements: ['enterprise'],
            requiredWorkspaceRoles: ['editor'],
            mode: 'any',
        });
    });

    it('rejects unknown keys in strict schema', () => {
        const parsed = StrictPluginGatePolicySchema.safeParse({
            authRequired: true,
            bogus: true,
        });
        expect(parsed.success).toBe(false);
    });

    it('denies unauthenticated when auth is required', () => {
        const decision = evaluatePluginGate({
            policy: { authRequired: true },
            session: { authenticated: false },
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasons).toEqual(['unauthenticated']);
    });

    it('denies missing entitlement', () => {
        const decision = evaluatePluginGate({
            policy: { requiredEntitlements: ['paid'] },
            session: { authenticated: true, role: 'owner' },
            entitlements: ['free'],
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasons).toEqual(['missing-entitlement']);
    });

    it('denies insufficient role', () => {
        const decision = evaluatePluginGate({
            policy: { requiredWorkspaceRoles: ['owner'] },
            session: { authenticated: true, role: 'viewer' },
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasons).toEqual(['insufficient-role']);
    });

    it('allows when all gate requirements pass', () => {
        const decision = evaluatePluginGate({
            policy: {
                authRequired: true,
                requiredEntitlements: ['paid'],
                requiredWorkspaceRoles: ['owner', 'editor'],
            },
            session: { authenticated: true, role: 'editor' },
            entitlements: ['paid', 'beta'],
            pluginEnabled: true,
        });

        expect(decision.allowed).toBe(true);
        expect(decision.reasons).toEqual([]);
    });

    it('includes plugin-disabled reason deterministically', () => {
        const decision = evaluatePluginGate({
            policy: { authRequired: true },
            session: { authenticated: false },
            pluginEnabled: false,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasons).toEqual(['plugin-disabled', 'unauthenticated']);
    });
});
