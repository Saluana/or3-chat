import { afterEach, describe, expect, it } from 'vitest';
import {
    evictWorkspaceDb,
    getActiveWorkspaceId,
    getDb,
    getWorkspaceGeneration,
    setActiveWorkspaceDb,
    subscribeActiveWorkspaceDb,
} from '~/db/client';

const TEST_WORKSPACES = [
    'reliability-switch-a',
    'reliability-switch-b',
] as const;

afterEach(() => {
    setActiveWorkspaceDb(null);
    for (const workspaceId of TEST_WORKSPACES) evictWorkspaceDb(workspaceId);
});

describe('workspace switch runtime integration', () => {
    it('changes the actual workspace DB and emits monotonic generations', () => {
        const events: Array<{
            oldWorkspaceId: string | null;
            newWorkspaceId: string | null;
            generation: number;
        }> = [];
        const unsubscribe = subscribeActiveWorkspaceDb((event) => {
            events.push(event);
        });

        const dbA = setActiveWorkspaceDb(TEST_WORKSPACES[0]);
        const generationA = getWorkspaceGeneration();
        const dbB = setActiveWorkspaceDb(TEST_WORKSPACES[1]);
        const generationB = getWorkspaceGeneration();
        unsubscribe();

        expect(dbA).not.toBe(dbB);
        expect(dbA.name).toBe(`or3-db-${TEST_WORKSPACES[0]}`);
        expect(dbB.name).toBe(`or3-db-${TEST_WORKSPACES[1]}`);
        expect(getDb()).toBe(dbB);
        expect(getActiveWorkspaceId()).toBe(TEST_WORKSPACES[1]);
        expect(generationB).toBe(generationA + 1);
        expect(events.slice(-2)).toEqual([
            {
                oldWorkspaceId: null,
                newWorkspaceId: TEST_WORKSPACES[0],
                generation: generationA,
            },
            {
                oldWorkspaceId: TEST_WORKSPACES[0],
                newWorkspaceId: TEST_WORKSPACES[1],
                generation: generationB,
            },
        ]);
    });

    it('rejects a late completion captured before a workspace switch', async () => {
        setActiveWorkspaceDb(TEST_WORKSPACES[0]);
        const capturedGeneration = getWorkspaceGeneration();
        let release!: () => void;
        const inFlight = new Promise<void>((resolve) => {
            release = resolve;
        });
        let appliedWorkspace: string | null = null;

        const completion = inFlight.then(() => {
            if (capturedGeneration !== getWorkspaceGeneration()) return;
            appliedWorkspace = getActiveWorkspaceId();
        });

        setActiveWorkspaceDb(TEST_WORKSPACES[1]);
        release();
        await completion;

        expect(appliedWorkspace).toBeNull();
        expect(getActiveWorkspaceId()).toBe(TEST_WORKSPACES[1]);
    });
});
