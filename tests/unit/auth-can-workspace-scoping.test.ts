/**
 * Tests for workspace resource scoping in can() authorization
 * 
 * Issue: can() was ignoring resource.id parameter, making workspace-scoped
 * authorization checks ineffective and allowing potential cross-workspace access.
 * 
 * Fix: can() now enforces workspace scoping by verifying session.workspace.id
 * matches resource.id when resource.kind === 'workspace'.
 */
import { describe, it, expect } from 'vitest';
import { can } from '../../server/auth/can';
import type { SessionContext } from '../../core/hooks/hook-types';

describe('Auth - can() workspace resource scoping', () => {
    const createSession = (workspaceId: string, role: 'owner' | 'editor' | 'viewer' = 'editor'): SessionContext => ({
        authenticated: true,
        provider: 'clerk',
        providerUserId: 'user_123',
        user: {
            id: 'user_123',
            email: 'test@example.com',
            displayName: 'Test User',
        },
        workspace: {
            id: workspaceId,
            name: 'Test Workspace',
        },
        role,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        deploymentAdmin: false,
    });

    describe('workspace.write permission', () => {
        it('should allow write to session workspace', () => {
            const session = createSession('workspace-1', 'editor');
            const decision = can(session, 'workspace.write', {
                kind: 'workspace',
                id: 'workspace-1',
            });

            expect(decision.allowed).toBe(true);
            expect(decision.reason).toBeUndefined();
        });

        it('should deny write to different workspace', () => {
            const session = createSession('workspace-1', 'editor');
            const decision = can(session, 'workspace.write', {
                kind: 'workspace',
                id: 'workspace-2',
            });

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('forbidden');
        });

        it('should allow write when no resource id specified (legacy behavior)', () => {
            const session = createSession('workspace-1', 'editor');
            const decision = can(session, 'workspace.write', {
                kind: 'workspace',
            });

            expect(decision.allowed).toBe(true);
        });

        it('should allow write when no resource specified at all', () => {
            const session = createSession('workspace-1', 'editor');
            const decision = can(session, 'workspace.write');

            expect(decision.allowed).toBe(true);
        });
    });

    describe('workspace.read permission', () => {
        it('should allow read from session workspace', () => {
            const session = createSession('workspace-1', 'viewer');
            const decision = can(session, 'workspace.read', {
                kind: 'workspace',
                id: 'workspace-1',
            });

            expect(decision.allowed).toBe(true);
        });

        it('should deny read from different workspace', () => {
            const session = createSession('workspace-1', 'viewer');
            const decision = can(session, 'workspace.read', {
                kind: 'workspace',
                id: 'workspace-2',
            });

            expect(decision.allowed).toBe(false);
        });
    });

    describe('non-workspace resources', () => {
        it('should not apply workspace scoping to other resource kinds', () => {
            const session = createSession('workspace-1', 'editor');
            const decision = can(session, 'workspace.write', {
                kind: 'project',
                id: 'some-other-id',
            });

            // Should be allowed because resource.kind !== 'workspace'
            expect(decision.allowed).toBe(true);
        });
    });

    describe('owner role', () => {
        it('should enforce workspace scoping for owners too', () => {
            const session = createSession('workspace-1', 'owner');
            const decision = can(session, 'workspace.settings.manage', {
                kind: 'workspace',
                id: 'workspace-2',
            });

            expect(decision.allowed).toBe(false);
        });

        it('should allow settings management in session workspace', () => {
            const session = createSession('workspace-1', 'owner');
            const decision = can(session, 'workspace.settings.manage', {
                kind: 'workspace',
                id: 'workspace-1',
            });

            expect(decision.allowed).toBe(true);
        });
    });

    describe('unauthenticated sessions', () => {
        it('should deny access to any workspace', () => {
            const session: SessionContext = { authenticated: false };
            const decision = can(session, 'workspace.read', {
                kind: 'workspace',
                id: 'workspace-1',
            });

            expect(decision.allowed).toBe(false);
            expect(decision.reason).toBe('unauthenticated');
        });
    });

    describe('edge cases', () => {
        it('should handle missing workspace in session', () => {
            const session: SessionContext = {
                authenticated: true,
                provider: 'clerk',
                providerUserId: 'user_123',
                user: {
                    id: 'user_123',
                    email: 'test@example.com',
                    displayName: 'Test User',
                },
                // No workspace
                role: 'editor',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                deploymentAdmin: false,
            };

            const decision = can(session, 'workspace.write', {
                kind: 'workspace',
                id: 'workspace-1',
            });

            expect(decision.allowed).toBe(false);
        });

        it('should handle empty workspace id in session', () => {
            const session = createSession('', 'editor');
            const decision = can(session, 'workspace.write', {
                kind: 'workspace',
                id: 'workspace-1',
            });

            expect(decision.allowed).toBe(false);
        });
    });
});
