/**
 * Unit tests for can() authorization function.
 */
import { describe, it, expect } from 'vitest';
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

    describe('owner role', () => {
        const ownerPermissions: Permission[] = [
            'workspace.read',
            'workspace.write',
            'workspace.settings.manage',
            'users.manage',
            'plugins.manage',
            'admin.access',
        ];

        it.each(ownerPermissions)(
            'allows %s permission for owner',
            (permission) => {
                const decision = can(mockOwnerSession, permission);

                expect(decision.allowed).toBe(true);
                expect(decision.role).toBe('owner');
                expect(decision.userId).toBe('user_123');
                expect(decision.workspaceId).toBe('ws_1');
            }
        );
    });

    describe('editor role', () => {
        it('allows workspace.read for editor', () => {
            const decision = can(mockEditorSession, 'workspace.read');

            expect(decision.allowed).toBe(true);
            expect(decision.role).toBe('editor');
        });

        it('allows workspace.write for editor', () => {
            const decision = can(mockEditorSession, 'workspace.write');

            expect(decision.allowed).toBe(true);
        });

        it('denies workspace.settings.manage for editor', () => {
            const decision = can(mockEditorSession, 'workspace.settings.manage');

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });

        it('allows admin.access for editor', () => {
            const decision = can(mockEditorSession, 'admin.access');

            expect(decision.allowed).toBe(true);
            expect(decision.role).toBe('editor');
        });
    });

    describe('no role', () => {
        it('denies all permissions when role is undefined', () => {
            const decision = can(mockNoRoleSession, 'workspace.read');

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });
    });

    describe('resource context', () => {
        it('includes resource in decision', () => {
            const resource = { kind: 'thread', id: 'thread_123' };
            const decision = can(mockOwnerSession, 'workspace.read', resource);

            expect(decision.resource).toEqual(resource);
        });
    });

    describe('cannot grant invariant', () => {
        // This test verifies the design principle that filters can only restrict,
        // never grant access. The base implementation ensures this by:
        // 1. Starting with allowed: false
        // 2. Only setting allowed: true if role has the permission
        // 3. Future hook implementations will clamp: final.allowed = base.allowed && filtered.allowed

        it('base decision starts as denied', () => {
            // If the role doesn't have the permission, it stays denied
            const decision = can(mockEditorSession, 'plugins.manage');
            expect(decision.allowed).toBe(false);
        });

        it('decision is granted only when role has permission', () => {
            const decision = can(mockOwnerSession, 'admin.access');
            expect(decision.allowed).toBe(true);
        });
    });
});
