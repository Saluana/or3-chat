export const ACTIVE_WORKSPACE_REVISION_STORAGE_KEY =
    'or3:active-workspace-revision';

export type ActiveWorkspaceRevisionPhase = 'intent' | 'committed' | 'rejected';

/**
 * A Lamport-style, totally ordered workspace change revision. Two tabs can
 * allocate the same numeric counter concurrently; actorId breaks that tie so
 * every tab still converges on one winner.
 */
export interface ActiveWorkspaceRevision {
    revision: number;
    actorId: string;
    workspaceId: string | null;
    phase: ActiveWorkspaceRevisionPhase;
    authorizationRevision?: number;
}

type WorkspaceRevisionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface ActiveWorkspaceRevisionCoordinator {
    begin(workspaceId: string): ActiveWorkspaceRevision;
    publishCurrent(
        workspaceId: string | null,
        authorizationRevision?: number
    ): ActiveWorkspaceRevision;
    updatePhase(
        revision: ActiveWorkspaceRevision,
        phase: Extract<ActiveWorkspaceRevisionPhase, 'committed' | 'rejected'>,
        authorizationRevision?: number
    ): ActiveWorkspaceRevision | null;
    observe(revision: ActiveWorkspaceRevision): boolean;
    current(): ActiveWorkspaceRevision | null;
    isCurrent(revision: ActiveWorkspaceRevision): boolean;
}

const phaseRank: Record<ActiveWorkspaceRevisionPhase, number> = {
    intent: 0,
    committed: 1,
    rejected: 1,
};

function defaultActorId(): string {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function browserStorage(): WorkspaceRevisionStorage | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
}

export function compareActiveWorkspaceRevisions(
    left: ActiveWorkspaceRevision,
    right: ActiveWorkspaceRevision
): number {
    if (left.revision !== right.revision) {
        return left.revision < right.revision ? -1 : 1;
    }
    if (left.actorId === right.actorId) return 0;
    return left.actorId < right.actorId ? -1 : 1;
}

export function parseActiveWorkspaceRevision(
    raw: string | null | undefined
): ActiveWorkspaceRevision | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<ActiveWorkspaceRevision>;
        if (
            !Number.isSafeInteger(value.revision) ||
            (value.revision ?? 0) <= 0 ||
            typeof value.actorId !== 'string' ||
            value.actorId.length === 0 ||
            (value.workspaceId !== null && typeof value.workspaceId !== 'string') ||
            (value.phase !== 'intent' &&
                value.phase !== 'committed' &&
                value.phase !== 'rejected') ||
            (value.authorizationRevision !== undefined &&
                (!Number.isSafeInteger(value.authorizationRevision) ||
                    value.authorizationRevision < 0))
        ) {
            return null;
        }
        return value as ActiveWorkspaceRevision;
    } catch {
        return null;
    }
}

export function createActiveWorkspaceRevisionCoordinator(options?: {
    actorId?: string;
    storage?: WorkspaceRevisionStorage | null | (() => WorkspaceRevisionStorage | null);
    storageKey?: string;
}): ActiveWorkspaceRevisionCoordinator {
    const actorId = options?.actorId ?? defaultActorId();
    const storageKey = options?.storageKey ?? ACTIVE_WORKSPACE_REVISION_STORAGE_KEY;
    let latest: ActiveWorkspaceRevision | null = null;

    const getStorage = (): WorkspaceRevisionStorage | null => {
        if (typeof options?.storage === 'function') return options.storage();
        if (options && 'storage' in options) return options.storage ?? null;
        return browserStorage();
    };

    const readPersisted = (): ActiveWorkspaceRevision | null => {
        try {
            return parseActiveWorkspaceRevision(getStorage()?.getItem(storageKey));
        } catch {
            return null;
        }
    };

    const write = (revision: ActiveWorkspaceRevision): void => {
        try {
            getStorage()?.setItem(storageKey, JSON.stringify(revision));
        } catch {
            // Cross-tab coordination is best effort when storage is unavailable.
        }
    };

    const observe = (candidate: ActiveWorkspaceRevision): boolean => {
        if (!latest) {
            latest = candidate;
            return true;
        }

        const order = compareActiveWorkspaceRevisions(candidate, latest);
        if (order < 0) return false;
        if (order > 0) {
            latest = candidate;
            return true;
        }

        if (candidate.workspaceId !== latest.workspaceId) return false;
        const candidatePhase = phaseRank[candidate.phase];
        const latestPhase = phaseRank[latest.phase];
        const candidateAuthorizationRevision = candidate.authorizationRevision ?? -1;
        const latestAuthorizationRevision = latest.authorizationRevision ?? -1;
        if (
            candidatePhase < latestPhase ||
            (candidatePhase === latestPhase &&
                candidateAuthorizationRevision <= latestAuthorizationRevision)
        ) {
            return false;
        }
        latest = candidate;
        return true;
    };

    const syncPersisted = (): ActiveWorkspaceRevision | null => {
        const persisted = readPersisted();
        if (persisted) observe(persisted);
        return latest;
    };

    const isCurrent = (revision: ActiveWorkspaceRevision): boolean => {
        syncPersisted();
        return Boolean(
            latest &&
                compareActiveWorkspaceRevisions(latest, revision) === 0 &&
                latest.workspaceId === revision.workspaceId
        );
    };

    const allocate = (
        workspaceId: string | null,
        phase: ActiveWorkspaceRevisionPhase,
        authorizationRevision?: number
    ): ActiveWorkspaceRevision => {
        syncPersisted();
        const revision = (latest?.revision ?? 0) + 1;
        const candidate: ActiveWorkspaceRevision = {
            revision,
            actorId,
            workspaceId,
            phase,
            ...(authorizationRevision === undefined ? {} : { authorizationRevision }),
        };
        latest = candidate;
        write(candidate);
        return candidate;
    };

    return {
        begin(workspaceId) {
            return allocate(workspaceId, 'intent');
        },
        publishCurrent(workspaceId, authorizationRevision) {
            return allocate(workspaceId, 'committed', authorizationRevision);
        },
        updatePhase(revision, phase, authorizationRevision) {
            if (!isCurrent(revision)) return null;
            const next: ActiveWorkspaceRevision = {
                ...revision,
                phase,
                ...(authorizationRevision === undefined
                    ? {}
                    : { authorizationRevision }),
            };
            latest = next;
            write(next);
            return next;
        },
        observe,
        current() {
            return syncPersisted();
        },
        isCurrent,
    };
}

export const activeWorkspaceRevisionCoordinator =
    createActiveWorkspaceRevisionCoordinator({
        storage: () => browserStorage(),
    });
