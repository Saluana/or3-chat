import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ACTIVE_WORKSPACE_REVISION_STORAGE_KEY,
    createActiveWorkspaceRevisionCoordinator,
    parseActiveWorkspaceRevision,
    type ActiveWorkspaceRevision,
} from '../activeWorkspaceRevision';
import { useWorkspaceManagerSession } from '../useWorkspaceManagerSession';

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createSharedStorage() {
    const values = new Map<string, string>();
    const writes: ActiveWorkspaceRevision[] = [];
    return {
        storage: {
            getItem(key: string) {
                return values.get(key) ?? null;
            },
            setItem(key: string, value: string) {
                values.set(key, value);
                if (key === ACTIVE_WORKSPACE_REVISION_STORAGE_KEY) {
                    const parsed = parseActiveWorkspaceRevision(value);
                    if (parsed) writes.push(parsed);
                }
            },
        },
        writes,
    };
}

function createSessionContext(server: {
    workspaceId: string;
    authorizationRevision: number;
}) {
    const data = ref({
        session: {
            authenticated: true,
            workspace: { id: server.workspaceId, name: server.workspaceId },
            authorizationRevision: server.authorizationRevision,
        },
        appAccessAllowed: true,
    });
    const refresh = vi.fn(async () => {
        data.value = {
            session: {
                authenticated: true,
                workspace: { id: server.workspaceId, name: server.workspaceId },
                authorizationRevision: server.authorizationRevision,
            },
            appAccessAllowed: true,
        };
        return data.value;
    });
    return { data, refresh } as any;
}

describe('active workspace cross-tab revisions', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('totally orders concurrent tab revisions and ignores the losing stale commit', () => {
        const { storage } = createSharedStorage();
        const tabA = createActiveWorkspaceRevisionCoordinator({
            actorId: 'tab-a',
            storage,
        });
        const tabB = createActiveWorkspaceRevisionCoordinator({
            actorId: 'tab-b',
            storage,
        });

        const revisionA = tabA.begin('workspace-a');
        const revisionB = {
            ...revisionA,
            actorId: 'tab-b',
            workspaceId: 'workspace-b',
        };

        expect(tabA.observe(revisionB)).toBe(true);
        expect(tabB.observe(revisionA)).toBe(true);
        expect(tabB.observe(revisionB)).toBe(true);
        expect(tabA.current()?.workspaceId).toBe('workspace-b');
        expect(tabB.current()?.workspaceId).toBe('workspace-b');

        const staleCommit = { ...revisionA, phase: 'committed' as const };
        expect(tabA.observe(staleCommit)).toBe(false);
        expect(tabB.observe(staleCommit)).toBe(false);
        expect(tabA.current()?.workspaceId).toBe('workspace-b');
        expect(tabB.current()?.workspaceId).toBe('workspace-b');
    });

    it('repairs an older deferred switch so both tabs and the server keep the newer workspace', async () => {
        const shared = createSharedStorage();
        const tabA = createActiveWorkspaceRevisionCoordinator({
            actorId: 'tab-a',
            storage: shared.storage,
        });
        const tabB = createActiveWorkspaceRevisionCoordinator({
            actorId: 'tab-b',
            storage: shared.storage,
        });
        const server = {
            workspaceId: 'workspace-initial',
            authorizationRevision: 0,
        };
        const sessionA = createSessionContext(server);
        const sessionB = createSessionContext(server);
        const managerA = useWorkspaceManagerSession(sessionA, {
            revisionCoordinator: tabA,
            delaysMs: [0],
        });
        const managerB = useWorkspaceManagerSession(sessionB, {
            revisionCoordinator: tabB,
            delaysMs: [0],
        });
        const olderGate = deferred();

        const setFromTabA = vi.fn(async (workspaceId: string) => {
            if (workspaceId === 'workspace-a') {
                await olderGate.promise;
            }
            server.workspaceId = workspaceId;
            server.authorizationRevision += 1;
        });
        const setFromTabB = vi.fn(async (workspaceId: string) => {
            server.workspaceId = workspaceId;
            server.authorizationRevision += 1;
        });

        const olderSwitch = managerA.changeActiveWorkspace(
            'workspace-a',
            setFromTabA
        );
        const intentA = shared.writes.at(-1)!;
        expect(tabB.observe(intentA)).toBe(true);

        const newerSwitch = managerB.changeActiveWorkspace(
            'workspace-b',
            setFromTabB
        );
        const intentB = shared.writes.at(-1)!;
        expect(intentB.workspaceId).toBe('workspace-b');

        const newerResult = await newerSwitch;
        expect(newerResult.committed).toBe(true);
        expect(server.workspaceId).toBe('workspace-b');

        const committedB = shared.writes.at(-1)!;
        expect(committedB.phase).toBe('committed');
        olderGate.resolve();

        const olderResult = await olderSwitch;
        expect(olderResult.committed).toBe(false);
        expect(setFromTabA).toHaveBeenLastCalledWith('workspace-b');
        expect(server.workspaceId).toBe('workspace-b');
        expect(sessionA.data.value.session.workspace.id).toBe('workspace-b');
        expect(sessionB.data.value.session.workspace.id).toBe('workspace-b');

        const repairedB = shared.writes.at(-1)!;
        expect(tabB.observe(repairedB)).toBe(true);
        expect(tabA.current()?.workspaceId).toBe('workspace-b');
        expect(tabB.current()?.workspaceId).toBe('workspace-b');
    });
});
