import { describe, expect, it } from 'vitest';
import { explorerItemKey } from '../records';
import { projectExplorerTree, type ExplorerFolderRow, type ExplorerOrganization } from '../tree';

function folder(id: string, parent_id: string | null, deleted = false, name = id): ExplorerFolderRow {
    return { kind: 'folder', id, deleted, updatedAt: 1,
        payload: { version: 1, scope: { kind: 'files' }, parent_id, name } };
}
describe('explorer hierarchy', () => {
    it('recovers deleted ancestors, missing parents and cycles deterministically', () => {
        const rows = [folder('root', null), folder('dead', 'root', true),
            folder('child', 'dead'), folder('orphan', 'missing'),
            folder('x', 'y'), folder('y', 'x')];
        for (const input of [rows, [...rows].reverse()]) {
            const tree = projectExplorerTree(input);
            expect(tree.folderLocations.get('child')).toEqual({ parentId: 'root', recovery: 'removed-folder' });
            expect(tree.folderLocations.get('orphan')).toEqual({ parentId: null, recovery: 'missing-folder' });
            expect(tree.folderLocations.get('x')).toEqual({ parentId: null, recovery: 'cycle' });
            expect(tree.path('y').map(row => row.id)).toEqual(['x', 'y']);
        }
    });

    it('retains duplicate folders and resolves placements through a deleted cycle', () => {
        const item = { kind: 'document', item_id: 'doc-a' } as const;
        const placement: ExplorerOrganization = { kind: 'placement', id: 'p', deleted: false, updatedAt: 1,
            payload: { version: 1, scope: { kind: 'files' }, parent_id: 'dead', item } };
        const a = folder('first-12345678', null, false, 'École');
        const b = folder('second-87654321', null, false, 'ÉCOLE');
        const tree = projectExplorerTree([a, b, folder('dead', 'dead', true), placement]);
        expect(tree.label(a)).toBe('École (12345678)');
        expect(tree.label(b)).toBe('ÉCOLE (87654321)');
        expect(tree.placements.get(explorerItemKey(item))).toEqual({ parentId: null, recovery: 'cycle' });
    });
});
