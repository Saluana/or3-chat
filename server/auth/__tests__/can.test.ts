import { describe, it, expect, vi } from 'vitest';
import { can } from '../can';
import type { SessionContext, Permission } from '~/core/hooks/hook-types';

describe('can()', () => {
    const mockOwnerSession: SessionContext = {
        authenticated: true,
        provider: 'clerk',
        providerUserId: 'user_123',
        user: { id: 'user_123', email: 'owner@test.com' },
        workspace: { id: 'ws_1', name: 'Test Workspace' },
        role: 'owner',
    };

    const mockEditorSession: SessionContext = {
        authenticated: true,
        provider: 'clerk',
        providerUserId: 'user_456',
        user: { id: 'user_456', email: 'editor@test.com' },
        workspace: { id: 'ws_1', name: 'Test Workspace' },
        role: 'editor',
    };

    const mockNoRoleSession: SessionContext = {
        authenticated: true,
        provider: 'clerk',
        providerUserId: 'user_789',
        user: { id: 'user_789' },
    };

    describe('unauthenticated session', () => {
        it('returns unauthenticated reason when session is null', () => {
            const decision = can(null, 'workspace.read');

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('unauthenticated');
            expect(decision.permission).toBe('workspace.read');
        });

        it('returns unauthenticated reason when session.authenticated is false', () => {
            const decision = can({ authenticated: false }, 'workspace.read');

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('unauthenticated');
        });
    });

    describe('role-based permissions', () => {
        const ownerPermissions: Permission[] = [
            'workspace.read',
            'workspace.write',
            'workspace.settings.manage',
            'users.manage',
            'plugins.manage',
        ];

        it.each(ownerPermissions)('allows %s permission for owner', (permission) => {
            const decision = can(mockOwnerSession, permission);

            expect(decision.allowed).toBe(true);
            expect(decision.role).toBe('owner');
            expect(decision.userId).toBe('user_123');
            expect(decision.workspaceId).toBe('ws_1');
        });

        it('allows workspace.read and workspace.write for editor', () => {
            expect(can(mockEditorSession, 'workspace.read').allowed).toBe(true);
            expect(can(mockEditorSession, 'workspace.write').allowed).toBe(true);
        });

        it('denies elevated permissions for editor', () => {
            expect(can(mockEditorSession, 'workspace.settings.manage').allowed).toBe(false);
            expect(can(mockEditorSession, 'admin.access').allowed).toBe(false);
        });
    });

    describe('missing role vs missing auth', () => {
        it('denies when role is missing (forbidden)', () => {
            const decision = can(mockNoRoleSession, 'workspace.read');
            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });

        it('denies when unauthenticated (unauthenticated)', () => {
            const decision = can({ authenticated: false }, 'workspace.read');
            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('unauthenticated');
        });
    });

    describe('workspace scoping', () => {
        it('includes resource in decision', () => {
            const resource = { kind: 'thread', id: 'thread_123' };
            const decision = can(mockOwnerSession, 'workspace.read', resource);

            expect(decision.resource).toEqual(resource);
        });

        it('denies cross-workspace access when resource workspace id mismatches', () => {
            const decision = can(mockOwnerSession, 'workspace.write', {
                kind: 'workspace',
                id: 'ws_2',
            });

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });
    });

    describe('admin access', () => {
        it('allows admin.access when deploymentAdmin=true regardless of role', () => {
            const decision = can(
                {
                    ...mockEditorSession,
                    deploymentAdmin: true,
                },
                'admin.access',
                { kind: 'workspace', id: 'ws_1' }
            );

            expect(decision.allowed).toBe(true);
        });
    });

    describe('cannot grant invariant', () => {
        it('base decision starts denied for missing permission', () => {
            const decision = can(mockEditorSession, 'plugins.manage');
            expect(decision.allowed).toBe(false);
        });

        it('decision is granted only when role has permission', () => {
            const decision = can(mockOwnerSession, 'workspace.read');
            expect(decision.allowed).toBe(true);
        });
    });

    it('uses deterministic baseline when auth filter engine is unavailable', async () => {
        vi.resetModules();
        vi.doMock('../hooks', () => ({
            isAuthHookEngineInitialized: () => false,
            getAuthHookEngine: () => ({
                applyAccessDecisionFilters: () => {
                    throw new Error('should not be called');
                },
            }),
        }));

        const { can: canWithUnavailableEngine } = await import('../can');

        const decision = canWithUnavailableEngine(mockOwnerSession, 'workspace.read');
        expect(decision.allowed).toBe(true);

        vi.doUnmock('../hooks');
    });
});
