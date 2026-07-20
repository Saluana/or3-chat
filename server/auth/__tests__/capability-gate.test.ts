import { describe, expect, it } from 'vitest';
import type { SessionContext } from '~/core/hooks/hook-types';
import { evaluateCapability } from '../capability-gate';

const workspace = { id: 'workspace-1', name: 'Workspace 1' };

function session(
    role: SessionContext['role'],
    extra: Partial<SessionContext> = {}
): SessionContext {
    return {
        authenticated: true,
        user: { id: `user-${role ?? 'none'}` },
        workspace,
        role,
        authorizationRevision: 7,
        ...extra,
    };
}

describe('CapabilityGate', () => {
    it.each([null, { authenticated: false }])(
        'returns the same unauthenticated result without identity details',
        (value) => {
            expect(
                evaluateCapability(value as SessionContext | null, 'workspace.read', {
                    kind: 'workspace',
                    id: workspace.id,
                })
            ).toEqual({ ok: false, code: 'unauthenticated' });
        }
    );

    it('allows viewers to read but denies all write authority', () => {
        const viewer = session('viewer');

        expect(
            evaluateCapability(viewer, 'workspace.read', {
                kind: 'workspace',
                id: workspace.id,
            }).ok
        ).toBe(true);
        expect(
            evaluateCapability(viewer, 'workspace.write', {
                kind: 'workspace',
                id: workspace.id,
            })
        ).toEqual({ ok: false, code: 'forbidden' });
        expect(
            evaluateCapability(viewer, 'ai.background', {
                kind: 'workspace',
                id: workspace.id,
            })
        ).toEqual({ ok: false, code: 'forbidden' });
    });

    it('derives editor capabilities and authorization revision from the session', () => {
        const result = evaluateCapability(session('editor'), 'ai.paid', {
            kind: 'workspace',
            id: workspace.id,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected authorization');
        expect(result.context).toMatchObject({
            userId: 'user-editor',
            workspaceId: workspace.id,
            sessionRevision: 7,
        });
        expect(result.context.capabilities).toEqual(
            new Set([
                'workspace.read',
                'workspace.write',
                'storage.write',
                'ai.paid',
                'ai.background',
                'tool.execute',
            ])
        );
    });

    it('allows owners to manage users and sync retention', () => {
        const owner = session('owner');
        expect(evaluateCapability(owner, 'users.manage').ok).toBe(true);
        expect(evaluateCapability(owner, 'sync.gc').ok).toBe(true);
    });

    it('allows a deployment admin to perform storage GC', () => {
        const admin = session('viewer', { deploymentAdmin: true });
        expect(
            evaluateCapability(admin, 'storage.gc', {
                kind: 'workspace',
                id: workspace.id,
            }).ok
        ).toBe(true);
    });

    it.each(['workspace-does-not-exist', 'workspace-other'])(
        'returns the same opaque wrong-workspace result for %s',
        (workspaceId) => {
            expect(
                evaluateCapability(session('owner'), 'workspace.read', {
                    kind: 'workspace',
                    id: workspaceId,
                })
            ).toEqual({ ok: false, code: 'wrong_workspace' });
        }
    );
});
