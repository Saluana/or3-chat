import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_WORKSPACE_REVISION_STORAGE_KEY } from '~/composables/workspace/activeWorkspaceRevision';

const sessionState = {
    value: {
        session: {
            authenticated: true,
            workspace: { id: 'workspace-a' },
            authorizationRevision: 1,
        } as null | {
            authenticated: boolean;
            workspace: { id: string };
            authorizationRevision: number;
        },
    },
};
const sessionRefreshMock = vi.fn();
const refreshWorkspaceRevisionMock = vi.fn();
const reloadNuxtAppMock = vi.fn();
const confirmClientSignedOutMock = vi.fn(async () => false);

vi.mock('~/composables/auth/useSessionContext', () => ({
    useSessionContext: () => ({
        data: sessionState,
        refresh: sessionRefreshMock,
    }),
}));

vi.mock('~/composables/auth/confirmClientSignedOut', () => ({
    confirmClientSignedOut: confirmClientSignedOutMock,
}));

vi.mock('~/composables/workspace/useWorkspaceManagerSession', () => ({
    useWorkspaceManagerSession: () => ({
        refreshSessionForActiveWorkspaceRevision: refreshWorkspaceRevisionMock,
    }),
}));

describe('auth session cross-tab workspace refresh', () => {
    beforeEach(() => {
        vi.resetModules();
        sessionRefreshMock.mockReset();
        confirmClientSignedOutMock.mockReset().mockResolvedValue(false);
        refreshWorkspaceRevisionMock.mockReset().mockImplementation(async (revision) => {
            sessionState.value.session = {
                authenticated: true,
                workspace: { id: revision.workspaceId },
                authorizationRevision: revision.authorizationRevision ?? 1,
            };
            return true;
        });
        reloadNuxtAppMock.mockReset();
        sessionState.value.session = {
            authenticated: true,
            workspace: { id: 'workspace-a' },
            authorizationRevision: 1,
        };
        (globalThis as any).defineNuxtPlugin = (plugin: () => unknown) => plugin();
        (globalThis as any).useRuntimeConfig = () => ({
            public: { ssrAuthEnabled: true },
        });
        (globalThis as any).reloadNuxtApp = reloadNuxtAppMock;
    });

    it('applies a newer storage revision and ignores an older one', async () => {
        await import('../11.auth-session-refresh.client');

        const newer = {
            revision: 2,
            actorId: 'tab-b',
            workspaceId: 'workspace-b',
            phase: 'committed',
            authorizationRevision: 2,
        } as const;
        window.dispatchEvent(
            new StorageEvent('storage', {
                key: ACTIVE_WORKSPACE_REVISION_STORAGE_KEY,
                newValue: JSON.stringify(newer),
            })
        );
        await vi.waitFor(() => {
            expect(refreshWorkspaceRevisionMock).toHaveBeenCalledWith(newer);
        });
        expect(reloadNuxtAppMock).toHaveBeenCalledWith({ ttl: 500 });

        window.dispatchEvent(
            new StorageEvent('storage', {
                key: ACTIVE_WORKSPACE_REVISION_STORAGE_KEY,
                newValue: JSON.stringify({
                    revision: 1,
                    actorId: 'tab-a',
                    workspaceId: 'workspace-a',
                    phase: 'committed',
                    authorizationRevision: 1,
                }),
            })
        );
        await Promise.resolve();

        expect(refreshWorkspaceRevisionMock).toHaveBeenCalledTimes(1);
        expect(sessionState.value.session?.workspace.id).toBe('workspace-b');
    });

    it('does not reload on auth flip to signed-out when confirmation fails', async () => {
        sessionRefreshMock.mockImplementation(async () => {
            sessionState.value.session = null;
            return sessionState.value;
        });
        confirmClientSignedOutMock.mockResolvedValue(false);

        await import('../11.auth-session-refresh.client');
        window.dispatchEvent(new CustomEvent('or3:auth-session-changed'));

        await vi.waitFor(() => {
            expect(sessionRefreshMock).toHaveBeenCalled();
        });
        expect(confirmClientSignedOutMock).toHaveBeenCalled();
        expect(reloadNuxtAppMock).not.toHaveBeenCalled();
    });

    it('reloads on auth flip to signed-out when confirmation succeeds', async () => {
        sessionRefreshMock.mockImplementation(async () => {
            sessionState.value.session = null;
            return sessionState.value;
        });
        confirmClientSignedOutMock.mockResolvedValue(true);

        await import('../11.auth-session-refresh.client');
        window.dispatchEvent(new CustomEvent('or3:auth-session-changed'));

        await vi.waitFor(() => {
            expect(reloadNuxtAppMock).toHaveBeenCalledWith({ ttl: 500 });
        });
    });
});
