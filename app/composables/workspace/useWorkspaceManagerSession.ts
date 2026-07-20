import type { useSessionContext } from '~/composables/auth/useSessionContext';
import {
    activeWorkspaceRevisionCoordinator,
    type ActiveWorkspaceRevision,
    type ActiveWorkspaceRevisionCoordinator,
} from './activeWorkspaceRevision';
import { shouldClearWorkspaceForNullSession } from './shouldClearWorkspaceForNullSession';

type SessionContextLike = ReturnType<typeof useSessionContext>;

export interface ActiveWorkspaceChangeResult {
    committed: boolean;
    revision: ActiveWorkspaceRevision;
}

export function useWorkspaceManagerSession(
    sessionContext: SessionContextLike,
    options?: {
        authSessionStorageKey?: string;
        revisionCoordinator?: ActiveWorkspaceRevisionCoordinator;
        delaysMs?: number[];
    }
) {
    const authSessionStorageKey =
        options?.authSessionStorageKey ?? 'or3:auth-session-changed';
    const revisionCoordinator =
        options?.revisionCoordinator ?? activeWorkspaceRevisionCoordinator;
    const delaysMs = options?.delaysMs ?? [0, 100, 200, 400, 800];

    const currentWorkspaceId = (): string | null =>
        sessionContext.data.value?.session?.workspace?.id ?? null;

    const currentAuthorizationRevision = (): number | undefined =>
        sessionContext.data.value?.session?.authorizationRevision;

    async function refreshSessionUntilWorkspace(
        workspaceId: string,
        isCurrent: () => boolean = () => true
    ): Promise<boolean> {
        for (const delay of delaysMs) {
            if (!isCurrent()) return false;
            if (delay) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            if (!isCurrent()) return false;
            await sessionContext.refresh();
            if (!isCurrent()) return false;
            if (currentWorkspaceId() === workspaceId) return true;
        }
        return false;
    }

    async function refreshSessionAfterWorkspaceRemoval(
        removedWorkspaceId: string
    ): Promise<string | null> {
        let latestWorkspaceId: string | null = null;

        for (const delay of delaysMs) {
            if (delay) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            await sessionContext.refresh();
            latestWorkspaceId = currentWorkspaceId();
            if (latestWorkspaceId !== removedWorkspaceId) {
                return latestWorkspaceId;
            }
        }

        return latestWorkspaceId;
    }

    async function refreshSessionForActiveWorkspaceRevision(
        revision: ActiveWorkspaceRevision
    ): Promise<boolean> {
        if (revision.phase === 'rejected') {
            await sessionContext.refresh();
            return revisionCoordinator.isCurrent(revision);
        }

        for (const delay of delaysMs) {
            if (!revisionCoordinator.isCurrent(revision)) return false;
            if (delay) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            if (!revisionCoordinator.isCurrent(revision)) return false;
            await sessionContext.refresh();
            if (!revisionCoordinator.isCurrent(revision)) return false;

            const workspaceMatches = currentWorkspaceId() === revision.workspaceId;
            const authorizationMatches =
                revision.authorizationRevision === undefined ||
                (currentAuthorizationRevision() ?? -1) >=
                    revision.authorizationRevision;
            if (workspaceMatches && authorizationMatches) return true;
        }
        return false;
    }

    async function repairSupersededWorkspaceChange(
        staleRevision: ActiveWorkspaceRevision,
        setActiveWorkspace: (workspaceId: string) => Promise<void>
    ): Promise<ActiveWorkspaceRevision> {
        const winner = revisionCoordinator.current();
        if (!winner || revisionCoordinator.isCurrent(staleRevision)) {
            return staleRevision;
        }

        if (winner.phase !== 'rejected' && winner.workspaceId) {
            await setActiveWorkspace(winner.workspaceId);
            const confirmed = await refreshSessionUntilWorkspace(
                winner.workspaceId,
                () => revisionCoordinator.isCurrent(winner)
            );
            if (!revisionCoordinator.isCurrent(winner)) {
                return revisionCoordinator.current() ?? winner;
            }
            if (!confirmed) {
                return (
                    revisionCoordinator.updatePhase(
                        winner,
                        'rejected',
                        currentAuthorizationRevision()
                    ) ?? winner
                );
            }
            return (
                revisionCoordinator.updatePhase(
                    winner,
                    'committed',
                    currentAuthorizationRevision()
                ) ?? winner
            );
        }

        await sessionContext.refresh();
        return winner;
    }

    /**
     * Publishes the switch intent before starting I/O. If another tab publishes
     * a newer revision while this request is in flight, this result is rejected
     * locally and the newer workspace is re-applied to repair any late server
     * write before state is committed to the current tab.
     */
    async function changeActiveWorkspace(
        workspaceId: string,
        setActiveWorkspace: (workspaceId: string) => Promise<void>
    ): Promise<ActiveWorkspaceChangeResult> {
        const revision = revisionCoordinator.begin(workspaceId);

        try {
            await setActiveWorkspace(workspaceId);
        } catch (error) {
            if (!revisionCoordinator.isCurrent(revision)) {
                const repaired = await repairSupersededWorkspaceChange(
                    revision,
                    setActiveWorkspace
                );
                return { committed: false, revision: repaired };
            }
            revisionCoordinator.updatePhase(
                revision,
                'rejected',
                currentAuthorizationRevision()
            );
            throw error;
        }

        if (!revisionCoordinator.isCurrent(revision)) {
            const repaired = await repairSupersededWorkspaceChange(
                revision,
                setActiveWorkspace
            );
            return { committed: false, revision: repaired };
        }

        const matched = await refreshSessionUntilWorkspace(
            workspaceId,
            () => revisionCoordinator.isCurrent(revision)
        );
        if (!revisionCoordinator.isCurrent(revision)) {
            const repaired = await repairSupersededWorkspaceChange(
                revision,
                setActiveWorkspace
            );
            return { committed: false, revision: repaired };
        }
        if (!matched) {
            revisionCoordinator.updatePhase(
                revision,
                'rejected',
                currentAuthorizationRevision()
            );
            throw new Error('Server did not confirm the active workspace switch');
        }

        const committed =
            revisionCoordinator.updatePhase(
                revision,
                'committed',
                currentAuthorizationRevision()
            ) ?? revision;
        return { committed: true, revision: committed };
    }

    function publishCurrentActiveWorkspaceRevision(): ActiveWorkspaceRevision {
        return revisionCoordinator.publishCurrent(
            currentWorkspaceId(),
            currentAuthorizationRevision()
        );
    }

    function notifyOtherTabsAuthSessionChanged(): void {
        try {
            localStorage.setItem(authSessionStorageKey, String(Date.now()));
        } catch {
            // best effort
        }
    }

    return {
        changeActiveWorkspace,
        refreshSessionUntilWorkspace,
        refreshSessionAfterWorkspaceRemoval,
        refreshSessionForActiveWorkspaceRevision,
        publishCurrentActiveWorkspaceRevision,
        notifyOtherTabsAuthSessionChanged,
        shouldClearWorkspaceForNullSession,
    };
}
