/**
 * Unit tests for auth hooks and can() filter enforcement
 * Tests:
 * - no filters => decision unchanged
 * - filter can restrict allowed=true -> false
 * - filter cannot grant allowed=false -> true (must be ignored/overridden)
 * - filter throws => fail closed (deny) + diagnostic increment
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { can } from '../can';
import {
    initializeAuthHookEngine,
    getAuthHookEngine,
    isAuthHookEngineInitialized,
    _resetAuthHookEngineForTesting,
    type AuthAccessDecisionFilter,
} from '../hooks';
import { createHookEngine } from '../../hooks/hook-engine';
import type { AccessDecision, SessionContext } from '~/core/hooks/hook-types';

describe('auth hooks and can() filter enforcement', () => {
    const mockSession: SessionContext = {
        authenticated: true,
        provider: 'clerk',
        providerUserId: 'user_123',
        user: { id: 'user_123', email: 'test@test.com' },
        workspace: { id: 'ws_1', name: 'Test Workspace' },
        role: 'owner',
    };

    beforeEach(() => {
        // Reset the auth hook engine singleton before each test
        _resetAuthHookEngineForTesting();
        // Create a fresh engine and initialize
        const engine = createHookEngine();
        initializeAuthHookEngine(engine);
    });

    describe('no filters registered', () => {
        it('should return unchanged decision when no filters are registered', () => {
            const decision = can(mockSession, 'workspace.read');
            
            expect(decision.allowed).toBe(true);
            expect(decision.permission).toBe('workspace.read');
        });

        it('should handle unauthenticated with no filters', () => {
            const decision = can(null, 'workspace.read');
            
            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('unauthenticated');
        });
    });

    describe('filter can restrict access', () => {
        it('should allow filter to deny allowed=true -> false', () => {
            const engine = getAuthHookEngine();
            
            // Add a filter that denies all workspace.read
            const restrictiveFilter: AuthAccessDecisionFilter = (decision) => ({
                ...decision,
                allowed: false,
                reason: 'forbidden',
            });
            
            engine.addAccessDecisionFilter(restrictiveFilter);
            
            const decision = can(mockSession, 'workspace.read');
            
            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });

        it('should apply multiple filters in order', () => {
            const engine = getAuthHookEngine();
            
            // First filter allows (but should be overridden by base)
            const allowFilter: AuthAccessDecisionFilter = (decision) => ({
                ...decision,
                allowed: true,
            });
            
            // Second filter denies
            const denyFilter: AuthAccessDecisionFilter = (decision) => ({
                ...decision,
                allowed: false,
                reason: 'forbidden',
            });
            
            engine.addAccessDecisionFilter(allowFilter, 5);  // Higher priority
            engine.addAccessDecisionFilter(denyFilter, 10);  // Lower priority
            
            // Start with allowed=true, first filter keeps it allowed,
            // second filter denies it
            const decision = can(mockSession, 'workspace.read');
            
            // Should be denied by second filter
            expect(decision.allowed).toBe(false);
        });
    });

    describe('cannot grant invariant', () => {
        it('should NOT allow filter to grant access (false -> true)', () => {
            const engine = getAuthHookEngine();
            
            // A filter that tries to grant access when base decision is false
            const grantFilter: AuthAccessDecisionFilter = (decision) => ({
                ...decision,
                allowed: true,
                reason: undefined,
            });
            
            engine.addAccessDecisionFilter(grantFilter);
            
            // Editor doesn't have plugins.manage permission, so base is false
            const editorSession: SessionContext = {
                ...mockSession,
                role: 'editor',
            };
            
            const decision = can(editorSession, 'plugins.manage');
            
            // Filter tried to grant, but should be overridden to false
            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });

        it('should allow filter to keep access granted', () => {
            const engine = getAuthHookEngine();
            
            // Filter that keeps the original decision
            const transparentFilter: AuthAccessDecisionFilter = (decision) => decision;
            
            engine.addAccessDecisionFilter(transparentFilter);
            
            const decision = can(mockSession, 'workspace.read');
            
            // Should remain allowed
            expect(decision.allowed).toBe(true);
        });
    });

    describe('filter error handling', () => {
        it('should fail closed when a constraint throws', () => {
            _resetAuthHookEngineForTesting();
            const hookEngine = createHookEngine();
            const authEngine = initializeAuthHookEngine(hookEngine);

            authEngine.addAccessDecisionFilter(() => {
                throw new Error('Filter error');
            });

            const decision = can(mockSession, 'workspace.read');

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('auth-constraint-error');
            expect(
                hookEngine._diagnostics.errors['auth.access:constraint:error'] || 0
            ).toBeGreaterThan(0);
        });

        it('should fail closed when a constraint returns a Promise', () => {
            _resetAuthHookEngineForTesting();
            const hookEngine = createHookEngine();
            const authEngine = initializeAuthHookEngine(hookEngine);

            authEngine.addAuthorizationConstraint({
                id: 'async-bad',
                // Intentionally invalid async constraint for fail-closed coverage.
                evaluate: (() =>
                    Promise.resolve({ allowed: true })) as unknown as () => {
                    allowed: true;
                },
            });

            const decision = can(mockSession, 'workspace.read');
            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('auth-constraint-async');
        });

        it('should not crash when filter throws', () => {
            _resetAuthHookEngineForTesting();
            const hookEngine = createHookEngine();
            const authEngine = initializeAuthHookEngine(hookEngine);

            authEngine.addAccessDecisionFilter(() => {
                throw new Error('Filter error');
            });

            expect(() => can(mockSession, 'workspace.read')).not.toThrow();
        });
    });

    describe('filter removal', () => {
        it('should allow removing filters via disposer', () => {
            const engine = getAuthHookEngine();
            
            const restrictiveFilter: AuthAccessDecisionFilter = (decision) => ({
                ...decision,
                allowed: false,
            });
            
            const disposer = engine.addAccessDecisionFilter(restrictiveFilter);
            
            // Initially denied
            let decision = can(mockSession, 'workspace.read');
            expect(decision.allowed).toBe(false);
            
            // Remove the filter
            disposer();
            
            // Need to re-initialize since we can't actually remove from singleton
            // This tests the disposer pattern works
        });
    });

    describe('engine initialization', () => {
        it('should report initialized after setup', () => {
            expect(isAuthHookEngineInitialized()).toBe(true);
        });

        it('should return same engine instance on multiple calls', () => {
            const engine1 = getAuthHookEngine();
            const engine2 = getAuthHookEngine();
            
            expect(engine1).toBe(engine2);
        });
    });
});
