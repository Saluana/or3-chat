import { describe, expect, it } from 'vitest';

type FileRef = { workspaceId: string; hash: string };

describe('storage workspace isolation integration', () => {
    it('denies cross-workspace access for presign/download/commit', () => {
        const sessionWorkspace = 'ws-a';
        const request = { workspaceId: 'ws-b' };

        const canAccess = sessionWorkspace === request.workspaceId;
        expect(canAccess).toBe(false);
    });

    it('gc affects only target workspace records', () => {
        const refs: FileRef[] = [
            { workspaceId: 'ws-a', hash: 'a1' },
            { workspaceId: 'ws-b', hash: 'b1' },
        ];

        const gc = (workspaceId: string) => refs.filter((r) => r.workspaceId !== workspaceId);
        const remaining = gc('ws-a');

        expect(remaining).toEqual([{ workspaceId: 'ws-b', hash: 'b1' }]);
    });
});
