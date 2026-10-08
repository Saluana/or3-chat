import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { ACTIVE_WORKSPACE_REVISION_STORAGE_KEY } from '~/composables/workspace/activeWorkspaceRevision';

const sessionState = ref({
    session: {
        authenticated: true,
        workspace: { id: 'workspace-a' },
        authorizationRevision: 1,
    } as null | {
        authenticated: boolean;
        workspace: { id: string };
        authorizationRevision: number;
        expiresAt?: string;
    },
});
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
    let scope: EffectScope;
    let listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]>;
    afterEach(() => {
        scope.stop();
        for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    beforeEach(() => {
        vi.resetModules();
        scope = effectScope();
        listeners = [];
        const addListener = window.addEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
            if (listener) listeners.push([window, type, listener]);
            addListener(type, listener, options);
        });
        const addDocumentListener = document.addEventListener.bind(document);
        vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
            if (listener) listeners.push([document, type, listener]);
            addDocumentListener(type, listener, options);
        });
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
        (globalThis as any).defineNuxtPlugin = (plugin: () => unknown) => scope.run(plugin);
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

    // Failure inventory: idle expiry, background timer suspension, failed renewal,
    // signed-out sessions, and renewal that returns the same expiry (no retry loop).
    it('renews an idle session at expiry and schedules the renewed session', async () => {
        vi.useFakeTimers();
        const expiresAt = Date.now() + 1_000;
        sessionState.value.session!.expiresAt = new Date(expiresAt).toISOString();
        sessionRefreshMock.mockImplementation(async () => {
            sessionState.value.session!.expiresAt = new Date(Date.now() + 60_000).toISOString();
        });
        await import('../11.auth-session-refresh.client');
        await vi.advanceTimersByTimeAsync(1_001);
        expect(sessionRefreshMock).toHaveBeenCalledTimes(1);
        expect(reloadNuxtAppMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60_001);
        expect(sessionRefreshMock).toHaveBeenCalledTimes(2);
    });

    it('retries an expired session on focus after a failed idle renewal', async () => {
        vi.useFakeTimers();
        sessionState.value.session!.expiresAt = new Date(Date.now() + 1_000).toISOString();
        sessionRefreshMock.mockRejectedValueOnce(new Error('offline'));
        await import('../11.auth-session-refresh.client');
        await vi.advanceTimersByTimeAsync(1_001);
        expect(sessionRefreshMock).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();
        expect(sessionRefreshMock).toHaveBeenCalledTimes(2);
    });

    it('does not loop when the server returns an unchanged expiry', async () => {
        vi.useFakeTimers();
        sessionState.value.session!.expiresAt = new Date(Date.now() + 1_000).toISOString();
        await import('../11.auth-session-refresh.client');
        await vi.advanceTimersByTimeAsync(120_000);
        expect(sessionRefreshMock).toHaveBeenCalledTimes(1);
    });

    it('cancels idle renewal when the session is signed out', async () => {
        vi.useFakeTimers();
        sessionState.value.session!.expiresAt = new Date(Date.now() + 1_000).toISOString();
        await import('../11.auth-session-refresh.client');
        sessionState.value.session = null;
        await vi.advanceTimersByTimeAsync(1_001);
        window.dispatchEvent(new Event('focus'));
        expect(sessionRefreshMock).not.toHaveBeenCalled();
    });

});
