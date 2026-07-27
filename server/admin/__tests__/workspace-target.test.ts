import { describe, expect, it } from 'vitest';
import type { AdminRequestContext } from '../context';
import { resolveAdminWorkspaceTarget } from '../workspace-target';

const workspaceAdmin: AdminRequestContext = {
    principal: {
        kind: 'workspace_admin',
        userId: 'user-1',
        session: {
            authenticated: true,
            user: { id: 'user-1' },
            workspace: { id: 'workspace-a', name: 'Workspace A' },
            role: 'owner',
        },
    },
    session: {
        authenticated: true,
        user: { id: 'user-1' },
        workspace: { id: 'workspace-a', name: 'Workspace A' },
        role: 'owner',
    },
};

describe('resolveAdminWorkspaceTarget', () => {
    it('allows a super admin to explicitly target a workspace', () => {
        expect(
            resolveAdminWorkspaceTarget(
                {
                    principal: { kind: 'super_admin', username: 'root' },
                },
                'workspace-b'
            )
        ).toBe('workspace-b');
    });

    it('uses the session workspace for workspace admins', () => {
        expect(resolveAdminWorkspaceTarget(workspaceAdmin)).toBe('workspace-a');
    });

    it('rejects workspace-admin attempts to target another workspace', () => {
        expect(() =>
            resolveAdminWorkspaceTarget(workspaceAdmin, 'workspace-b')
        ).toThrow(/does not match session/i);
    });
});
